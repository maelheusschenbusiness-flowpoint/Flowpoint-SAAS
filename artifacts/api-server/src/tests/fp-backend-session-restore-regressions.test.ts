import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = process.cwd();
const source = readFileSync(
  resolve(apiRoot, "../../src/frontend/fp-backend.js"),
  "utf8",
);
const exported = readFileSync(
  resolve(apiRoot, "../flowpoint-export/fp-backend.js"),
  "utf8",
);
const classifierSource = source.match(
  /function _classifySessionRestore\(status, hasToken\) \{[\s\S]*?\n  \}/,
)?.[0];
const classify = classifierSource
  ? new Function(`return (${classifierSource});`)() as (status: number, hasToken: boolean) => string
  : () => "missing";
const bootstrapStart = source.indexOf("function _restoreSession(options)");
const bootstrapEnd = source.indexOf("window.__fpRestoreSession = _restoreSession", bootstrapStart);
const bootstrap = source.slice(bootstrapStart, bootstrapEnd);
const apiFetchStart = source.indexOf("function apiFetchNow(path, opts)");
const apiFetchEnd = source.indexOf("\n  function apiFetch(", apiFetchStart);
const apiFetch = source.slice(apiFetchStart, apiFetchEnd);

describe("fp-backend session-restore regressions", () => {
  it("keeps the served backend source and export identical", () => {
    expect(exported).toBe(source);
  });

  it("accepts only a 200 response with a non-empty token as restored", () => {
    expect(classify(200, true)).toBe("restored");
    expect(classify(200, false)).toBe("temporary");
    expect(classify(201, true)).toBe("temporary");
    expect(classify(401, false)).toBe("invalid");
    expect(classify(403, false)).toBe("invalid");
    expect(classify(500, false)).toBe("temporary");
    expect(classify(503, false)).toBe("temporary");
  });

  it("preserves the existing token after a transient bootstrap failure", () => {
    expect(bootstrapStart).toBeGreaterThanOrEqual(0);
    expect(bootstrapEnd).toBeGreaterThan(bootstrapStart);
    expect(bootstrap).toContain("setTimeout(function() { controller.abort(); }, 10000)");
    expect(bootstrap).toContain("signal: controller.signal");
    expect(bootstrap).toContain("Only explicit authentication rejection proves the session is invalid.");
    expect(bootstrap).toContain("if (disposition === 'invalid'");
    expect((bootstrap.match(/removeItem\('fp_session_token'\)/g) || []).length).toBe(1);
    expect(bootstrap).not.toContain("disposition === 'temporary'");
  });

  it("shows manual retry and preserves auth on transient apiFetch restores", () => {
    expect(apiFetchStart).toBeGreaterThanOrEqual(0);
    expect(apiFetchEnd).toBeGreaterThan(apiFetchStart);
    expect(apiFetch).toContain("setTimeout(function() { _restoreController.abort(); }, 10000)");
    expect(apiFetch).toContain("signal: _restoreController.signal");
    expect(apiFetch).toContain("_showSessionRestoreRetryNotice()");
    expect(apiFetch).toContain("SESSION_RESTORE_TEMPORARY");
    expect(apiFetch).toContain("finally(function() { clearTimeout(_restoreTimeout); })");

    const httpTransient = apiFetch.slice(
      apiFetch.indexOf("if (_classifySessionRestore(sr.status, false) === 'temporary')"),
      apiFetch.indexOf("// session-restore response was non-OK.", apiFetch.indexOf("if (_classifySessionRestore(sr.status, false) === 'temporary')")),
    );
    expect(httpTransient).toContain("_showSessionRestoreRetryNotice()");
    expect(httpTransient).toContain("_temporarySessionRestoreError(sr.status)");
    expect(httpTransient).not.toContain("_clearAuth()");
    expect(httpTransient).not.toContain("location.replace");

    const networkTransient = apiFetch.slice(apiFetch.indexOf("}).catch(function(e) {"));
    expect(networkTransient).toContain("_showSessionRestoreRetryNotice()");
    expect(networkTransient).toContain("_temporarySessionRestoreError(503)");
    expect(networkTransient).not.toContain("_clearAuth()");
    expect(networkTransient).not.toContain("location.replace");
  });

  it("translates the retry notice for the default English locale", () => {
    const noticeStart = source.indexOf("function _showSessionRestoreRetryNotice()");
    const noticeEnd = source.indexOf("\n  function _temporarySessionRestoreError", noticeStart);
    const notice = source.slice(noticeStart, noticeEnd);

    expect(notice).toContain("_fpBackendText(");
    expect(notice).toContain("Your session has been preserved.");
    expect(notice).toContain("_fpBackendText('Réessayer', 'Retry')");
  });
});
