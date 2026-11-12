import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const captureDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(captureDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("Agency report email TEST capture", () => {
  it("captures recipient and message content while redacting the portal bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "flowpoint-agency-mail-"));
    captureDirs.push(dir);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENABLE_TEST_MAILER", "true");
    vi.stubEnv("TEST_MAIL_DIR", dir);
    vi.stubEnv("RENDER", "");
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");

    const { mailer } = await import("./mailer.js");
    const token = "A".repeat(43);
    const result = await mailer.sendReportGenerated({
      to: "report-recipient@example.test",
      name: "Client Test",
      reportName: "Client Test — Rapport multi-sites",
      reportUrl: `https://agency.example.test/api/agency-portal/${token}`,
    });

    expect(result.ok).toBe(true);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const captured = JSON.parse(await readFile(path.join(dir, files[0]!), "utf8")) as {
      to: string;
      subject: string;
      tag: string;
      html: string;
    };
    expect(captured).toMatchObject({
      to: "report-recipient@example.test",
      tag: "report_generated",
    });
    expect(captured.subject).toContain("Rapport multi-sites");
    expect(captured.html).toContain("Client Test — Rapport multi-sites");
    expect(captured.html).toContain("https://agency.example.test/api/agency-portal/[PORTAL_TOKEN_REDACTED]");
    expect(captured.html).not.toContain(token);
  });
});
