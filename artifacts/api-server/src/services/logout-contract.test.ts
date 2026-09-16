import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const servicesDir = dirname(fileURLToPath(import.meta.url));
const authSource = readFileSync(resolve(servicesDir, "../routes/auth.ts"), "utf8");
const dashboardSource = readFileSync(resolve(servicesDir, "../../../flowpoint-export/dashboard.js"), "utf8");
const dashboardHtml = readFileSync(resolve(servicesDir, "../../../flowpoint-export/dashboard.html"), "utf8");

describe("logout contract", () => {
  it("revokes the current session by default and all sessions only explicitly", () => {
    expect(authSource).toContain("const logoutAll = req.body?.all === true");
    expect(authSource).toContain("const tokens = Array.from(new Set([bearerToken, cookieToken].filter(Boolean)))");
    expect(authSource).toContain("if (logoutAll && resolvedSession?.userId)");
    expect(authSource).toContain("await Promise.allSettled(tokens.map(deleteSession))");
    expect(authSource).toContain("res.clearCookie(\"fp_token\"");
  });

  it("handles the primary logout through global delegation without auth recovery", () => {
    expect(dashboardHtml).toContain('<button type="button" class="fp-icon-btn" id="fp-logout-btn"');
    expect(dashboardSource).toContain("function _fpHandleLogout(event)");
    expect(dashboardSource).toContain("document.addEventListener('click', function _logoutDelegation(e)");
    expect(dashboardSource).toContain("await fetch('/api/auth/logout', _fpSessionFetchOptions({");
    expect(dashboardSource).not.toContain("try { await window.apiFetch('/api/auth/logout'");
    expect(dashboardSource).toContain("sessionStorage.removeItem('fp_session_token')");
    expect(dashboardSource).toContain("window.location.replace('/login.html')");
  });

  it("keeps the explicit all-sessions action separate", () => {
    expect(dashboardSource).toContain("body: JSON.stringify({ all: true })");
  });
});