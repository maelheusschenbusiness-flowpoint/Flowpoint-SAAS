import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/parcours",
  testMatch: "10-addons-authorises.spec.mjs",
  globalSetup: undefined,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:8083",
    ...devices["Desktop Chrome"],
    locale: "fr-FR",
    timezoneId: "Europe/Brussels",
  },
});
