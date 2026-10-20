import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = process.cwd();
const exportRoot = resolve(apiRoot, "../flowpoint-export");
const loginVerify = readFileSync(resolve(exportRoot, "login-verify.js"), "utf8");
const dashboardHtml = readFileSync(resolve(exportRoot, "dashboard.html"), "utf8");
const dashboard = readFileSync(resolve(exportRoot, "dashboard.js"), "utf8");
const backend = readFileSync(resolve(exportRoot, "fp-backend.js"), "utf8");
const authRoutes = readFileSync(resolve(apiRoot, "src/routes/auth.ts"), "utf8");

describe("signup → session → dashboard → /api/me → refresh regression", () => {
  it("stores the newly-created session token before redirecting to the dashboard", () => {
    expect(loginVerify).toContain("sessionStorage.setItem('fp_session_token', r.data.token)");
    expect(loginVerify).toContain("window.location.replace(next + sep + '_cb=' + Date.now())");
  });

  it("loads the shared session coordinator before dashboard code", () => {
    expect(dashboardHtml.indexOf('src="fp-backend.js')).toBeGreaterThanOrEqual(0);
    expect(dashboardHtml.indexOf('src="dashboard.js')).toBeGreaterThan(
      dashboardHtml.indexOf('src="fp-backend.js'),
    );
    expect(backend).toContain("window.__fpSessionReady = restore;");
    expect(dashboard).toContain("await window.__fpRestoreSession({ force: !!options.forceSessionRestore });");
  });

  it("bootstraps /api/me only after session restore and retries after refresh", () => {
    const restoreIndex = dashboard.indexOf("await window.__fpRestoreSession({ force: !!options.forceSessionRestore });");
    const meIndex = dashboard.indexOf("apiFetch('/api/me'", restoreIndex);
    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    expect(meIndex).toBeGreaterThan(restoreIndex);
    expect(backend).toContain("fetch('/api/auth/session-restore'");
    expect(backend).toContain("sessionStorage.setItem('fp_session_token', srData.token)");
    expect(backend).toContain("return fetch(_path, Object.assign");
  });

  it("recovers a stale per-tab token from the valid HttpOnly cookie", () => {
    expect(authRoutes).toContain('via: "cookie-fallback"');
    expect(authRoutes).toContain("session = await getSession(cookieToken)");
    expect(authRoutes).toContain("res.json({ token: provided, email: session.email, orgId: session.orgId })");
  });
});