// Run (from the Flowpoint Site app root): npx tsx docs/site-marketing/tests/consent.test.ts
import assert from "node:assert/strict";

type Store = Map<string, string>;
function install(opts: { local?: Store | "throws"; cookie?: string; search?: string }) {
  const session: Store = new Map();
  const local = opts.local === "throws" ? null : (opts.local ?? new Map());
  (globalThis as any).document = { cookie: opts.cookie ?? "", referrer: "" };
  (globalThis as any).window = {
    location: { search: opts.search ?? "", origin: "https://flowpoint.pro" },
    get localStorage() {
      if (!local) throw new Error("SecurityError");
      return {
        getItem: (k: string) => local.get(k) ?? null,
        setItem: (k: string, v: string) => void local.set(k, v),
        removeItem: (k: string) => void local.delete(k),
      };
    },
    sessionStorage: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => void session.set(k, v),
      removeItem: (k: string) => void session.delete(k),
    },
  };
  return { session, local };
}

const { readConsent, hasAnalyticsConsent } = await import("../../../client/src/lib/consent");
const { getActiveFpLid } = await import("../../../client/src/lib/fp-lid");
const LID = "A".repeat(22);

// 1. localStorage wins; cookie is the fallback when storage throws
install({ local: new Map([["cookie_consent", "accepted"]]) });
assert.equal(readConsent(), "accepted");
install({ local: "throws", cookie: "a=1; fp_analytics_consent=accepted; b=2" });
assert.equal(readConsent(), "accepted", "cookie fallback when localStorage throws");
install({ local: "throws", cookie: "fp_analytics_consent=refused" });
assert.equal(readConsent(), "refused");
assert.equal(hasAnalyticsConsent(), false);
install({ local: "throws", cookie: "fp_analytics_consent=maybe" });
assert.equal(readConsent(), null, "unknown cookie value is not a choice");
install({ local: "throws", cookie: "" });
assert.equal(readConsent(), null);

// 2. fp_lid: usable from the URL, but stored only with consent
let ctx = install({ search: `?fp_lid=${LID}` });
assert.equal(getActiveFpLid(), LID);
assert.equal(ctx.session.size, 0, "nothing written without consent");
ctx = install({ search: `?fp_lid=${LID}`, local: new Map([["cookie_consent", "refused"]]) });
getActiveFpLid();
assert.equal(ctx.session.size, 0, "nothing written after a refusal");
ctx = install({ search: `?fp_lid=${LID}`, local: new Map([["cookie_consent", "accepted"]]) });
assert.equal(getActiveFpLid(), LID);
assert.equal(ctx.session.get("flowpoint:marketing:fp_lid"), LID, "stored with consent");
// 3. stored value is purged and ignored once consent is gone
ctx = install({ local: new Map([["cookie_consent", "refused"]]) });
ctx.session.set("flowpoint:marketing:fp_lid", LID);
assert.equal(getActiveFpLid(), null);
assert.equal(ctx.session.size, 0, "stored lead id purged without consent");
console.log("consent tests: OK");
