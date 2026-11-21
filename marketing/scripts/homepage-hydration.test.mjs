import assert from "node:assert/strict";

// Browser regression runner, accepting a Playwright Browser and the running app
// URL so it can run in either a local or a remote browser test environment.
export async function checkHomepageHydration(browser, baseUrl) {
  const results = [];
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const context = await browser.newContext({ reducedMotion });
    try {
      for (const signal of [null, "search", "website", "analytics"]) {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
          if (message.type() === "error") errors.push(message.text());
        });
        const path = signal ? `/?signal=${signal}` : "/";
        try {
          await page.goto(new URL(path, baseUrl).href, { waitUntil: "networkidle" });
          const selected = signal === "website" ? 1 : signal === "analytics" ? 2 : 0;
          await page.waitForFunction(index =>
            document.getElementById(`fp2-explorer-tab-${index}`)?.getAttribute("aria-selected") === "true",
          selected);
          const playing = !signal && reducedMotion !== "reduce";
          await page.getByRole("button", { name: playing ? "Pause preview" : "Play preview", exact: true }).waitFor();
          assert.deepEqual(errors, [], `${path} (${reducedMotion}) must hydrate without errors`);
          assert.equal(await page.locator(".fp2-signal-heading h2").isVisible(), true);
          assert.equal(await page.locator("#fp2-premium-security-title").isVisible(), true);

          // Verify that hydration retained the preview's tab interaction.
          await page.locator("#fp2-explorer-tab-1").click();
          await page.waitForFunction(() =>
            document.getElementById("fp2-explorer-tab-1")?.getAttribute("aria-selected") === "true");
          await page.getByRole("button", { name: "Play preview", exact: true }).waitFor();
          assert.deepEqual(errors, [], "changing tabs must not cause hydration or runtime errors");
          results.push(`${path} (${reducedMotion}): hydrated, preferences applied, tabs working`);
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    for (const selector of [".fp2-hero-text h1", ".fp2-hero-actions a", ".fp2-dashboard-wrap", ".fp2-signal-heading h2", ".fp2-premium-ai h2", ".fp2-premium-team h2", "#fp2-premium-security-title"]) {
      assert.equal(await page.locator(selector).first().isVisible(), true, `${selector} must be visible without JavaScript`);
    }
    results.push("JavaScript disabled: hero, links, preview, connected-signals, AI, team and security visible");
  } finally {
    await context.close();
  }
  return results;
}
