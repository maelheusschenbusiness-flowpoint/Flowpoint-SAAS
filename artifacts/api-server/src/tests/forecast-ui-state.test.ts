import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8");
const servedDashboard = readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8");
const forecastView = dashboard.slice(
  dashboard.indexOf("if (sub === 'forecast')"),
  dashboard.indexOf("// SUB: DATA EXPORT & REPORTING CENTER"),
);
const forecastClient = dashboard.slice(
  dashboard.indexOf("window.FP_FORECAST_API = {"),
  dashboard.indexOf("window._fpOpenForecastSimulation"),
);

describe("forecasting dashboard state", () => {
  it("keeps the served dashboard identical to the source dashboard", () => {
    expect(servedDashboard).toBe(dashboard);
  });

  it("renders forecast data only for the explicit available state", () => {
    expect(forecastView).toContain("_fcData?.status === 'available'");
    expect(forecastView).toContain("data-forecast-status=");
    expect(forecastView).toContain("status || 'insufficient_data'");
    expect(forecastView).toContain("Prévision indisponible — données insuffisantes");
    expect(forecastView).toContain("14 jours de données GSC et GA4 valides");
  });

  it("clears stale chart values and shows the API reason when generation returns 422", () => {
    expect(forecastClient).toContain("if (e?.status === 422)");
    expect(forecastClient).toContain("forecasts: []");
    expect(forecastClient).toContain("status: 'insufficient_data'");
    expect(forecastClient).toContain("reason: e.message");
    expect(forecastClient).toContain("render();");
  });
});
