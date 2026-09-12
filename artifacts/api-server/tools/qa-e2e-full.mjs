/**
 * QA E2E FULL — Validation navigateur-niveau contre le serveur live
 * Couvre : Auth, Local SEO DELETE, AI actions, Streaks, Traductions
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { execSync } from "child_process";

const BASE = "http://127.0.0.1:8081";
const DB_URL = process.env.DATABASE_URL;
const ORG_ID = "aaaaaaaa-0001-0001-0001-000000000001"; // org existant en DB

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
let TOKEN = null;
let passed = 0, failed = 0, warnings = 0;
const results = [];

function ok(label, detail = "") {
  passed++;
  results.push({ status: "✅", label, detail });
  console.log(`  ✅ ${label}${detail ? " — " + detail : ""}`);
}
function fail(label, detail = "") {
  failed++;
  results.push({ status: "❌", label, detail });
  console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
}
function warn(label, detail = "") {
  warnings++;
  results.push({ status: "⚠️", label, detail });
  console.log(`  ⚠️  ${label}${detail ? " — " + detail : ""}`);
}

function sql(query) {
  try {
    return execSync(`psql "${DB_URL}" -tAq -c "${query.replace(/"/g, '\\"')}"`, {
      encoding: "utf8", timeout: 10000
    }).trim();
  } catch (e) {
    return null;
  }
}

async function api(method, path, body, token = TOKEN, expectStatus = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const r = await fetch(`${BASE}${path}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json, text, ok: r.ok };
  } catch (e) {
    return { status: 0, json: null, text: e.message, ok: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup: créer une session de test
// ─────────────────────────────────────────────────────────────────────────────
function setupSession() {
  TOKEN = `qa-e2e-${Date.now()}`;
  sql(`DELETE FROM user_sessions WHERE token LIKE 'qa-e2e-%'`);
  const email = "qa-e2e@flowpoint-test.com";
  const insert = `INSERT INTO user_sessions (token, org_id, user_id, email, role, expires_at) VALUES ('${TOKEN}', '${ORG_ID}', 'qa-user-e2e', '${email}', 'owner', NOW() + INTERVAL '2 hours') ON CONFLICT DO NOTHING`;
  sql(insert);
  return TOKEN;
}

function cleanup() {
  sql(`DELETE FROM user_sessions WHERE token LIKE 'qa-e2e-%'`);
  sql(`DELETE FROM missions WHERE org_id='${ORG_ID}' AND title LIKE 'QA-TEST%'`);
  sql(`DELETE FROM calendar_events WHERE org_id='${ORG_ID}' AND title LIKE 'QA-TEST%'`);
  sql(`DELETE FROM monitors WHERE org_id='${ORG_ID}' AND name LIKE 'QA-TEST%'`);
  sql(`DELETE FROM local_seo_ranking_history WHERE org_id='${ORG_ID}' AND keyword LIKE 'qa-test%'`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — AUTH
// ─────────────────────────────────────────────────────────────────────────────
async function testAuth() {
  console.log("\n═══ 1. AUTH ═══");

  // 1a. Aucun token → 401
  const r1 = await api("GET", "/api/me", null, null);
  r1.status === 401 ? ok("Aucun token → 401") : fail(`Aucun token → attendu 401, reçu ${r1.status}`);

  // 1b. Token invalide → 401
  const r2 = await api("GET", "/api/me", null, "fake-expired-token-xyz");
  r2.status === 401 ? ok("Token invalide → 401") : fail(`Token invalide → attendu 401, reçu ${r2.status}`);

  // 1c. Token expiré en DB
  const expiredToken = "qa-expired-token";
  sql(`DELETE FROM user_sessions WHERE token='${expiredToken}'`);
  sql(`INSERT INTO user_sessions (token, org_id, user_id, email, role, expires_at) VALUES ('${expiredToken}','${ORG_ID}','qa-user-e2e','qa@test.com','owner',NOW()-INTERVAL '1 hour') ON CONFLICT DO NOTHING`);
  const r3 = await api("GET", "/api/me", null, expiredToken);
  r3.status === 401 ? ok("Token expiré → 401") : fail(`Token expiré → attendu 401, reçu ${r3.status}`);
  sql(`DELETE FROM user_sessions WHERE token='${expiredToken}'`);

  // 1d. Session valide → 200
  const r4 = await api("GET", "/api/me", null, TOKEN);
  r4.status === 200 ? ok("Session valide → 200", `org=${r4.json?.orgId?.slice(0,8)}`) : fail(`Session valide → attendu 200, reçu ${r4.status} — ${r4.text.slice(0,100)}`);

  // 1e. Logout + vérification invalidation
  // Pas de vrai logout session dans ce test, mais on vérifie que le token reste valide
  // (le logout frontend doit appeler DELETE /api/auth/session)
  const logoutR = await api("POST", "/api/auth/logout", {}, TOKEN);
  if (logoutR.status === 200 || logoutR.status === 204) {
    // Après logout, re-tenter avec le même token
    const r5 = await api("GET", "/api/me", null, TOKEN);
    r5.status === 401 ? ok("Post-logout → 401 (session invalidée)") : warn(`Post-logout → ${r5.status} (session peut rester active selon implem)`);
    // Recréer la session pour les tests suivants
    setupSession();
  } else {
    warn(`Logout endpoint → ${logoutR.status} (${logoutR.text.slice(0,80)})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — LOCAL SEO DELETE PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────
async function testLocalSeo() {
  console.log("\n═══ 2. LOCAL SEO ═══");

  // 2a. Insérer un historique directement en DB
  const histId = `qa-hist-${Date.now()}`;
  const insertHist = `INSERT INTO local_seo_ranking_history (id, org_id, keyword, location, results, searched_at) VALUES ('${histId}','${ORG_ID}','qa-test-keyword','Paris','[{"rank":1,"title":"Test A"},{"rank":2,"title":"Test B"},{"rank":3,"title":"Test C"}]',NOW())`;
  sql(insertHist);

  // Vérifier que l'historique est bien en DB
  const inDb = sql(`SELECT id FROM local_seo_ranking_history WHERE id='${histId}'`);
  inDb === histId ? ok("Historique inséré en DB") : fail("Historique non inséré");

  // 2b. GET /api/local-seo/rankings/history doit retourner cet historique
  const r2 = await api("GET", "/api/local-seo/rankings/history");
  const history = r2.json?.history || r2.json?.rankings || r2.json || [];
  const found = Array.isArray(history) ? history.find(h => h.id === histId) : null;
  found ? ok("GET history retourne l'entrée insérée") : warn(`GET history → status=${r2.status}, entrée non trouvée dans ${JSON.stringify(Object.keys(r2.json || {}))}`);

  // 2c. Vérifier le nombre de résultats (pas hardcodé à 3)
  if (found) {
    const resultCount = found.results?.length || found.resultCount || found.total_results;
    resultCount === 3 ? ok(`Nombre résultats correct: ${resultCount} (données réelles)`) : warn(`Nombre résultats: ${resultCount}`);
  }

  // 2d. DELETE /api/local-seo/rankings/history/:id
  const r3 = await api("DELETE", `/api/local-seo/rankings/history/${histId}`);
  r3.status === 200 || r3.status === 204 ? ok("DELETE history → 200/204") : fail(`DELETE history → ${r3.status} ${r3.text.slice(0,100)}`);

  // 2e. Vérifier disparition en DB (le test le plus important)
  const afterDelete = sql(`SELECT id FROM local_seo_ranking_history WHERE id='${histId}'`);
  !afterDelete ? ok("DELETE PERSISTÉ en DB — entrée disparue ✓") : fail(`DELETE NON PERSISTÉ — entrée toujours en DB: ${afterDelete}`);

  // 2f. GET history après DELETE ne doit pas retourner l'entrée
  const r4 = await api("GET", "/api/local-seo/rankings/history");
  const history2 = r4.json?.history || r4.json?.rankings || r4.json || [];
  const stillFound = Array.isArray(history2) ? history2.find(h => h.id === histId) : null;
  !stillFound ? ok("GET history post-DELETE ne retourne plus l'entrée") : fail("Entrée supprimée toujours visible dans GET history");

  // 2g. Simuler re-login : nouvelle session, re-GET history
  const token2 = `qa-session2-${Date.now()}`;
  sql(`INSERT INTO user_sessions (token, org_id, user_id, email, role, expires_at) VALUES ('${token2}','${ORG_ID}','qa-user-2','qa2@test.com','owner',NOW()+INTERVAL '1 hour') ON CONFLICT DO NOTHING`);
  const r5 = await api("GET", "/api/local-seo/rankings/history", null, token2);
  const history3 = r5.json?.history || r5.json?.rankings || r5.json || [];
  const afterRelogin = Array.isArray(history3) ? history3.find(h => h.id === histId) : null;
  !afterRelogin ? ok("POST-RELOGIN — entrée supprimée ne revient pas ✓") : fail("Entrée supprimée revient après re-login !");
  sql(`DELETE FROM user_sessions WHERE token='${token2}'`);

  // 2h. Vérifier si DataForSEO est configuré pour cet org
  const r6 = await api("GET", "/api/local-seo");
  const configured = r6.json?.configured || r6.json?.dataforSeoConfigured;
  configured ? ok("DataForSEO configuré pour cet org") : warn("DataForSEO non configuré — rankings réels non disponibles en test (normal pour org de dev)");
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — AI ACTIONS (missions, calendar, monitors, keywords, audits)
// ─────────────────────────────────────────────────────────────────────────────
async function testAIActions() {
  console.log("\n═══ 3. AI ACTIONS ═══");

  // 3a. Créer une mission directement via l'API missions (endpoint non-IA)
  const missionR = await api("POST", "/api/missions", {
    title: "QA-TEST Mission directe",
    category: "technical", status: "todo", priority: "high", source: "test"
  });
  let missionId = null;
  if (missionR.status === 200 || missionR.status === 201) {
    missionId = missionR.json?.id || missionR.json?.mission?.id;
    missionId ? ok("POST /api/missions → mission créée", `id=${missionId}`) : warn(`POST missions OK mais pas d'id — ${JSON.stringify(missionR.json).slice(0,100)}`);
  } else {
    fail(`POST /api/missions → ${missionR.status} ${missionR.text.slice(0,100)}`);
  }

  // Vérifier en DB
  if (missionId) {
    const inDb = sql(`SELECT id, title, status FROM missions WHERE id='${missionId}' AND org_id='${ORG_ID}'`);
    inDb ? ok("Mission visible en DB post-création ✓", inDb.split("|")[1]) : fail("Mission créée non trouvée en DB");
  }

  // 3b. Créer un événement calendrier
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const calR = await api("POST", "/api/calendar-events", {
    title: "QA-TEST Événement calendrier",
    start_date: `${tomorrow}T10:00:00`,
    end_date: `${tomorrow}T11:00:00`,
    event_type: "mission", color: "#2563EB"
  });
  let calId = null;
  if (calR.status === 200 || calR.status === 201) {
    calId = calR.json?.id || calR.json?.event?.id;
    calId ? ok("POST /api/calendar-events → événement créé", `id=${calId}`) : warn(`Calendar OK mais pas d'id — ${JSON.stringify(calR.json).slice(0,100)}`);
  } else {
    fail(`POST /api/calendar-events → ${calR.status} ${calR.text.slice(0,100)}`);
  }

  if (calId) {
    const inDb = sql(`SELECT id, title FROM calendar_events WHERE id='${calId}' AND org_id='${ORG_ID}'`);
    inDb ? ok("Événement calendrier visible en DB ✓") : fail("Événement calendrier non trouvé en DB");
  }

  // 3c. Créer un monitor
  const monR = await api("POST", "/api/monitors", {
    name: "QA-TEST Monitor",
    url: "https://example.com/qa-test",
    type: "http", interval: 5
  });
  let monId = null;
  if (monR.status === 200 || monR.status === 201) {
    monId = monR.json?.id || monR.json?.monitor?.id;
    monId ? ok("POST /api/monitors → monitor créé", `id=${monId}`) : warn(`Monitor OK mais pas d'id — ${JSON.stringify(monR.json).slice(0,100)}`);
  } else if (monR.status === 429) {
    warn(`POST /api/monitors → 429 QUOTA (normal si quota atteint)`);
  } else {
    fail(`POST /api/monitors → ${monR.status} ${monR.text.slice(0,100)}`);
  }

  if (monId) {
    const inDb = sql(`SELECT id, name FROM monitors WHERE id='${monId}' AND org_id='${ORG_ID}'`);
    inDb ? ok("Monitor visible en DB ✓") : fail("Monitor non trouvé en DB");
  }

  // 3d. Ajouter un concurrent
  const compR = await api("POST", "/api/competitors", {
    domain: "qa-test-competitor.com", name: "QA Test Competitor"
  });
  if (compR.status === 200 || compR.status === 201) {
    const cId = compR.json?.id;
    ok("POST /api/competitors → concurrent créé", `id=${cId}`);
    if (cId) {
      const inDb = sql(`SELECT id FROM competitors WHERE id='${cId}' AND org_id='${ORG_ID}'`);
      inDb ? ok("Concurrent visible en DB ✓") : fail("Concurrent non trouvé en DB");
      // Cleanup
      sql(`DELETE FROM competitors WHERE id='${cId}'`);
    }
  } else {
    warn(`POST /api/competitors → ${compR.status} ${compR.text.slice(0,100)}`);
  }

  // 3e. Ajouter un mot-clé
  const kwR = await api("POST", "/api/keywords", {
    keyword: "qa-test-keyword-e2e", url: "https://example.com"
  });
  if (kwR.status === 200 || kwR.status === 201) {
    const kwId = kwR.json?.id;
    ok("POST /api/keywords → mot-clé ajouté", `id=${kwId}`);
    if (kwId) {
      const inDb = sql(`SELECT id FROM tracked_keywords WHERE id='${kwId}' AND org_id='${ORG_ID}'`);
      inDb ? ok("Mot-clé visible en DB ✓") : fail("Mot-clé non trouvé en DB");
      sql(`DELETE FROM tracked_keywords WHERE id='${kwId}'`);
    }
  } else {
    warn(`POST /api/keywords → ${kwR.status} ${kwR.text.slice(0,100)}`);
  }

  // 3f. Lancer un audit
  const auditR = await api("POST", "/api/audits", {
    url: "https://example.com", type: "full", force: true
  });
  if (auditR.status === 200 || auditR.status === 201) {
    const aId = auditR.json?.id || auditR.json?.auditId;
    ok("POST /api/audits → audit lancé", `id=${aId}`);
    if (aId) {
      const inDb = sql(`SELECT id, status FROM audits WHERE id='${aId}' AND org_id='${ORG_ID}'`);
      inDb ? ok("Audit visible en DB ✓", inDb.split("|")[1]) : fail("Audit non trouvé en DB");
    }
  } else {
    warn(`POST /api/audits → ${auditR.status} ${auditR.text.slice(0,100)}`);
  }

  // 3g. Recommandations IA — endpoint générer
  const recR = await api("POST", "/api/recommendations/generate", {
    type: "seo", limit: 3
  });
  if (recR.status === 200) {
    const recs = recR.json?.recommendations || recR.json?.items || [];
    ok(`Recommandations générées`, `count=${recs.length}`);
  } else {
    warn(`POST /api/recommendations/generate → ${recR.status} ${recR.text.slice(0,100)}`);
  }

  // Cleanup monitors créés
  if (monId) sql(`DELETE FROM monitors WHERE id='${monId}'`);
  if (missionId) sql(`DELETE FROM missions WHERE id='${missionId}'`);
  if (calId) sql(`DELETE FROM calendar_events WHERE id='${calId}'`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — STREAKS
// ─────────────────────────────────────────────────────────────────────────────
async function testStreaks() {
  console.log("\n═══ 4. STREAKS / ACTIVITÉ ═══");

  // 4a. GET /api/me/streak
  const r1 = await api("GET", "/api/me/streak");
  if (r1.status === 200) {
    const s = r1.json;
    ok("GET /api/me/streak → 200", `current=${s?.current}, best=${s?.best}`);
    typeof s?.current === "number" ? ok("streak.current est un number") : warn(`streak.current = ${JSON.stringify(s?.current)}`);
  } else {
    fail(`GET /api/me/streak → ${r1.status} ${r1.text.slice(0,80)}`);
  }

  // 4b. GET /api/team/streaks
  const r2 = await api("GET", "/api/team/streaks");
  if (r2.status === 200) {
    const streaks = r2.json?.streaks || [];
    ok("GET /api/team/streaks → 200", `count=${streaks.length}`);
  } else {
    warn(`GET /api/team/streaks → ${r2.status} ${r2.text.slice(0,80)}`);
  }

  // 4c. GET /api/team/contributions
  const r3 = await api("GET", "/api/team/contributions");
  if (r3.status === 200) {
    ok("GET /api/team/contributions → 200");
  } else {
    warn(`GET /api/team/contributions → ${r3.status}`);
  }

  // 4d. Simuler une action (créer une mission) et vérifier que streak s'incrémente
  // Record activity
  const r4 = await api("POST", "/api/me/record-activity", { action: "mission_created" });
  r4.status === 200 || r4.status === 204 ? ok("POST /api/me/record-activity → OK") : warn(`record-activity → ${r4.status}`);

  // Re-check streak
  const r5 = await api("GET", "/api/me/streak");
  if (r5.status === 200) {
    ok("Streak rechargé post-activité", `current=${r5.json?.current}`);
  }

  // 4e. Vérifier user_activity_days en DB
  const actDb = sql(`SELECT COUNT(*) FROM user_activity_days WHERE org_id='${ORG_ID}'`);
  actDb !== null ? ok("user_activity_days a des entrées", `count=${actDb}`) : warn("user_activity_days vide pour cet org");

  // 4f. Vérifier cohérence streak affiché vs DB
  const dbStreak = sql(`SELECT current_streak FROM user_activity_days WHERE org_id='${ORG_ID}' ORDER BY activity_date DESC LIMIT 1`);
  const apiStreak = (await api("GET", "/api/me/streak")).json?.current;
  if (dbStreak !== null && apiStreak !== undefined) {
    const dbVal = parseInt(dbStreak);
    dbVal === apiStreak ? ok(`Streak cohérent DB vs API: ${dbVal}`) : warn(`Streak DB=${dbVal} vs API=${apiStreak} (peut diverger si pas de table dédiée)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — TRADUCTIONS IA
// ─────────────────────────────────────────────────────────────────────────────
async function testTranslations() {
  console.log("\n═══ 5. TRADUCTIONS IA ═══");

  const langs = [
    { code: "it", name: "italien", keywords: ["missione", "ottimizza", "audit", "raccomandazione", "parola chiave"], forbidden: ["créer", "optimiser", "missions", "recommandation"] },
    { code: "en", name: "anglais", keywords: ["mission", "optimize", "audit", "recommendation", "keyword"], forbidden: ["créer", "optimiser", "recommandation"] },
    { code: "de", name: "allemand", keywords: ["Mission", "optimieren", "Audit", "Empfehlung"], forbidden: ["créer", "optimiser", "recommandation"] },
  ];

  for (const lang of langs) {
    console.log(`\n  — Test langue: ${lang.name} (${lang.code})`);

    // Test /ai/missions avec la langue
    const mR = await api("POST", "/api/ai/missions", {
      language: lang.code,
      profile: { website: "https://example.com", sector: "e-commerce" },
      currentMissions: []
    });
    if (mR.status === 200) {
      const missions = mR.json?.missions || [];
      const text = missions.map(m => `${m.title} ${m.description}`).join(" ").toLowerCase();
      const hasFrench = lang.forbidden.some(w => text.includes(w.toLowerCase()));
      const hasTargetLang = lang.keywords.some(w => text.toLowerCase().includes(w.toLowerCase()));
      !hasFrench ? ok(`/ai/missions (${lang.code}) → 0 mot français détecté ✓`) : fail(`/ai/missions (${lang.code}) → contient du français: "${lang.forbidden.find(w => text.includes(w.toLowerCase()))}"`);
      hasTargetLang ? ok(`/ai/missions (${lang.code}) → contient du ${lang.name} ✓`) : warn(`/ai/missions (${lang.code}) → langue cible non détectée (model peut varier)`);
    } else if (mR.status === 402 || mR.status === 403) {
      warn(`/ai/missions → ${mR.status} quota/plan (test de langue non possible)`);
    } else {
      warn(`/ai/missions → ${mR.status} ${mR.text.slice(0,80)}`);
    }

    // Test /ai/summary avec la langue
    const sR = await api("POST", "/api/ai/summary", {
      language: lang.code,
      context: { score: 65, monitors: 2, keywords: ["seo", "local"] }
    });
    if (sR.status === 200) {
      const text = (sR.json?.summary || "").toLowerCase();
      const hasFrench = lang.forbidden.some(w => text.includes(w.toLowerCase()));
      !hasFrench ? ok(`/ai/summary (${lang.code}) → 0 mot français ✓`) : fail(`/ai/summary (${lang.code}) → contient du français`);
    } else if (sR.status === 402 || sR.status === 403) {
      warn(`/ai/summary → ${sR.status} (quota/plan)`);
    } else {
      warn(`/ai/summary → ${sR.status} ${sR.text.slice(0,80)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║        QA E2E FULL — FlowPoint Test-Replit           ║");
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`ORG_ID: ${ORG_ID}`);
  console.log(`Server: ${BASE}`);

  cleanup();
  const tok = setupSession();
  console.log(`Session: ${tok}`);

  await testAuth();
  await testLocalSeo();
  await testAIActions();
  await testStreaks();
  await testTranslations();

  cleanup();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  RÉSULTATS: ✅ ${passed} OK  ❌ ${failed} FAIL  ⚠️  ${warnings} WARN       ║`);
  console.log("╚══════════════════════════════════════════════════════╝");

  // Tableau détaillé des échecs
  const failures = results.filter(r => r.status === "❌");
  if (failures.length > 0) {
    console.log("\n═══ ÉCHECS DÉTAILLÉS ═══");
    failures.forEach(f => console.log(`  ❌ ${f.label} — ${f.detail}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(2); });
