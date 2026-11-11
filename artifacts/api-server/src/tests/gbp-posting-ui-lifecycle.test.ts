import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(__dirname, "../../../flowpoint-export/dashboard.js"), "utf8");
function setup(publish: ReturnType<typeof vi.fn>, confirm = true) {
  const start = source.indexOf("window._fpPublishGBPPost = async function");
  const end = source.indexOf("window._fpDeleteGBPPost = async function", start);
  const window = {
    FP_GBP_POSTS_API: { publish, cancelSchedule: vi.fn().mockResolvedValue({ ok: true }) },
    _fpReloadGBPPosts: vi.fn().mockResolvedValue(undefined), confirm: vi.fn(() => confirm),
  } as any;
  const toast = vi.fn();
  new Function("window", "showToast", "fpT", "_fpGBPPostRoleCapabilities", source.slice(start, end))(
    window, toast, (s: string) => s, () => ({ canWrite: true, canAdmin: true }),
  );
  return { window, toast };
}
describe("GBP publication UI honesty", () => {
  it("never reports a success without a Google post ID and refreshes persisted status", async () => {
    const { window, toast } = setup(vi.fn().mockResolvedValue({ ok: true, post: {} }));
    await window._fpPublishGBPPost("post-a");
    expect(toast).not.toHaveBeenCalledWith("success", expect.anything());
    expect(toast).toHaveBeenCalledWith("error", expect.stringContaining("confirmation Google"));
    expect(window._fpReloadGBPPosts).toHaveBeenCalledOnce();
  });
  it("refreshes failed statuses and errors even when publication rejects", async () => {
    const { window, toast } = setup(vi.fn().mockRejectedValue(new Error("Google rejected")));
    await window._fpPublishGBPPost("post-a");
    expect(toast).toHaveBeenCalledWith("error", "Google rejected");
    expect(window._fpReloadGBPPosts).toHaveBeenCalledOnce();
  });
  it("requires explicit confirmation and suppresses duplicate clicks", async () => {
    const publish = vi.fn().mockResolvedValue({ ok: true, post: { googlePostId: "mock-id", publishedAt: "2026-11-10" } });
    const denied = setup(publish, false);
    await denied.window._fpPublishGBPPost("post-a");
    expect(publish).not.toHaveBeenCalled();
    const { window } = setup(publish);
    await Promise.all([window._fpPublishGBPPost("post-a"), window._fpPublishGBPPost("post-a")]);
    expect(publish).toHaveBeenCalledOnce();
  });
  it("cancels a schedule through the API and reloads server state", async () => {
    const { window } = setup(vi.fn());
    await window._fpCancelGBPPostSchedule("post-a");
    expect(window.FP_GBP_POSTS_API.cancelSchedule).toHaveBeenCalledWith("post-a");
    expect(window._fpReloadGBPPosts).toHaveBeenCalledOnce();
  });
});
