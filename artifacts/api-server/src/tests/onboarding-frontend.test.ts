import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const dashboard = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/dashboard.js"),
  "utf8",
);
const start = dashboard.indexOf("function _fpCloseOnboarding(persist)");
const end = dashboard.indexOf("\n// ESC =", start);
const closeOnboarding = dashboard.slice(start, end);

function makeElement() {
  return {
    hidden: false,
    setAttribute(name: string) { if (name === "hidden") this.hidden = true; },
    removeAttribute(name: string) { if (name === "hidden") this.hidden = false; },
  };
}

describe("onboarding final action", () => {
  it("hides the modal only after the API confirms persistence", async () => {
    const element = makeElement();
    const apiFetch = vi.fn(async () => ({ ok: true }));
    const context = vm.createContext({
      STATE: { onboardingComplete: false },
      $: () => element,
      apiFetch,
      fpT: (value: string) => value,
      showToast: vi.fn(),
    });
    vm.runInContext(closeOnboarding, context);

    context._fpCloseOnboarding(true);
    expect(element.hidden).toBe(false);
    await new Promise(resolve => setImmediate(resolve));
    expect(element.hidden).toBe(true);
    expect(context.STATE.onboardingComplete).toBe(true);
    expect(apiFetch).toHaveBeenCalledWith("/api/onboarding/complete", { method: "POST" });
  });

  it("keeps the modal open and reports an error when persistence is rejected", async () => {
    const element = makeElement();
    const showToast = vi.fn();
    const context = vm.createContext({
      STATE: { onboardingComplete: false },
      $: () => element,
      apiFetch: vi.fn(async () => ({ ok: false })),
      fpT: (value: string) => value,
      showToast,
    });
    vm.runInContext(closeOnboarding, context);

    context._fpCloseOnboarding(true);
    await new Promise(resolve => setImmediate(resolve));
    expect(element.hidden).toBe(false);
    expect(context.STATE.onboardingComplete).toBe(false);
    expect(showToast).toHaveBeenCalledWith("error", "Erreur lors de la mise à jour");
  });
});