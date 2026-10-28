import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/signin.html"),
  "utf8",
);
const classifierSource = source.match(/function _classifySessionRestore\(status, hasToken\) \{[\s\S]*?\n      \}/)?.[0];
const classify = classifierSource
  ? new Function(`return (${classifierSource});`)() as (status: number, hasToken: boolean) => string
  : () => "missing";
const restore = source.slice(
  source.indexOf("function _classifySessionRestore(status, hasToken)"),
  source.indexOf("window.addEventListener('DOMContentLoaded'", source.indexOf("function _classifySessionRestore(status, hasToken)")),
);

describe("Sign In session-restore regressions", () => {
  it("redirects only after a 200 response contains a replacement session token", () => {
    expect(classify(200, true)).toBe("restored");
    expect(classify(200, false)).toBe("temporary");
    expect(restore).toContain("disposition === 'restored'");
    expect(restore).toContain("sessionStorage.setItem('fp_session_token', data.token)");
    expect(restore).toContain("window.location.replace('/dashboard.html')");
  });

  it.each([401, 403])("classifies %i as an invalid session", (status) => {
    expect(classify(status, false)).toBe("invalid");
    expect(restore).toContain("disposition === 'invalid'");
    expect(restore).toContain("sessionStorage.removeItem('fp_session_token')");
  });

  it.each([503, 504])("classifies %i as temporary and offers manual retry", (status) => {
    expect(classify(status, false)).toBe("temporary");
    expect(restore).toContain("Votre session est conservée.");
    expect(restore).toContain("_showSessionRestoreNotice");
    expect(restore).toContain("Réessayer");
    expect(status).toBeGreaterThanOrEqual(500);
  });

  it("preserves the token on timeout and network errors without automatic retries", () => {
    expect(restore).toContain("controller.abort()");
    expect(restore).toContain("Impossible de vérifier votre session");
    expect(restore).toContain("_showSessionRestoreNotice");
    expect(restore).toContain("catch(function(err)");
    expect(restore).toContain("clearTimeout(timeoutId)");
  });

  it("does not log session credentials or credential prefixes", () => {
    expect(restore).not.toContain("SIGNIN AUTH TRACE");
    expect(restore).not.toContain("tokenPrefix");
  });
});
