import { Router, type Request, type Response } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { randomBytes } from "crypto";
import {
  trackBehaviorEvent, upsertSession, generateBehaviorInsights, getBehaviorInsights,
} from "../services/behavioral-service.js";
import { db, behaviorSiteTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAddon } from "../middlewares/planGate.js";
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

// ── Timestamp + per-site nonce store ─────────────────────────────────────────
const MAX_TS_SKEW_MS = 5 * 60 * 1000;
const _usedNonces = new Map<string, number>();

function consumeNonce(siteUrl: string, nonce: string, tsMs: number): boolean {
  const now = Date.now();
  for (const [k, exp] of _usedNonces) {
    if (exp < now) _usedNonces.delete(k);
  }
  const key = `${siteUrl}|${nonce}`;
  if (_usedNonces.has(key)) return false;
  _usedNonces.set(key, tsMs + MAX_TS_SKEW_MS);
  return true;
}

// ── Short-lived session tokens ────────────────────────────────────────────────
const SESSION_TOKEN_TTL_MS = 5 * 60 * 1000;
interface SessionTokenEntry { siteUrl: string; allowedOrigin: string; exp: number; orgId: string; }
const _sessionTokens = new Map<string, SessionTokenEntry>();

function issueSessionToken(siteUrl: string, origin: string, orgId: string): { token: string; expiresAt: number } {
  const now = Date.now();
  for (const [k, v] of _sessionTokens) { if (v.exp < now) _sessionTokens.delete(k); }
  const token = randomBytes(32).toString("hex");
  const exp = now + SESSION_TOKEN_TTL_MS;
  _sessionTokens.set(token, { siteUrl, allowedOrigin: origin, exp, orgId });
  return { token, expiresAt: exp };
}

function validateSessionToken(token: string, siteUrl: string, origin: string): boolean {
  const entry = _sessionTokens.get(token);
  if (!entry) return false;
  if (entry.exp < Date.now()) { _sessionTokens.delete(token); return false; }
  if (entry.siteUrl !== siteUrl || entry.allowedOrigin !== origin) return false;
  return true;
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
  if (!consumeNonce(siteKey, nonce, tsNum)) {
    res.status(403).json({ error: "Nonce already used — replay rejected" }); return;
  }
  const canonical = `${siteKey}|${origin}|${tsNum}|${nonce}`;
  if (!verifyHmac(siteToken, canonical, sig)) {
    res.status(403).json({ error: "Invalid HMAC signature" }); return;
  }
  const resolvedOrgId = await lookupSiteToken(siteToken, siteKey);
  if (!resolvedOrgId) {
    res.status(403).json({ error: "Unregistered site or invalid credentials" }); return;
  }
  const { token, expiresAt } = issueSessionToken(siteKey, origin, resolvedOrgId);
  res.json({ sessionToken: token, expiresAt });
});

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
  const origin = req.headers["origin"] as string;
  const _evtEntry = _sessionTokens.get(sessionToken);
  if (!_evtEntry || _evtEntry.exp < Date.now() || _evtEntry.siteUrl !== siteUrl || _evtEntry.allowedOrigin !== origin) {
    res.status(403).json({ error: "Invalid or expired session token — call POST /behavioral/token to refresh" }); return;
  }
  const eventOrgId = _evtEntry.orgId;
  const tsNum = Number(ts);
  if (!ts || isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_TS_SKEW_MS) {
    res.status(403).json({ error: "Timestamp missing or outside acceptable window" }); return;
  }
  if (!nonce || !consumeNonce(siteUrl, nonce, tsNum)) {
    res.status(403).json({ error: "Missing nonce or nonce already used — replay rejected" }); return;
  }
  try {
    await trackBehaviorEvent({ sessionId, orgId: eventOrgId, siteUrl, page, eventType, element, xPos, yPos, scrollDepth, timeOnPage, metadata });
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to track event" });
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
  const _sessEntry = _sessionTokens.get(sessionToken);
  if (!_sessEntry || _sessEntry.exp < Date.now() || _sessEntry.siteUrl !== siteUrl || _sessEntry.allowedOrigin !== origin) {
    res.status(403).json({ error: "Invalid or expired session token — call POST /behavioral/token to refresh" }); return;
  }
  const sessionOrgId = _sessEntry.orgId;
  const tsNum = Number(ts);
  if (!ts || isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_TS_SKEW_MS) {
    res.status(403).json({ error: "Timestamp missing or outside acceptable window" }); return;
  }
  if (!nonce || !consumeNonce(siteUrl, nonce, tsNum)) {
    res.status(403).json({ error: "Missing nonce or nonce already used — replay rejected" }); return;
  }
  try {
    await upsertSession({ id, orgId: sessionOrgId, siteUrl, userAgent, deviceType, country });
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
router.get("/behavioral/snippet", async (req: Request, res: Response) => {
  const { siteUrl } = req.query as { siteUrl?: string };
  if (!siteUrl) { res.status(400).json({ error: "siteUrl query param required" }); return; }

  const orgId = req.orgId ?? "default";
  const plainToken = randomBytes(32).toString("hex");
  const tokenHash  = hashToken(plainToken);

  try {
    // Cross-tenant ownership guard using req.orgDb (RLS-enforced)
    const existing = await orgDb(req)(
      `SELECT org_id FROM behavior_site_tokens WHERE site_url=$1 LIMIT 1`,
      [siteUrl]
    );
    if (existing.rows[0] && (existing.rows[0] as Record<string, unknown>).org_id !== orgId) {
      res.status(403).json({ error: "This site URL is already registered to another organization" }); return;
    }

    await orgDb(req)(
      `INSERT INTO behavior_site_tokens (token_hash, site_url, org_id, created_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (site_url) DO UPDATE SET token_hash=$1, org_id=$3, created_at=now(), last_used_at=NULL`,
      [tokenHash, siteUrl, orgId]
    );

    try { behavioralOriginAllowlist.add(new URL(siteUrl).origin); } catch {}
  } catch {
    if (res.headersSent) return;
    res.status(500).json({ error: "Failed to provision site token" }); return;
  }

  const baseUrl = process.env["REPLIT_DEV_DOMAIN"]
    ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
    : (process.env["PUBLIC_BASE_URL"] ?? "https://app.flowpoint.io");
  const apiBase = `${baseUrl}/api`;

  const snippet = `<!-- FlowPoint Behavioral Analytics — paste before </body> -->
<script>
(function(w,d,s,u,k){
  var _fpSid='fp_'+Math.random().toString(36).slice(2,10);
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
    fetch(u+'/behavioral/event',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true}).catch(function(){});
  }
  async function _fpSession(){
    if(!_fpToken||Date.now()>=_fpTokenExp)await _fpGetToken();
    if(!_fpToken)return;
    var ts=Date.now(),nonce=Math.random().toString(36).slice(2,10);
    var payload=JSON.stringify({id:_fpSid,siteUrl:s,sessionToken:_fpToken,ts:ts,nonce:nonce,userAgent:navigator.userAgent,deviceType:/Mobi|Android/i.test(navigator.userAgent)?'mobile':'desktop'});
    fetch(u+'/behavioral/session',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true}).catch(function(){});
  }
  _fpSession();
  _fpSend('page_view',{metadata:{referrer:document.referrer,title:document.title}});
  d.addEventListener('click',function(e){
    var now=Date.now();var el=e.target&&(e.target.id||e.target.className||e.target.tagName)||'';
    var key=Math.round(e.clientX/20)+'_'+Math.round(e.clientY/20);
    if(!_fpRageMap[key])_fpRageMap[key]=0;_fpRageMap[key]++;
    if(now-_fpRageTs<500&&_fpRageMap[key]>=3){_fpSend('rage_click',{xPos:e.clientX,yPos:e.clientY,element:el});_fpRageMap[key]=0;}
    _fpRageTs=now;
    _fpSend('click',{xPos:e.clientX,yPos:e.clientY,element:el});
  });
  var _fpScroll=0;d.addEventListener('scroll',function(){
    var pct=Math.round((w.scrollY/(d.body.scrollHeight-w.innerHeight||1))*100);
    if(pct>_fpScroll+20){_fpScroll=pct;_fpSend('scroll_depth',{scrollDepth:pct});}
  });
  d.querySelectorAll('form').forEach(function(f){
    f.addEventListener('submit',function(){_fpSend('form_submit',{element:f.id||f.className||'form'});});
  });
  w.addEventListener('beforeunload',function(){
    _fpSend('session_end',{timeOnPage:Math.round((Date.now()-_fpStart)/1000)});
  });
})(window,document,'${siteUrl}','${apiBase}','${plainToken}');
</script>`;

  res.json({
    siteUrl, snippet,
    instructions: [
      "1. Copiez le snippet ci-dessus.",
      "2. Collez-le juste avant la balise </body> sur chaque page de votre site.",
      "3. Publiez les changements — les premiers événements apparaîtront dans FlowPoint en quelques minutes.",
      "4. Pour vérifier l'installation, consultez GET /api/behavioral/status?siteUrl=<votre-site>.",
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

    res.json({
      installed,
      totalEvents: total,
      lastEventAt: last_event,
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

router.get("/behavioral/insights", async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    const reqOrgId = (req as OrgReq).orgId ?? "default";
    if (siteUrl) {
      const { rows } = await (req as OrgReq).orgDb(
        `SELECT 1 FROM behavior_site_tokens WHERE org_id = $1 AND site_url = $2 LIMIT 1`,
        [reqOrgId, siteUrl]
      );
      if (rows.length === 0) { res.status(404).json({ error: "Site not found" }); return; }
    }
    const data = await getBehaviorInsights(reqOrgId, siteUrl);
    res.json(data);
  } catch {
    res.json({ insights: [], sessions: 0, events: 0, count: 0 });
  }
});

router.post("/behavioral/generate-insights", async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  const reqOrgId = (req as OrgReq).orgId ?? "default";
  try {
    await generateBehaviorInsights(reqOrgId, siteUrl);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

export default router;
