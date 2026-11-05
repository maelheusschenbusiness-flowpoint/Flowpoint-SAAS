import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const rendererSource = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/seo-change-impact-addon.js"),
  "utf8",
);

describe("SEO Change Impact settings cache refresh", () => {
  it("fetches saved settings with a fresh URL after a successful save", async () => {
    type SubmitEvent = { preventDefault: () => void };
    type ActionCall = [method: string, path: string, body?: unknown];
    const calls: ActionCall[] = [];
    let submitHandler: ((event: SubmitEvent) => Promise<void>) | undefined;
    const form = {
      addEventListener: (_type: string, handler: (event: SubmitEvent) => Promise<void>) => {
        submitHandler = handler;
      },
    };
    const message = { setAttribute: vi.fn(), textContent: "" };
    const state = {
      innerHTML: "",
      textContent: "",
      setAttribute: vi.fn(),
      querySelector: (selector: string) =>
        selector === "[data-sci-settings]" ? form : message,
    };
    const root = {
      innerHTML: "",
      querySelector: (selector: string) =>
        selector === "[data-sci-state]" ? state : selector === "[data-sci-message]" ? message : null,
    };
    const apiAction = vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body]);
      if (method === "GET") {
        return { settings: { lookbackDays: 30, minimumScoreChange: 0 }, comparisons: [] };
      }
      return { ok: true };
    });
    class FakeFormData {
      get(name: string) {
        return name === "lookbackDays" ? "60" : name === "minimumScoreChange" ? "5" : null;
      }
    }
    const windowObject: Record<string, any> = { apiAction };

    vm.runInNewContext(rendererSource, { window: windowObject, FormData: FakeFormData });
    await windowObject.FP_ADDON_RENDERERS.seoChangeImpact(root);
    await submitHandler?.({ preventDefault: vi.fn() });

    expect(calls.map(([method, path]) => [method, path])).toEqual([
      ["GET", "/api/seo-change-impact"],
      ["PUT", "/api/seo-change-impact/settings"],
      ["GET", expect.stringMatching(/^\/api\/seo-change-impact\?refresh=\d+$/)],
    ]);
  });
});
