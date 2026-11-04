/**
 * text-parser.test.ts — Truncation on a surrogate-pair boundary.
 *
 * Covers:
 *   - maxChars falling between the two UTF-16 units of an emoji: the rendered
 *     text stops just before that emoji, never on half a pair
 *   - maxChars falling right after a complete emoji: the emoji is kept
 *   - text shorter than maxChars: returned as-is, truncated false
 *   - the leading UTF-8 BOM is always removed
 *   - binary content still returns the binary_content error
 */

import { describe, it, expect } from "vitest";

import { parseTextBuffer } from "./text-parser.js";

const EMOJI = "\u{1F600}"; // 😀 — two UTF-16 code units

describe("parseTextBuffer — truncation never splits a surrogate pair", () => {
  it("cuts just before an emoji when maxChars falls in the middle of it", () => {
    // "abc" + emoji (units 3 and 4) + "def" → maxChars 4 lands between them.
    const buf = Buffer.from(`abc${EMOJI}def`, "utf-8");
    const r   = parseTextBuffer(buf, 4);

    expect("error" in r).toBe(false);
    if (!("text" in r)) return;

    expect(r.text).toBe("abc");
    expect(r.truncated).toBe(true);
    expect(r.charCount).toBe(r.text.length);
    expect(r.charCount).toBe(3);
  });

  it("keeps the emoji when maxChars falls right after the complete pair", () => {
    const buf = Buffer.from(`abc${EMOJI}def`, "utf-8");
    const r   = parseTextBuffer(buf, 5);

    expect("error" in r).toBe(false);
    if (!("text" in r)) return;

    expect(r.text).toBe(`abc${EMOJI}`);
    expect(r.truncated).toBe(true);
    expect(r.charCount).toBe(r.text.length);
    expect(r.charCount).toBe(5);
  });

  it("returns a text shorter than maxChars unchanged, not truncated", () => {
    const content = `short ${EMOJI} text`;
    const r       = parseTextBuffer(Buffer.from(content, "utf-8"), 1000);

    expect("error" in r).toBe(false);
    if (!("text" in r)) return;

    expect(r.text).toBe(content);
    expect(r.truncated).toBe(false);
    expect(r.charCount).toBe(content.length);
  });

  it("still removes the leading UTF-8 BOM", () => {
    const withBOM = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from("Hello", "utf-8"),
    ]);
    const r = parseTextBuffer(withBOM, 1000);

    expect("error" in r).toBe(false);
    if (!("text" in r)) return;

    expect(r.text).toBe("Hello");
    expect(r.truncated).toBe(false);
    expect(r.charCount).toBe(5);
  });

  it("still returns binary_content for binary data", () => {
    const arr = new Uint8Array(100);
    for (let i = 0; i < 100; i++) arr[i] = i < 20 ? 0x00 : 0x41;

    const r = parseTextBuffer(Buffer.from(arr), 1000);

    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("binary_content");
  });
});
