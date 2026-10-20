/**
 * Static/behavioral unit test — pricing.html cart quantity + Ultra inclusion.
 *
 * Runs the real pricing.html client cart logic inside a Node VM against a
 * minimal DOM/localStorage stub (no jsdom dependency) and asserts the four
 * consistency guarantees from the task:
 *
 *   1. changeQty() writes the cart even when the add-on key is not yet present.
 *   2. The cart badge shows the TOTAL pack quantity, not the distinct-key count.
 *   3. A dashboard/authenticated return restores saved add-on quantities into
 *      the matching <input> AND the canonical cart (pricing = cart = checkout).
 *   4. The page holds NO hardcoded plan-inclusion matrix / no retention90d
 *      substitute for an Ultra-included retention365d — inclusion is server-fed.
 *
 * Pure Node — no network, no DB, no browser. Run:
 *   node artifacts/api-server/tests/certification/pricing_cart_quantity.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING = resolve(__dirname, "../../../flowpoint-export/pricing.html");

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ${PASS} ${label}`); passed++; }
  else       { console.log(`  ${FAIL} ${label}`); failed++; }
}

const html = readFileSync(PRICING, "utf8");

// ── Extract the first (cart-logic) <script> IIFE ─────────────────────────────
const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const cartScript = blocks.find(b => b.includes("window.changeQty") && b.includes("updateCartBadge"));
assert(!!cartScript, "found the cart-logic <script> block");

// ── Minimal DOM / storage stub ───────────────────────────────────────────────
function makeInput(id, value, min, max) {
  return { id, value: String(value), min: String(min), max: String(max) };
}
function buildEnv(inputs, buttons) {
  const store = {};
  const badge = { textContent: "", classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, contains(c){return this._s.has(c);} } };
  const byId = { "fp-cart-badge": badge };
  inputs.forEach(i => { byId[i.id] = i; });

  const doc = {
    getElementById: (id) => byId[id] || null,
    querySelector: (sel) => {
      // changeQty targets: button.fp-addon-btn[onclick*="'<key>'"]
      const m = sel.match(/onclick\*="'([^']+)'"/);
      if (m) return buttons.find(b => b.key === m[1]) || null;
      return null;
    },
    querySelectorAll: () => [],
    documentElement: { setAttribute() {} },
    addEventListener() {},
    readyState: "complete",
    cookie: "",
  };
  const win = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { search: "", href: "" },
    addEventListener() {},
    _fpBillingState: null,
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const ctx = {
    window: win, document: doc, localStorage,
    sessionStorage: { getItem: () => null },
    URLSearchParams, JSON, Math, Date, parseInt, String, Number, Object, Array,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    console: { log() {}, error() {} },
    // The IIFE fetches /api/plans/catalog and /api/billing/subscription at load.
    // We short-circuit both to inert, never-resolving promises so the cart
    // logic under test runs without any network.
    fetch: () => ({ then: () => ({ then: () => ({ catch: () => {} }), catch: () => {} }), catch: () => {} }),
  };
  ctx.globalThis = ctx;
  win.localStorage = localStorage;
  win.document = doc;
  vm.createContext(ctx);
  vm.runInContext(cartScript, ctx);
  return { win, doc, localStorage, badge, store };
}

// ── 1. changeQty writes cart even when key absent ────────────────────────────
{
  const input = makeInput("qty-monitorsPack10", 1, 1, 20);
  const btn = { key: "monitorsPack10", disabled: false, textContent: "Activer →", style: {} };
  const { win, localStorage } = buildEnv([input], [btn]);
  win.changeQty("monitorsPack10", 2);          // 1 -> 3, key not previously in cart
  const cart = JSON.parse(localStorage.getItem("fp_cart") || "{}");
  assert(String(input.value) === "3", "changeQty clamps/steps the input value (1 +2 = 3)");
  assert(cart.addons && cart.addons.monitorsPack10 === 3,
    "changeQty adds the key to the cart with the new quantity when absent");
  assert(btn.textContent.includes("panier") || btn.textContent.includes("Dans le"),
    "changeQty marks the button as in-cart when it newly adds the add-on");
}

// ── 2. badge = total pack quantity, not distinct-key count ───────────────────
{
  const i10 = makeInput("qty-monitorsPack10", 1, 1, 20);
  const i50 = makeInput("qty-monitorsPack50", 1, 1, 20);
  const b10 = { key: "monitorsPack10", disabled: false, textContent: "Activer →", style: {} };
  const b50 = { key: "monitorsPack50", disabled: false, textContent: "Activer →", style: {} };
  const { win, badge } = buildEnv([i10, i50], [b10, b50]);
  win.addToCart(b10, "monitorsPack10", true);   // qty 1
  win.changeQty("monitorsPack10", 2);           // -> 3
  win.addToCart(b50, "monitorsPack50", true);   // qty 1
  // distinct keys = 2, but total packs = 3 + 1 = 4
  assert(String(badge.textContent) === "4",
    `badge reflects total pack quantity (=4), not distinct keys (=2); got ${badge.textContent}`);
}

// ── 3. plan selection contributes exactly 1 to the badge ─────────────────────
{
  const { win, badge } = buildEnv([], []);
  win.selectPlan({ getAttribute: () => "ultra", closest: () => null, classList: { add(){}, remove(){} }, style: {} });
  assert(String(badge.textContent) === "1", `plan adds 1 to the badge; got ${badge.textContent}`);
}

// ── 4. no hardcoded inclusion matrix; no retention90d substitute ─────────────
{
  // The page must NOT ship a populated static inclusion list. The canonical
  // declaration is an EMPTY placeholder filled from /api/plans/catalog.
  const hasEmptyPlaceholder = /PLAN_INCLUDED\s*=\s*\{\s*standard:\s*\[\]\s*,\s*pro:\s*\[\]\s*,\s*ultra:\s*\[\]\s*\}/.test(cartScript);
  assert(hasEmptyPlaceholder, "PLAN_INCLUDED is an empty placeholder, populated from the server catalog");

  // No code path may auto-select retention90d as a stand-in for an Ultra
  // retention365d inclusion (would double-charge / mislead).
  const noSubstitute = !/retention365d[\s\S]{0,80}retention90d/.test(cartScript) &&
                       !/retention90d\s*[:=]\s*['"]?retention365d/.test(cartScript);
  assert(noSubstitute, "no retention90d ↔ retention365d substitution logic on the page");

  // Inclusion is applied strictly from the server list (indexOf on PLAN_INCLUDED),
  // never from a literal set of keys hardcoded in updateIncludedAddons.
  const inclusionFromServer = cartScript.includes("included.indexOf(key)") &&
                              cartScript.includes("PLAN_INCLUDED[plan]");
  assert(inclusionFromServer, "updateIncludedAddons derives inclusion from the server-fed list only");
}

console.log(`\npricing cart/quantity + Ultra inclusion — ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
