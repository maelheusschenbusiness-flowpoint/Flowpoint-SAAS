import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverRoot = path.join(import.meta.dirname ?? __dirname, "..", "..");
const repoRoot = path.join(serverRoot, "..", "..");
const renderConfig = readFileSync(path.join(repoRoot, "render.yaml"), "utf8");

function activeServiceForBranch(branch: string): string {
  const services = renderConfig.split(/^\s*-\s+type:\s*/m).slice(1);
  const service = services.find((block) =>
    new RegExp(`^\\s*branch:\\s*${branch}\\s*$`, "m").test(block),
  );
  if (!service) throw new Error(`Render service for branch ${branch} is missing`);
  return service
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("Render deployment migration boundary", () => {
  it("keeps the Test-Replit service on test mode without running migrations", () => {
    const testService = activeServiceForBranch("Test-Replit");
    expect(testService).toMatch(/^\s*value:\s*test\s*$/m);
    expect(testService).not.toMatch(/^\s*preDeployCommand\s*:/m);
    expect(testService).not.toMatch(
      /^\s*(?:preDeployCommand|buildCommand|startCommand):.*\bmigrate\b/im,
    );
  });

  it("retains a separate production configuration", () => {
    expect(renderConfig).toMatch(/^\s*value:\s*production\s*$/m);
  });
});
