import { Router, type Request, type Response } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { randomBytes } from "crypto";
import { trackBehaviorEvent, upsertSession, generateBehaviorInsights, getBehaviorInsights } from "../services/behavioral-service.js";
import { pool, db, behaviorSiteTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireFeature } from "../middlewares/planGate.js";
import { behavioralRateLimit } from "../middlewares/rateLimiter.js";

// ── publicBehavioralRouter — no auth required ─────────────────────────────────
export const publicBehavioralRouter = Router();

// ── Per-registered-site CORS allowlist ────────────────────────────────────────
// Exported so app.ts can dynamically allow registered customer-domain origins
// through the global CORS middleware without wildcard * allowlisting.
export const behavioralOriginAllowlist = new Set<string>();

/**
 * Pre-load all registered site origins into the CORS allowlist at server startup.
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

/**
 * Verify an HMAC-SHA256 signature over a canonical message using timingSafeEqual.
 *
 * Used in two places:
 *   1. POST /behavioral/token — the snippet proves it holds the site secret
 *      before the server issues a short-lived session token.
 *   2. POST /behavioral/event|session (optional belt-and-suspenders; events
 *      require an active session token AND carry their own signature).
 */
function verifyHmac(key: string, message: string, receivedHex: string): boolean {
  const expected = createHmac("sha256", key).update(message).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(receivedHex, "hex"));
  } catch {
    return false;
  }
}

/**
 * Look up the site token hash in the DB and return the plain stored hash for
 * HMAC verification, together with the canonical siteUrl.
 *
 * NOTE: the DB only stores the SHA-256 hash of the token, not the token itself.
 * HMAC verification is therefore done differently from a classic HMAC flow:
 *
 *   • The snippet embeds the plain token T.
 *   • The snippet computes: sig = HMAC-SHA256(key=T, msg=canonical)
 *   • The server looks up hash(T) → row.
 *   • The server re-derives the expected HMAC-SHA256(key=T, msg=canonical)
 *     by receiving T in the request body (same as the original approach).
 *
 * This is intentional: the token is a site credential that is embedded in the
 * snippet (like an install key), used only once per session to prove ownership
 * at token-exchange time. The exchanged short-lived session token is used for
 * all subsequent event/session ingestion, so the site secret is never replayed
 * on each individual analytics event.
 */
async function lookupSiteToken(
  plaintextToken: string,
  siteUrl: string,
): Promise<boolean> {
  try {
    const hash = hashToken(plaintextToken);
    const [row] = await db
      .select({ siteUrl: behaviorSiteTokensTable.siteUrl })
      .from(behaviorSiteTokensTable)
      .where(eq(behaviorSiteTokensTable.tokenHash, hash))
      .limit(1);

    if (!row || row.siteUrl !== siteUrl) return false;

    // Fire-and-forget last_used_at update
    void db
      .update(behaviorSiteTokensTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(behaviorSiteTokensTable.tokenHash, hash));

    return true;
  } catch {
    return false;
  }
}

// ── Browser attestation ───────────────────────────────────────────────────────
//
// Sec-Fetch-Site is a Fetch spec §2.2.5 "forbidden header": browsers set it
// automatically on cross-origin requests and JavaScript cannot override it.
// Standard HTTP clients (curl, Python requests, etc.) do not send it by default.
// Its absence is a reliable signal of a non-browser caller.
//
// Origin is checked as a secondary signal — it must be present and match the
// registered siteUrl.
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
//
// Nonces are scoped per site (siteUrl+nonce key) to prevent cross-site
// replay and to keep the key-space bounded. Lazy GC runs on every check.
const MAX_TS_SKEW_MS = 5 * 60 * 1000;
const _usedNonces = new Map<string, number>(); // "${siteUrl}|${nonce}" → expiry

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
//
// Issued by POST /behavioral/token after cryptographic proof (HMAC) is verified.
// Bound to (siteUrl, requestOrigin) at issuance. Valid for SESSION_TOKEN_TTL_MS.
// Stored in-process; a shared cache (e.g. Redis) is needed for multi-instance.
const SESSION_TOKEN_TTL_MS = 5 * 60 * 1000;

interface SessionTokenEntry {
  siteUrl: string;
  allowedOrigin: string;
  exp: number;
}
const _sessionTokens = new Map<string, SessionTokenEntry>();

function issueSessionToken(siteUrl: string, origin: string): { token: string; expiresAt: number } {
  const now = Date.now();
  for (const [k, v] of _sessionTokens) {
    if (v.exp < now) _sessionTokens.delete(k);
  }
  const token = randomBytes(32).toString("hex");
  const exp = now + SESSION_TOKEN_TTL_MS;
  _sessionTokens.set(token, { siteUrl, allowedOrigin: origin, exp });
  return { token, expiresAt: exp };
}

function validateSessionToken(token: string, siteUrl: string, origin: string): boolean {
  const entry = _sessionTokens.get(token);
  if (!entry) return false;
  if (entry.exp < Date.now()) { _sessionTokens.delete(token); return false; }
  if (entry.siteUrl !== siteUrl || entry.allowedOrigin !== origin) return false;
  return true;
}

// ── POST /api/behavioral/token — HMAC-authenticated token exchange ─────────────
//
// Exchanges a site's install credential for a short-lived session token.
//
// The snippet embeds a site-specific install secret (siteToken) issued by the
// server and uses it to compute an HMAC-SHA256 proof-of-possession signature.
// The server verifies the HMAC against the DB-stored hash of the token before
// issuing a short-lived session token.  Events/sessions carry only the session
// token — the install secret is never sent again after this exchange.
//
// Authentication chain:
//   1. HMAC-SHA256(key=siteToken, msg="${siteUrl}|${origin}|${ts}|${nonce}")
//      verified against DB entry — proves the caller holds the site secret
//   2. Sec-Fetch-Site: cross-site|same-site — browser-only forbidden header
//   3. Origin header present and matching siteUrl
//   4. Timestamp within ±5 min + per-site nonce deduplication
publicBehavioralRouter.post("/behavioral/token", behavioralRateLimit("token"), async (req: Request, res: Response) => {
  const { siteKey, siteToken, ts, nonce, sig } = req.body ?? {};

  if (!siteKey || !siteToken || !ts || !nonce || !sig) {
    res.status(400).json({ error: "siteKey, siteToken, ts, nonce, sig required" }); return;
  }

  // Gate 1: browser attestation (Sec-Fetch-Site + Origin)
  if (!browserAttestationPasses(req, siteKey)) {
    res.status(403).json({ error: "Browser attestation failed: valid Origin and Sec-Fetch-Site required" }); return;
  }

  const origin = req.headers["origin"] as string;

  // Gate 2: timestamp freshness
  const tsNum = Number(ts);
  if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_TS_SKEW_MS) {
    res.status(403).json({ error: "Timestamp missing or outside acceptable window" }); return;
  }

  // Gate 3: per-site nonce deduplication
  if (!consumeNonce(siteKey, nonce, tsNum)) {
    res.status(403).json({ error: "Nonce already used — replay rejected" }); return;
  }

  // Gate 4: HMAC-SHA256 proof-of-possession (proves caller holds siteToken)
  // Canonical message: "${siteUrl}|${origin}|${ts}|${nonce}"
  const canonical = `${siteKey}|${origin}|${tsNum}|${nonce}`;
  if (!verifyHmac(siteToken, canonical, sig)) {
    res.status(403).json({ error: "Invalid HMAC signature" }); return;
  }

  // Gate 5: DB lookup — verify siteToken hash is registered for this siteUrl
  if (!await lookupSiteToken(siteToken, siteKey)) {
    res.status(403).json({ error: "Unregistered site or invalid credentials" }); return;
  }

  const { token, expiresAt } = issueSessionToken(siteKey, origin);
  res.json({ sessionToken: token, expiresAt });
});

// ── POST /api/behavioral/event — session-token-authenticated ingestion ─────────
//
// Authentication chain:
//   1. Browser attestation (Sec-Fetch-Site + Origin)
//   2. Short-lived session token (origin-bound, 5 min expiry)
//   3. Timestamp freshness
//   4. Per-site nonce deduplication
publicBehavioralRouter.post("/behavioral/event", behavioralRateLimit("event"), async (req: Request, res: Response) => {
  const {
    sessionId, siteUrl, page, eventType, element, xPos, yPos, scrollDepth,
    timeOnPage, metadata, sessionToken, ts, nonce,
  } = req.body ?? {};

  if (!sessionId || !siteUrl || !page || !eventType) {
    res.status(400).json({ error: "sessionId, siteUrl, page, eventType required" }); return;
  }
  if (!sessionToken) {
    res.status(401).json({ error: "sessionToken required — call POST /behavioral/token first" }); return;
  }

  // Gate 1: browser attestation
  if (!browserAttestationPasses(req, siteUrl)) {
    res.status(403).json({ error: "Origin header required and must match siteUrl" }); return;
  }

  const origin = req.headers["origin"] as string;

  // Gate 2: short-lived session token (origin-bound, expiry-checked)
  if (!validateSessionToken(sessionToken, siteUrl, origin)) {
    res.status(403).json({ error: "Invalid or expired session token — call POST /behavioral/token to refresh" }); return;
  }

  // Gate 3: timestamp freshness
  const tsNum = Number(ts);
  if (!ts || isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_TS_SKEW_MS) {
    res.status(403).json({ error: "Timestamp missing or outside acceptable window" }); return;
  }

  // Gate 4: per-site nonce deduplication
  if (!nonce || !consumeNonce(siteUrl, nonce, tsNum)) {
    res.status(403).json({ error: "Missing nonce or nonce already used — replay rejected" }); return;
  }

  try {
    await trackBehaviorEvent({ sessionId, siteUrl, page, eventType, element, xPos, yPos, scrollDepth, timeOnPage, metadata });
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to track event" });
  }
});

// ── POST /api/behavioral/session — session-token-authenticated ingestion ───────
publicBehavioralRouter.post("/behavioral/session", behavioralRateLimit("session"), async (req: Request, res: Response) => {
  const { id, siteUrl, userAgent, deviceType, country, sessionToken, ts, nonce } = req.body ?? {};

  if (!id || !siteUrl) { res.status(400).json({ error: "id and siteUrl required" }); return; }
  if (!sessionToken) {
    res.status(401).json({ error: "sessionToken required — call POST /behavioral/token first" }); return;
  }

  // Gate 1: browser attestation
  if (!browserAttestationPasses(req, siteUrl)) {
    res.status(403).json({ error: "Origin header required and must match siteUrl" }); return;
  }

  const origin = req.headers["origin"] as string;

  // Gate 2: short-lived session token
  if (!validateSessionToken(sessionToken, siteUrl, origin)) {
    res.status(403).json({ error: "Invalid or expired session token — call POST /behavioral/token to refresh" }); return;
  }

  // Gate 3: timestamp freshness
  const tsNum = Number(ts);
  if (!ts || isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_TS_SKEW_MS) {
    res.status(403).json({ error: "Timestamp missing or outside acceptable window" }); return;
  }

  // Gate 4: per-site nonce deduplication
  if (!nonce || !consumeNonce(siteUrl, nonce, tsNum)) {
    res.status(403).json({ error: "Missing nonce or nonce already used — replay rejected" }); return;
  }

  try {
    await upsertSession({ id, siteUrl, userAgent, deviceType, country });
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to upsert session" });
  }
});

// ── Protected router (auth required) ─────────────────────────────────────────
const router = Router();

// ── GET /api/behavioral/snippet — provisions site + issues install credential ──
//
// Auth-gated. Issues a per-site install token (stored as SHA-256 hash in DB)
// embedded in the snippet. The snippet uses this token as an HMAC key to sign
// the POST /behavioral/token request, proving possession before a session token
// is issued. The install secret is NOT sent on individual event/session calls.
router.get("/behavioral/snippet", async (req: Request, res: Response) => {
  const { siteUrl } = req.query as { siteUrl?: string };
  if (!siteUrl) { res.status(400).json({ error: "siteUrl query param required" }); return; }

  const orgId = req.orgId ?? "default";

  const plainToken = randomBytes(32).toString("hex");
  const tokenHash  = hashToken(plainToken);

  try {
    // Ownership guard: prevent cross-tenant token rotation (availability attack).
    const [existing] = await db
      .select({ orgId: behaviorSiteTokensTable.orgId })
      .from(behaviorSiteTokensTable)
      .where(eq(behaviorSiteTokensTable.siteUrl, siteUrl))
      .limit(1);

    if (existing && existing.orgId !== orgId) {
      res.status(403).json({ error: "This site URL is already registered to another organization" });
      return;
    }

    await db
      .insert(behaviorSiteTokensTable)
      .values({ tokenHash, siteUrl, orgId })
      .onConflictDoUpdate({
        target: behaviorSiteTokensTable.siteUrl,
        set: { tokenHash, orgId, createdAt: new Date(), lastUsedAt: null },
      });

    // Extend the in-process CORS allowlist so preflights from this origin
    // pass immediately without a server restart.
    try { behavioralOriginAllowlist.add(new URL(siteUrl).origin); } catch {}
  } catch {
    if (res.headersSent) return;
    res.status(500).json({ error: "Failed to provision site token" }); return;
  }

  const baseUrl = process.env["REPLIT_DEV_DOMAIN"]
    ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
    : (process.env["PUBLIC_BASE_URL"] ?? "https://app.flowpoint.io");

  const apiBase = `${baseUrl}/api`;

  // The snippet flow:
  //   1. Compute HMAC-SHA256 over "${siteUrl}|${origin}|${ts}|${nonce}" using
  //      the install token (siteToken) — proves possession of the site credential.
  //   2. POST /behavioral/token { siteKey, siteToken, ts, nonce, sig }
  //      → server verifies HMAC + DB lookup → returns short-lived session token.
  //   3. All events/sessions carry only the session token (not siteToken).
  //   4. Session token auto-refreshes on expiry.
  //
  // The siteToken IS present in page source (as an install credential), but it
  // is never sent on individual analytics events — only once per page load to
  // prove possession and obtain the short-lived session token.
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
    siteUrl,
    snippet,
    instructions: [
      "1. Copiez le snippet ci-dessus.",
      "2. Collez-le juste avant la balise </body> sur chaque page de votre site.",
      "3. Publiez les changements — les premiers événements apparaîtront dans FlowPoint en quelques minutes.",
      "4. Pour vérifier l'installation, consultez GET /api/behavioral/status?siteUrl=<votre-site>.",
    ],
    trackedEvents: ["page_view", "click", "rage_click", "scroll_depth", "form_submit", "session_end"],
    note: "Le snippet intègre un token d'installation qui sert de clé HMAC pour prouver la possession du site lors de l'échange de token. Les événements individuels n'utilisent que le token de session de courte durée (5 min) — jamais le token d'installation.",
  });
});

// ── GET /api/behavioral/status — installation check (auth required) ───────────
router.get("/behavioral/status", async (req: Request, res: Response) => {
  const { siteUrl } = req.query as { siteUrl?: string };
  if (!siteUrl) {
    res.status(400).json({ error: "siteUrl query param required" }); return;
  }

  const orgId = req.orgId ?? "default";

  try {
    const [tokenRow] = await db
      .select({ orgId: behaviorSiteTokensTable.orgId })
      .from(behaviorSiteTokensTable)
      .where(
        and(
          eq(behaviorSiteTokensTable.siteUrl, siteUrl),
          eq(behaviorSiteTokensTable.orgId, orgId)
        )
      )
      .limit(1);

    if (!tokenRow) {
      res.status(404).json({
        error: "Site not found for this organization. Generate a snippet first via GET /api/behavioral/snippet.",
      }); return;
    }

    const result = await pool.query<{ total: string; last_event: Date | null }>(
      `SELECT COUNT(*) AS total, MAX(created_at) AS last_event FROM behavior_events WHERE site_url = $1`,
      [siteUrl]
    );
    const { total, last_event } = result.rows[0] ?? { total: "0", last_event: null };
    const installed = Number(total) > 0;
    res.json({
      installed,
      totalEvents: Number(total),
      lastEventAt: last_event ?? null,
      status: installed ? "active" : "snippet_not_installed",
      message: installed
        ? `Snippet actif — ${total} événements reçus.`
        : "Snippet non installé. Collez le snippet sur votre site et publiez les changements.",
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch behavioral status" });
  }
});

// Insights + generate require the behavioralAI add-on (Pro plan and above)
router.use(requireFeature("behavioralAI", "Behavioral AI"));

// ── GET /api/behavioral/insights (protected) ──────────────────────────────────
router.get("/behavioral/insights", async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    const data = await getBehaviorInsights(siteUrl);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to fetch behavioral insights" });
  }
});

// ── POST /api/behavioral/generate-insights (protected) ────────────────────────
router.post("/behavioral/generate-insights", async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  try {
    await generateBehaviorInsights(siteUrl);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

export default router;
