import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "../../src/frontend/dashboard.js"),
  "utf8",
);
const exported = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/dashboard.js"),
  "utf8",
);
const classifierSource = source.match(/function _fpClassifySessionRestore\(status, hasToken\) \{[\s\S]*?\n\}/)?.[0];
const classify = classifierSource
  ? new Function(`return (${classifierSource});`)() as (status: number, hasToken: boolean) => string
  : () => "missing";

describe("dashboard render regressions", () => {
  it("keeps the served dashboard source and export identical", () => {
    expect(exported).toBe(source);
  });

  it("derives local SEO zone counts from optional real zone data", () => {
    const start = source.indexOf("function renderLocalSEO()");
    const end = source.indexOf("/* ──", start + 1);
    const localSeo = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(localSeo).toMatch(/const _zones = Array\.isArray\(_lseo\.zones\)/);
    expect(localSeo).toMatch(/const totalZones = _zones\.length/);
    expect(localSeo).toMatch(/const dominatedZones = totalZones > 0/);
  });

  it("renders profile initials when the account has no first name", () => {
    expect(source).toContain("String(me.firstName || me.email || 'U').charAt(0)");
  });

  it("preserves the dashboard session on transient restore failures and offers manual retry", () => {
    expect(classify(200, true)).toBe("restored");
    expect(classify(200, false)).toBe("temporary");
    expect(classify(401, false)).toBe("invalid");
    expect(classify(403, false)).toBe("invalid");
    expect(classify(503, false)).toBe("temporary");
    expect(classify(504, false)).toBe("temporary");
    const restore = source.slice(
      source.indexOf("let _restoreWasTransient = false;"),
      source.indexOf("// Recovery failed or already attempted.", source.indexOf("let _restoreWasTransient = false;")),
    );
    expect(restore).toContain("setTimeout(() => _restoreController.abort(), 10000)");
    expect(restore).toContain("_restoreKind === 'temporary'");
    expect(restore).toContain("_restoreWasTransient = true");
    expect(source).toContain("fp-session-restore-retry");
    expect(source).toContain("window.location.reload()");
    expect(restore).not.toContain("removeItem('fp_session_token')");
    const loadDataStart = source.indexOf("async function loadData(options = {})");
    const loadDataCatch = source.indexOf("  } catch (e) {", loadDataStart);
    const loadData = source.slice(loadDataCatch, source.indexOf("  STATE.me = me ||", loadDataCatch));
    expect(loadData).toContain("e?.code === 'SESSION_RESTORE_TEMPORARY'");
    expect(loadData).toContain("STATE.loading = false");
    expect(loadData).toContain("_doRender()");
    expect(loadData).toContain("e?.status >= 500");
    expect(loadData).toContain("e?.name === 'AbortError'");
    expect(loadData).toContain("e instanceof TypeError");
  });

  it.each(["network failure", "timeout"])("treats a %s during session restore as temporary", () => {
    const restore = source.slice(
      source.indexOf("let _restoreWasTransient = false;"),
      source.indexOf("// Recovery failed or already attempted.", source.indexOf("let _restoreWasTransient = false;")),
    );
    expect(restore).toContain("new AbortController()");
    expect(restore).toContain("_restoreController.abort()");
    expect(restore).toContain("_restoreWasTransient = true");
    expect(restore).toContain("finally");
    expect(restore).toContain("throw _restoreError");
    expect(classify(503, false)).toBe("temporary");
  });
});
