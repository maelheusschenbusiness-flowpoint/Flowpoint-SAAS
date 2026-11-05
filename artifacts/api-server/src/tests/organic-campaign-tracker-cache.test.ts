import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const rendererSource = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/organic-campaign-tracker-addon.js"),
  "utf8",
);

describe("Organic Campaign Tracker cache refresh", () => {
  it("reloads with a fresh URL after create and delete mutations", async () => {
    type ActionCall = [method: string, path: string, body?: unknown];
    const calls: ActionCall[] = [];
    let submitHandler: ((event: { preventDefault: () => void; currentTarget: unknown }) => Promise<void>) | undefined;
    let deleteHandler: (() => Promise<void>) | undefined;
    const form = {
      addEventListener: (_type: string, handler: typeof submitHandler) => {
        submitHandler = handler;
      },
    };
    const message = { setAttribute: vi.fn(), textContent: "" };
    const deleteButton = {
      dataset: { octDelete: "campaign-1" },
      addEventListener: (_type: string, handler: typeof deleteHandler) => {
        deleteHandler = handler;
      },
    };
    const state = {
      innerHTML: "",
      setAttribute: vi.fn(),
      querySelector: (selector: string) =>
        selector === "[data-oct-form]" ? form : message,
      querySelectorAll: () => [deleteButton],
    };
    const root = {
      innerHTML: "",
      querySelector: (selector: string) =>
        selector === "[data-oct-state]" ? state : selector === "[data-oct-message]" ? message : null,
    };
    const apiAction = vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body]);
      if (method === "GET") return { campaigns: [] };
      return { ok: true };
    });
    class FakeFormData {
      entries() {
        return [
          ["keyword", "dentiste urgence Bruxelles"],
          ["targetPosition", "10"],
          ["minimumClicks", "5"],
        ];
      }
    }
    const windowObject: Record<string, any> = { apiAction };

    vm.runInNewContext(rendererSource, { window: windowObject, FormData: FakeFormData });
    await windowObject.FP_ADDON_RENDERERS.organicCampaignTracker(root);
    await submitHandler?.({ preventDefault: vi.fn(), currentTarget: form });
    await deleteHandler?.();

    expect(calls.map(([method, path]) => [method, path])).toEqual([
      ["GET", "/api/organic-campaign-tracker"],
      ["POST", "/api/organic-campaign-tracker"],
      ["GET", expect.stringMatching(/^\/api\/organic-campaign-tracker\?refresh=\d+$/)],
      ["DELETE", "/api/organic-campaign-tracker/campaign-1"],
      ["GET", expect.stringMatching(/^\/api\/organic-campaign-tracker\?refresh=\d+$/)],
    ]);
  });
});
