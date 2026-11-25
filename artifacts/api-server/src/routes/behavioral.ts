import { Router, type Request, type Response } from "express";
import { createHash, createHmac, timingSafeEqual, randomBytes } from "crypto";
import { BEHAVIORAL_SESSION_ID_FACTORY } from "../services/behavioral-session-id.js";
import {
  trackBehaviorEvent, upsertSession, generateBehaviorInsights, getBehaviorInsights,
  analyzeBehaviorFunnel, ALLOWED_BEHAVIOR_FUNNEL_EVENTS,
} from "../services/behavioral-service.js";
import { db, behaviorSiteTokensTable, behaviorEventsTable, croExperimentsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAddon, resolveOrgAddonEntitlement } from "../middlewares/planGate.js";
import { canWrite } from "../middlewares/requireRole.js";
import {
  MAX_TS_SKEW_MS, issueSessionToken, verifySessionToken, consumeNonce,
} from "../services/behavioral-session-auth.js";
import { behavioralRateLimit } from "../middlewares/rateLimiter.js";

// ── publicBehavioralRouter — no auth required ─────────────────────────────────
export const publicBehavioralRouter = Router();

// ── Per-registered-site CORS allowlist ────────────────────────────────────────
export const behavioralOriginAllowlist = new Set<string>();

/**
 * Pre-load all registered site origins into the CORS allowlist at server startup.
 * Uses superuser Drizzle db — called once at boot, no req context available.
 */
export async function loadBehavioralCorsAllowlist(): Promise<void> {
  const rows = await db
    .select({ siteUrl: behaviorSiteTokensTable.siteUrl })
    .from(behaviorSiteTokensTable);
  for (const row of rows) {
    try { behavioralOriginAllowlist.add(new URL(row.siteUrl).origin); } catch {}
  }
}

// ── Cryptographic helpers ─────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function verifyHmac(key: string, message: string, receivedHex: string): boolean {
  const expected = createHmac("sha256", key).update(message).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(receivedHex, "hex"));
  } catch {
    return false;
  }
}

/**
 * Look up site token hash — used in public router, no req.orgDb available.
 * Intentionally uses superuser Drizzle since siteTokens are validated before
 * org context is established (token-exchange endpoint is public, pre-auth).
 */
async function lookupSiteToken(plaintextToken: string, siteUrl: string): Promise<string | null> {
  try {
    const hash = hashToken(plaintextToken);
    const [row] = await db
      .select({ siteUrl: behaviorSiteTokensTable.siteUrl, orgId: behaviorSiteTokensTable.orgId })
      .from(behaviorSiteTokensTable)
      .where(eq(behaviorSiteTokensTable.tokenHash, hash))
      .limit(1);
    if (!row || row.siteUrl !== siteUrl) return null;
    return row.orgId ?? "default";
  } catch {
    return null;
  }
}

// ── Browser attestation ───────────────────────────────────────────────────────
function browserAttestationPasses(req: Request, siteUrl: string): boolean {
  try {
    const secFetchSite = req.headers["sec-fetch-site"];
    if (secFetchSite !== "cross-site" && secFetchSite !== "same-site") return false;
    const origin = req.headers["origin"];
    if (!origin) return false;
    return new URL(origin).origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}

// ── Entitlement a l'ingestion ────────────────────────────────────────────────
// L'organisation vient du jeton de site (public, sans session) : on verifie a CHAQUE appel
// (cache 30 s dans planGate) qu'elle detient toujours Behavioral AI (plan ou add-on actif).
// Reponse volontairement generique : ne revele ni le plan, ni l'etat de facturation.
async function ingestAllowed(orgId: string, res: Response): Promise<boolean> {
  const ent = await resolveOrgAddonEntitlement(orgId, "behavioralAI");
  if (ent === "granted") return true;
  if (ent === "unavailable") {
    res.status(503).json({ error: "Behavioral tracking temporarily unavailable", code: "BEHAVIORAL_UNAVAILABLE" });
  } else {
    res.status(403).json({ error: "Behavioral tracking is not active for this site", code: "BEHAVIORAL_INACTIVE" });
  }
  return false;
}

// ── Anti-rejeu partage entre instances (PostgreSQL) ──────────────────────────
// true = nonce accepte ; sinon la reponse (403 rejeu / 503 base indisponible) est deja envoyee.
async function acceptNonce(siteUrl: string, nonce: unknown, tsNum: number, res: Response, replayMsg: string): Promise<boolean> {
  try {
    if (nonce && await consumeNonce(siteUrl, nonce, tsNum)) return true;
    res.status(403).json({ error: replayMsg });
  } catch {
    res.status(503).json({ error: "Replay protection unavailable", code: "BEHAVIORAL_UNAVAILABLE" });
  }
  return false;
}

// ── POST /api/behavioral/token ────────────────────────────────────────────────
publicBehavioralRouter.post("/behavioral/token", behavioralRateLimit("token"), async (req: Request, res: Response) => {
  const { siteKey, siteToken, ts, nonce, sig } = req.body ?? {};
  if (!siteKey || !siteToken || !ts || !nonce || !sig) {
    res.status(400).json({ error: "siteKey, siteToken, ts, nonce, sig required" }); return;
  }
  if (!browserAttestationPasses(req, siteKey)) {
    res.status(403).json({ error: "Browser attestation failed: valid Origin and Sec-Fetch-Site required" }); return;
  }
  const origin = req.headers["origin"] as string;
  const tsNum = Number(ts);
  if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_TS_SKEW_MS) {
    res.status(403).json({ error: "Timestamp missing or outside acceptable window" }); return;
  }
  const canonical = `${siteKey}|${origin}|${tsNum}|${nonce}`;
  if (!verifyHmac(siteToken, canonical, sig)) {
    res.status(403).json({ error: "Invalid HMAC signature" }); return;
  }
  const resolvedOrgId = await lookupSiteToken(siteToken, siteKey);
  if (!resolvedOrgId) {
    res.status(403).json({ error: "Unregistered site or invalid credentials" }); return;
  }
  // Nonce consomme apres la signature : un tiers sans le jeton de site ne peut pas
  // remplir la table de nonces ; l'ordre (HMAC valide -> nonce) reste rejeu-sur.
  if (!(await acceptNonce(siteKey, nonce, tsNum, res, "Nonce already used — replay rejected"))) return;
  if (!(await ingestAllowed(resolvedOrgId, res))) return;
  const { token, expiresAt } = issueSessionToken(siteKey, origin, resolvedOrgId);
  res.json({ sessionToken: token, expiresAt });
});

// ── Validation des evenements publics (borne la taille et le vocabulaire) ──────
const ALLOWED_EVENT_TYPES = new Set([
  "page_view", "scroll", "scroll_depth", "click", "rage_click", "dead_click", "exit",
  "form_abandon", "form_submit", "session_end", "tracker_ready",
  "experiment_exposure", "experiment_conversion", "hover", "copy",
]);
// Le snippet envoie des nombres bruts (clientX fractionnaire sur ecran HiDPI, scroll > 100 en
// rebond) : on accepte tout nombre fini et on l'arrondit / borne avant ecriture (colonnes INTEGER).
const optionalInt = (v: unknown, min: number, max: number): boolean =>
  v == null || (typeof v === "number" && Number.isFinite(v) && v >= min - 1000 && v <= max + 1000);
const toInt = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined;

export function validateEventPayload(e: {
  sessionId: unknown; page: unknown; eventType: unknown; element?: unknown;
  xPos?: unknown; yPos?: unknown; scrollDepth?: unknown; timeOnPage?: unknown; metadata?: unknown;
}): string | null {
  if (typeof e.sessionId !== "string" || e.sessionId.length > 100) return "Invalid sessionId";
  if (typeof e.page !== "string" || e.page.length > 500) return "Invalid page";
  if (typeof e.eventType !== "string" || !ALLOWED_EVENT_TYPES.has(e.eventType)) return "Unsupported eventType";
  if (e.element != null && (typeof e.element !== "string" || e.element.length > 300)) return "Invalid element";
  if (!optionalInt(e.xPos, 0, 100_000) || !optionalInt(e.yPos, 0, 100_000)) return "Invalid coordinates";
  if (!optionalInt(e.scrollDepth, 0, 100)) return "Invalid scrollDepth";
  if (!optionalInt(e.timeOnPage, 0, 86_400)) return "Invalid timeOnPage";
  if (e.metadata != null) {
    if (typeof e.metadata !== "object" || Array.isArray(e.metadata)) return "Invalid metadata";
    if (JSON.stringify(e.metadata).length > 4_000) return "metadata too large";
  }
  return null;
}

// ── POST /api/behavioral/event ────────────────────────────────────────────────
publicBehavioralRouter.post("/behavioral/event", behavioralRateLimit("event"), async (req: Request, res: Response) => {
  const { sessionId, siteUrl, page, eventType, element, xPos, yPos, scrollDepth, timeOnPage, metadata, sessionToken, ts, nonce } = req.body ?? {};
  if (!sessionId || !siteUrl || !page || !eventType) {
    res.status(400).json({ error: "sessionId, siteUrl, page, eventType required" }); return;
  }
  if (!sessionToken) {
    res.status(401).json({ error: "sessionToken required — call POST /behavioral/token first" }); return;
  }
  if (!browserAttestationPasses(req, siteUrl)) {
    res.status(403).json({ error: "Origin header required and must match siteUrl" }); return;
  }
  const invalidEvent = validateEventPayload({ sessionId, page, eventType, element, xPos, yPos, scrollDepth, timeOnPage, metadata });
  if (invalidEvent) { res.status(400).json({ error: invalidEvent }); return; }
  const origin = req.headers["origin"] as string;
  const _evtEntry = verifySessionToken(sessionToken, siteUrl, origin);
  if (!_evtEntry) {
    res.status(403).json({ error: "Invalid or expired session token — call POST /behavioral/token to refresh" }); return;
  }
  const eventOrgId = _evtEntry.orgId;
  const tsNum = Number(ts);
  if (!ts || isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_TS_SKEW_MS) {
    res.status(403).json({ error: "Timestamp missing or outside acceptable window" }); return;
  }
  if (!(await ingestAllowed(eventOrgId, res))) return;
  if (!(await acceptNonce(siteUrl, nonce, tsNum, res, "Missing nonce or nonce already used — replay rejected"))) return;
  if (eventType === "experiment_exposure" || eventType === "experiment_conversion") {
    const meta = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
    const experimentId = String(meta["experimentId"] ?? "");
    const variant = String(meta["variant"] ?? "");
    if (!experimentId || !["A", "B"].includes(variant)) {
      res.status(400).json({ error: "Valid experimentId and variant are required." }); return;
    }
    const [experiment] = await db.select({
      id: croExperimentsTable.id, page: croExperimentsTable.page,
      status: croExperimentsTable.status, variantA: croExperimentsTable.variantA,
      variantB: croExperimentsTable.variantB,
    }).from(croExperimentsTable).where(and(
      eq(croExperimentsTable.id, experimentId),
      eq(croExperimentsTable.orgId, eventOrgId),
      eq(croExperimentsTable.siteUrl, siteUrl),
    )).limit(1);
    if (!experiment || experiment.status !== "running" || experiment.page !== page) {
      res.status(404).json({ error: "Active experiment not found for this page." }); return;
    }
    const [arm] = await db.select({ id: behaviorEventsTable.id }).from(behaviorEventsTable).where(and(
      eq(behaviorEventsTable.orgId, eventOrgId),
      eq(behaviorEventsTable.sessionId, sessionId),
      eq(behaviorEventsTable.siteUrl, siteUrl),
      eq(behaviorEventsTable.eventType, "experiment_exposure"),
      sql`${behaviorEventsTable.metadata}->>'experimentId' = ${experimentId}`,
      sql`${behaviorEventsTable.metadata}->>'variant' = ${variant}`,
    )).limit(1);
    if (eventType === "experiment_conversion" && !arm) {
      res.status(409).json({ error: "Conversion cannot be counted before a recorded exposure." }); return;
    }
    if (eventType === "experiment_exposure" && arm) {
      res.status(200).json({ ok: true, duplicate: true }); return;
    }
  }
  try {
    const persisted = await trackBehaviorEvent({
      sessionId, orgId: eventOrgId, siteUrl, page, eventType, element,
      xPos: toInt(xPos, 0, 100_000), yPos: toInt(yPos, 0, 100_000),
      scrollDepth: toInt(scrollDepth, 0, 100), timeOnPage: toInt(timeOnPage, 0, 86_400), metadata,
    });
    if (!persisted) {
      res.status(503).json({ error: "Behavioral event could not be persisted." }); return;
    }
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to track event" });
  }
});

// Public assignment endpoint: the installed, signed site snippet requests a
// deterministic per-session variant. Only active, org-owned experiments serve.
publicBehavioralRouter.post("/behavioral/experiments/assign", behavioralRateLimit("event"), async (req: Request, res: Response) => {
  const { sessionId, siteUrl, page, sessionToken, ts, nonce } = req.body ?? {};
  if (!sessionId || !siteUrl || !page || !sessionToken) {
    res.status(400).json({ error: "sessionId, siteUrl, page and sessionToken required" }); return;
  }
  if (!browserAttestationPasses(req, siteUrl)) {
    res.status(403).json({ error: "Origin header required and must match siteUrl" }); return;
  }
  const origin = req.headers["origin"] as string;
  const entry = verifySessionToken(sessionToken, siteUrl, origin);
  if (!entry) {
    res.status(403).json({ error: "Invalid or expired session token" }); return;
  }
  const tsNum = Number(ts);
  if (!ts || isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_TS_SKEW_MS) {
    res.status(403).json({ error: "Invalid timestamp or replayed nonce" }); return;
  }
  if (!(await ingestAllowed(entry.orgId, res))) return;
  if (!(await acceptNonce(siteUrl, nonce, tsNum, res, "Invalid timestamp or replayed nonce"))) return;
  try {
    const experiments = await db.select({
      id: croExperimentsTable.id, page: croExperimentsTable.page,
      variantA: croExperimentsTable.variantA, variantB: croExperimentsTable.variantB,
    }).from(croExperimentsTable).where(and(
      eq(croExperimentsTable.orgId, entry.orgId),
      eq(croExperimentsTable.siteUrl, siteUrl),
      eq(croExperimentsTable.page, page),
      eq(croExperimentsTable.status, "running"),
    )).limit(10);
    const assigned = experiments.map(experiment => {
      const digest = createHash("sha256").update(`${experiment.id}:${sessionId}`).digest()[0] ?? 0;
      const variant = digest % 2 === 0 ? "A" : "B";
      const config = variant === "A" ? experiment.variantA : experiment.variantB;
      return { experimentId: experiment.id, variant, config };
    });
    res.json({ experiments: assigned });
  } catch {
    res.status(503).json({ error: "Experiment assignment unavailable" });
  }
});

// ── POST /api/behavioral/session ──────────────────────────────────────────────
publicBehavioralRouter.post("/behavioral/session", behavioralRateLimit("session"), async (req: Request, res: Response) => {
  const { id, siteUrl, userAgent, deviceType, country, sessionToken, ts, nonce } = req.body ?? {};
  if (!id || !siteUrl) { res.status(400).json({ error: "id and siteUrl required" }); return; }
  if (!sessionToken) {
    res.status(401).json({ error: "sessionToken required — call POST /behavioral/token first" }); return;
  }
  if (!browserAttestationPasses(req, siteUrl)) {
    res.status(403).json({ error: "Origin header required and must match siteUrl" }); return;
  }
  const origin = req.headers["origin"] as string;
  const _sessEntry = verifySessionToken(sessionToken, siteUrl, origin);
  if (!_sessEntry) {
    res.status(403).json({ error: "Invalid or expired session token — call POST /behavioral/token to refresh" }); return;
  }
  const sessionOrgId = _sessEntry.orgId;
  const tsNum = Number(ts);
  if (!ts || isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_TS_SKEW_MS) {
    res.status(403).json({ error: "Timestamp missing or outside acceptable window" }); return;
  }
  if (!(await ingestAllowed(sessionOrgId, res))) return;
  if (!(await acceptNonce(siteUrl, nonce, tsNum, res, "Missing nonce or nonce already used — replay rejected"))) return;
  try {
    const stored = await upsertSession({ id, orgId: sessionOrgId, siteUrl, userAgent, deviceType, country });
    if (stored === false) { res.status(503).json({ error: "Behavioral session could not be persisted." }); return; }
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to upsert session" });
  }
});

// ── Protected router (auth required) ─────────────────────────────────────────
const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const orgDb = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// ── GET /api/behavioral/snippet ───────────────────────────────────────────────
router.get("/behavioral/snippet", canWrite, requireAddon("behavioralAI", "Behavioral AI"), async (req: Request, res: Response) => {
  const { siteUrl } = req.query as { siteUrl?: string };
  if (!siteUrl) { res.status(400).json({ error: "siteUrl query param required" }); return; }

  const orgId = req.orgId ?? "default";
  const plainToken = randomBytes(32).toString("hex");
  const tokenHash  = hashToken(plainToken);

  try {
    // Cross-tenant ownership guard. It must NOT use req.orgDb: under RLS (tenant_select)
    // another organization's row is invisible, so the guard never fired and the INSERT ... ON
    // CONFLICT below then failed with an RLS violation (HTTP 500 instead of 403).
    const [existing] = await db
      .select({ orgId: behaviorSiteTokensTable.orgId })
      .from(behaviorSiteTokensTable)
      .where(eq(behaviorSiteTokensTable.siteUrl, siteUrl))
      .limit(1);
    if (existing && existing.orgId !== orgId) {
      res.status(403).json({ error: "This site URL is already registered to another organization" }); return;
    }

    await orgDb(req)(
      `INSERT INTO behavior_site_tokens (token_hash, site_url, org_id, created_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (site_url) DO UPDATE SET token_hash=$1, org_id=$3, created_at=now(), last_used_at=NULL`,
      [tokenHash, siteUrl, orgId]
    );

    try { behavioralOriginAllowlist.add(new URL(siteUrl).origin); } catch {}
  } catch (err) {
    if (res.headersSent) return;
    // Concurrent claim of the same site by another org: RLS rejects the conflicting upsert.
    if ((err as { code?: string })?.code === "42501") {
      res.status(403).json({ error: "This site URL is already registered to another organization" }); return;
    }
    res.status(500).json({ error: "Failed to provision site token" }); return;
  }

  const baseUrl = process.env["REPLIT_DEV_DOMAIN"]
    ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
    : (process.env["PUBLIC_BASE_URL"] ?? "https://app.flowpoint.pro");
  const apiBase = `${baseUrl}/api`;

  const snippet = `<!-- FlowPoint Behavioral Analytics — paste before </body> -->
<script>
(function(w,d,s,u,k){
  /* CONSENTEMENT : rien n'est collecte ni envoye avant un accord explicite.
     - Global Privacy Control actif : le suivi ne demarre jamais.
     - Sinon le site declare l'accord : window.fpBehavioralConsent = true, ou
       window.dispatchEvent(new CustomEvent('fp:behavioral-consent',{detail:{granted:true}})). */
  if(w.navigator&&w.navigator.globalPrivacyControl===true)return;
  var _fpBooted=false;
  function _fpBoot(){
  if(_fpBooted)return;_fpBooted=true;
  var _fpSid=(${BEHAVIORAL_SESSION_ID_FACTORY})(w);
  var _fpStart=Date.now();var _fpToken=null;var _fpTokenExp=0;
  var _fpRageMap={};var _fpRageTs=0;
  async function _fpHmac(msg){
    var enc=new TextEncoder();
    var key=await crypto.subtle.importKey('raw',enc.encode(k),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    var b=await crypto.subtle.sign('HMAC',key,enc.encode(msg));
    return Array.from(new Uint8Array(b)).map(function(x){return x.toString(16).padStart(2,'0')}).join('');
  }
  async function _fpGetToken(){
    try{
      var ts=Date.now(),nonce=Math.random().toString(36).slice(2,10);
      var origin=location.origin;
      var msg=s+'|'+origin+'|'+ts+'|'+nonce;
      var sig=await _fpHmac(msg);
      var r=await fetch(u+'/behavioral/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteKey:s,siteToken:k,ts:ts,nonce:nonce,sig:sig})});
      if(!r.ok)return;
      var d=await r.json();
      _fpToken=d.sessionToken;_fpTokenExp=d.expiresAt;
    }catch(e){}
  }
  async function _fpSend(type,data){
    if(!_fpToken||Date.now()>=_fpTokenExp)await _fpGetToken();
    if(!_fpToken)return;
    var ts=Date.now(),nonce=Math.random().toString(36).slice(2,10);
    var payload=JSON.stringify(Object.assign({sessionId:_fpSid,siteUrl:s,page:location.pathname,eventType:type,sessionToken:_fpToken,ts:ts,nonce:nonce},data));
    return fetch(u+'/behavioral/event',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true}).catch(function(){return null;});
  }
  async function _fpSession(){
    if(!_fpToken||Date.now()>=_fpTokenExp)await _fpGetToken();
    if(!_fpToken)return;
    var ts=Date.now(),nonce=Math.random().toString(36).slice(2,10);
    var payload=JSON.stringify({id:_fpSid,siteUrl:s,sessionToken:_fpToken,ts:ts,nonce:nonce,userAgent:navigator.userAgent,deviceType:/Mobi|Android/i.test(navigator.userAgent)?'mobile':'desktop'});
    fetch(u+'/behavioral/session',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true}).catch(function(){});
  }
  _fpSession();
  _fpSend('tracker_ready',{metadata:{version:2}});
  _fpSend('page_view',{metadata:{referrer:document.referrer,title:document.title}});
  async function _fpAssignExperiments(){
    try{
      if(!_fpToken||Date.now()>=_fpTokenExp)await _fpGetToken();
      if(!_fpToken)return;
      var ts=Date.now(),nonce=Math.random().toString(36).slice(2,10);
      var r=await fetch(u+'/behavioral/experiments/assign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:_fpSid,siteUrl:s,page:location.pathname,sessionToken:_fpToken,ts:ts,nonce:nonce})});
      if(!r.ok)return;
      var data=await r.json();
      (data.experiments||[]).forEach(function(ex){
        var cfg=ex.config||{},target;
        try{target=d.querySelector(cfg.selector)}catch(_){return}
        if(!target||typeof cfg.text!=='string')return;
        target.textContent=cfg.text;
        var exposureRequest=_fpSend('experiment_exposure',{metadata:{experimentId:ex.experimentId,variant:ex.variant}});
        var goals;
        try{goals=d.querySelectorAll(cfg.goalSelector)}catch(_){goals=[]}
        goals.forEach(function(goal){goal.addEventListener('click',async function(){
          var exposure=await exposureRequest;
          if(exposure&&exposure.ok)_fpSend('experiment_conversion',{metadata:{experimentId:ex.experimentId,variant:ex.variant}});
        },{once:true})});
      });
    }catch(e){}
  }
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',_fpAssignExperiments,{once:true});else _fpAssignExperiments();
  d.addEventListener('click',function(e){
    var now=Date.now();var el=e.target&&(e.target.id||e.target.className||e.target.tagName)||'';
    var key=Math.round(e.clientX/20)+'_'+Math.round(e.clientY/20);
    if(!_fpRageMap[key])_fpRageMap[key]=0;_fpRageMap[key]++;
    if(now-_fpRageTs<500&&_fpRageMap[key]>=3){_fpSend('rage_click',{xPos:e.clientX,yPos:e.clientY,element:el});_fpRageMap[key]=0;}
    _fpRageTs=now;
    var node=e.target&&e.target.closest?e.target.closest('a,button,input,select,textarea,[role="button"]'):null;
    try{if(!node&&e.target&&getComputedStyle(e.target).cursor==='pointer')_fpSend('dead_click',{xPos:e.clientX,yPos:e.clientY,element:el})}catch(_){}
    _fpSend('click',{xPos:e.clientX,yPos:e.clientY,element:el});
  });
  var _fpScroll=0;d.addEventListener('scroll',function(){
    var pct=Math.round((w.scrollY/(d.body.scrollHeight-w.innerHeight||1))*100);
    if(pct>_fpScroll+20){_fpScroll=pct;_fpSend('scroll_depth',{scrollDepth:pct});}
  });
  var _fpForms=[];
  d.querySelectorAll('form').forEach(function(f){
    var touched=false,submitted=false;
    f.addEventListener('input',function(){touched=true},{passive:true});
    f.addEventListener('submit',function(){submitted=true;_fpSend('form_submit',{element:f.id||f.className||'form'});});
    _fpForms.push(function(){if(touched&&!submitted)_fpSend('form_abandon',{element:f.id||f.className||'form'})});
  });
  w.addEventListener('beforeunload',function(){
    _fpForms.forEach(function(report){report()});
    _fpSend('exit',{timeOnPage:Math.round((Date.now()-_fpStart)/1000)});
    _fpSend('session_end',{timeOnPage:Math.round((Date.now()-_fpStart)/1000)});
  });
  }
  if(w.fpBehavioralConsent===true)_fpBoot();
  else w.addEventListener('fp:behavioral-consent',function(e){if(e&&e.detail&&e.detail.granted===true)_fpBoot();});
})(window,document,'${siteUrl}','${apiBase}','${plainToken}');
</script>`;

  res.json({
    siteUrl, snippet,
    instructions: [
      "1. Copiez le snippet ci-dessus.",
      "2. Collez-le juste avant la balise </body> sur chaque page de votre site.",
      "3. Tracking only starts after the visitor consents: call window.dispatchEvent(new CustomEvent('fp:behavioral-consent',{detail:{granted:true}})) from your consent banner (or set window.fpBehavioralConsent = true). Visitors with Global Privacy Control are never tracked.",
      "4. Publiez les changements — les premiers événements apparaîtront dans FlowPoint en quelques minutes.",
      "5. Pour vérifier l'installation, consultez GET /api/behavioral/status?siteUrl=<votre-site>.",
    ],
    trackedEvents: ["page_view", "click", "rage_click", "scroll_depth", "form_submit", "session_end"],
    note: "Le snippet intègre un token d'installation qui sert de clé HMAC pour prouver la possession du site lors de l'échange de token.",
  });
});

// ── GET /api/behavioral/status ────────────────────────────────────────────────
router.get("/behavioral/status", async (req: Request, res: Response) => {
  const { siteUrl } = req.query as { siteUrl?: string };
  if (!siteUrl) {
    res.json({ status: "not_configured", installed: false, totalEvents: 0, lastEventAt: null,
               message: "Aucun site configuré. Générez d'abord un snippet via GET /api/behavioral/snippet." });
    return;
  }

  const orgId = req.orgId ?? "default";

  try {
    const tokenRow = await orgDb(req)(
      `SELECT org_id FROM behavior_site_tokens WHERE site_url=$1 AND org_id=$2 LIMIT 1`,
      [siteUrl, orgId]
    );

    if (!tokenRow.rows[0]) {
      res.status(404).json({
        error: "Site not found for this organization. Generate a snippet first via GET /api/behavioral/snippet.",
      }); return;
    }

    const countRow = await orgDb(req)(
      `SELECT COUNT(*) AS total, MAX(created_at) AS last_event FROM behavior_events WHERE site_url=$1 AND org_id=$2`,
      [siteUrl, orgId]
    );
    const row = countRow.rows[0] as { total: string; last_event: Date | null } | undefined;
    const total = Number(row?.total ?? 0);
    const last_event = row?.last_event ?? null;
    const installed = total > 0;
    // Lecture seule toujours possible, mais coherente avec l'ingestion : sans entitlement
    // Behavioral AI, les evenements sont refuses (403) -> on ne declare pas le snippet « actif ».
    const ent = await resolveOrgAddonEntitlement(orgId, "behavioralAI");
    if (ent === "denied") {
      res.json({
        installed, totalEvents: total, lastEventAt: last_event, entitled: false, ingesting: false,
        status: "addon_inactive",
        message: "Behavioral AI n'est pas actif sur ce compte : la collecte est suspendue. Les données déjà reçues restent conservées.",
      }); return;
    }
    res.json({
      installed,
      totalEvents: total,
      lastEventAt: last_event,
      entitled: ent === "granted",
      ingesting: ent === "granted",
      status: installed ? "active" : "snippet_not_installed",
      message: installed
        ? `Snippet actif — ${total} événements reçus.`
        : "Snippet non installé. Collez le snippet sur votre site et publiez les changements.",
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch behavioral status" });
  }
});

// Gate scoped to /behavioral/* only — must NOT be a path-less catch-all or it intercepts
// every unmatched route that reaches this router (26+ route files mounted after it in index.ts).
router.use("/behavioral", requireAddon("behavioralAI", "Behavioral AI"));

async function siteBelongsToOrg(req: Request, orgId: string, siteUrl: string): Promise<boolean> {
  const { rows } = await (req as OrgReq).orgDb(
    `SELECT 1 FROM behavior_site_tokens WHERE org_id = $1 AND site_url = $2 LIMIT 1`,
    [orgId, siteUrl]
  );
  return rows.length > 0;
}

router.get("/behavioral/insights", async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    if (!siteUrl?.trim()) { res.status(400).json({ error: "siteUrl required" }); return; }
    const periodRaw = req.query["periodDays"];
    const periodDays = periodRaw == null ? 30 : Number(periodRaw);
    if (![7, 30, 90].includes(periodDays)) {
      res.status(400).json({ error: "periodDays must be 7, 30, or 90" }); return;
    }
    const reqOrgId = (req as OrgReq).orgId ?? "default";
    if (!(await siteBelongsToOrg(req, reqOrgId, siteUrl))) {
      res.status(404).json({ error: "Site not found" }); return;
    }
    const data = await getBehaviorInsights(reqOrgId, siteUrl, periodDays);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to fetch behavioral analytics" });
  }
});

router.post("/behavioral/funnels/analyze", async (req: Request, res: Response) => {
  const { siteUrl, steps } = req.body ?? {};
  const periodDays = Number(req.body?.periodDays ?? 30);
  if (typeof siteUrl !== "string" || !siteUrl.trim()) {
    res.status(400).json({ error: "siteUrl required" }); return;
  }
  if (![7, 30, 90].includes(periodDays)) {
    res.status(400).json({ error: "periodDays must be 7, 30, or 90" }); return;
  }
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6) {
    res.status(400).json({ error: "Provide 2 to 6 funnel steps" }); return;
  }
  const normalizedSteps = [];
  for (const [index, step] of steps.entries()) {
    if (!step || typeof step !== "object" ||
        typeof step.eventType !== "string" ||
        !ALLOWED_BEHAVIOR_FUNNEL_EVENTS.has(step.eventType) ||
        (step.page != null && (typeof step.page !== "string" || step.page.length > 200))) {
      res.status(400).json({ error: `Invalid funnel step at position ${index + 1}` }); return;
    }
    normalizedSteps.push({
      label: typeof step.label === "string" && step.label.trim()
        ? step.label.trim().slice(0, 80) : step.eventType,
      eventType: step.eventType,
      ...(typeof step.page === "string" && step.page.trim() ? { page: step.page.trim() } : {}),
    });
  }
  const orgId = (req as OrgReq).orgId ?? "default";
  try {
    if (!(await siteBelongsToOrg(req, orgId, siteUrl))) {
      res.status(404).json({ error: "Site not found" }); return;
    }
    const result = await analyzeBehaviorFunnel(orgId, siteUrl, periodDays, normalizedSteps);
    res.json(result);
  } catch {
    res.status(500).json({ error: "Behavioral funnel analysis failed" });
  }
});

router.post("/behavioral/generate-insights", async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  const periodRaw = req.body?.periodDays ?? 7;
  const periodDays = Number(periodRaw);
  if (typeof siteUrl !== "string" || !siteUrl.trim()) { res.status(400).json({ error: "siteUrl required" }); return; }
  if (![7, 30, 90].includes(periodDays)) { res.status(400).json({ error: "periodDays must be 7, 30, or 90" }); return; }
  const reqOrgId = (req as OrgReq).orgId ?? "default";
  try {
    if (!(await siteBelongsToOrg(req, reqOrgId, siteUrl))) {
      res.status(404).json({ error: "Site not found" }); return;
    }
    const userId = (req as Request & { userId?: string }).userId ?? "system";
    const result = await generateBehaviorInsights(reqOrgId, siteUrl, userId, periodDays);
    res.json({ ok: true, ...result });
  } catch {
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

export default router;
