import { describe, expect, it } from "vitest";
import { BEHAVIORAL_SESSION_ID_FACTORY } from "./behavioral-session-id.js";

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function createSessionId(storage: ReturnType<typeof makeStorage>) {
  const factory = new Function(`return (${BEHAVIORAL_SESSION_ID_FACTORY})`)() as
    (windowLike: { sessionStorage: ReturnType<typeof makeStorage> }) => string;
  return factory({ sessionStorage: storage });
}

describe("behavioral snippet session identity", () => {
  it("reuses one session id across page loads in the same tab", () => {
    const storage = makeStorage();

    const firstPageId = createSessionId(storage);
    const nextPageId = createSessionId(storage);

    expect(firstPageId).toMatch(/^fp_[a-z0-9]+$/);
    expect(nextPageId).toBe(firstPageId);
  });

  it("falls back to a generated id when browser storage is unavailable", () => {
    const factory = new Function(`return (${BEHAVIORAL_SESSION_ID_FACTORY})`)() as
      (windowLike: { sessionStorage?: never }) => string;

    expect(factory({})).toMatch(/^fp_[a-z0-9]+$/);
  });
});
