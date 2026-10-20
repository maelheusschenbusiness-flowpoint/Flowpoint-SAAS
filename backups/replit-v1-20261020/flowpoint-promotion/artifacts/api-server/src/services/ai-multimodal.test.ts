/**
 * ai-multimodal.test.ts — Step 3C: image parser + multimodal message builder.
 *
 * Covers:
 *   Image parser  : PNG / JPEG / WebP valid, invalid magic, MIME mismatch, too large
 *   Token estimate: floor/cap behaviour
 *   buildProviderMessages: text-only, with images, mixed text+image
 *   getImageUsageMetadata: with / without images
 *   isImageAttachment: type guard
 */

import { describe, it, expect } from "vitest";
import { parseImageBuffer, estimateImageTokens } from "./file-parsers/image-parser.js";
import { buildProviderMessages, getImageUsageMetadata, isImageAttachment } from "./ai-multimodal.js";
import type { NormalizedImageAttachment } from "../types/ai-attachments.js";

// ── Buffer helpers ────────────────────────────────────────────────────────────

function makePng(extra = 100): { b64: string; sizeBytes: number } {
  const buf = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    Buffer.alloc(extra),
  ]);
  return { b64: buf.toString("base64"), sizeBytes: buf.length };
}

function makeJpeg(extra = 100): { b64: string; sizeBytes: number } {
  const buf = Buffer.concat([
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
    Buffer.alloc(extra),
  ]);
  return { b64: buf.toString("base64"), sizeBytes: buf.length };
}

function makeWebp(extra = 100): { b64: string; sizeBytes: number } {
  const buf = Buffer.concat([
    Buffer.from([0x52, 0x49, 0x46, 0x46]), // "RIFF"
    Buffer.alloc(4),                         // file size (ignored)
    Buffer.from([0x57, 0x45, 0x42, 0x50]), // "WEBP"
    Buffer.alloc(extra),
  ]);
  return { b64: buf.toString("base64"), sizeBytes: buf.length };
}

function makeImageAttachment(overrides?: Partial<NormalizedImageAttachment>): NormalizedImageAttachment {
  const img = makePng();
  return {
    id:       "img1",
    name:     "test.png",
    mimeType: "image/png",
    category: "image",
    image:    { dataBase64: img.b64 },
    metadata: { sizeBytes: img.sizeBytes, parser: "image-native", truncated: false, extractionMs: 1 },
    estimatedTokens: estimateImageTokens(img.sizeBytes),
    ...overrides,
  };
}

// ── estimateImageTokens ───────────────────────────────────────────────────────

describe("estimateImageTokens", () => {
  it("returns the floor (85) for a very small image", () => {
    expect(estimateImageTokens(0)).toBe(85);
    expect(estimateImageTokens(1024)).toBe(85);
  });

  it("scales linearly above the floor", () => {
    const tokens = estimateImageTokens(4096 * 10); // 40 KB → ceil(40960/4096) = 10 → max(85, 10) = 85
    expect(tokens).toBe(85);

    const tokens2 = estimateImageTokens(4096 * 500); // 2 MB → ceil(2048000/4096) = 500 → max(85, min(500, 2048)) = 500
    expect(tokens2).toBe(500);
  });

  it("caps at 2048 for very large images", () => {
    expect(estimateImageTokens(100 * 1024 * 1024)).toBe(2048);
  });
});

// ── parseImageBuffer ──────────────────────────────────────────────────────────

describe("parseImageBuffer", () => {
  describe("valid images", () => {
    it("accepts a valid PNG", async () => {
      const { b64, sizeBytes } = makePng();
      const r = await parseImageBuffer("id1", "test.png", "image/png", b64, sizeBytes);
      expect("error" in r).toBe(false);
      if (!("error" in r)) {
        expect(r.category).toBe("image");
        expect(r.mimeType).toBe("image/png");
        expect(r.id).toBe("id1");
        expect(r.name).toBe("test.png");
        expect(r.metadata.parser).toBe("image-native");
        expect(r.metadata.truncated).toBe(false);
        expect(r.metadata.sizeBytes).toBe(sizeBytes);
        expect(r.estimatedTokens).toBeGreaterThanOrEqual(85);
      }
    });

    it("accepts a valid JPEG", async () => {
      const { b64, sizeBytes } = makeJpeg();
      const r = await parseImageBuffer("id2", "photo.jpg", "image/jpeg", b64, sizeBytes);
      expect("error" in r).toBe(false);
      if (!("error" in r)) {
        expect(r.mimeType).toBe("image/jpeg");
      }
    });

    it("accepts a valid JPEG declared as image/jpg (normalised)", async () => {
      const { b64, sizeBytes } = makeJpeg();
      const r = await parseImageBuffer("id2", "photo.jpg", "image/jpg", b64, sizeBytes);
      expect("error" in r).toBe(false);
    });

    it("accepts a valid WebP", async () => {
      const { b64, sizeBytes } = makeWebp();
      const r = await parseImageBuffer("id3", "banner.webp", "image/webp", b64, sizeBytes);
      expect("error" in r).toBe(false);
      if (!("error" in r)) {
        expect(r.mimeType).toBe("image/webp");
      }
    });

    it("does NOT include base64 content in metadata (privacy guard)", async () => {
      const { b64, sizeBytes } = makePng();
      const r = await parseImageBuffer("id1", "test.png", "image/png", b64, sizeBytes);
      if (!("error" in r)) {
        const meta = JSON.stringify(r.metadata);
        expect(meta).not.toContain(b64.slice(0, 20));
      }
    });
  });

  describe("rejection cases", () => {
    it("rejects file with invalid magic bytes → ATTACHMENT_IMAGE_INVALID", async () => {
      const fakeBuf = Buffer.from("This is not an image file content", "utf-8");
      const b64 = fakeBuf.toString("base64");
      const r = await parseImageBuffer("id", "bad.png", "image/png", b64, fakeBuf.length);
      expect("error" in r).toBe(true);
      if ("error" in r) {
        expect(r.error).toBe("ATTACHMENT_IMAGE_INVALID");
        expect(r.httpStatus).toBe(415);
      }
    });

    it("rejects a GIF (unsupported format) → ATTACHMENT_IMAGE_INVALID", async () => {
      // GIF magic: 47 49 46 38
      const gif = Buffer.concat([Buffer.from([0x47, 0x49, 0x46, 0x38]), Buffer.alloc(50)]);
      const b64 = gif.toString("base64");
      const r = await parseImageBuffer("id", "img.gif", "image/gif", b64, gif.length);
      expect("error" in r).toBe(true);
      if ("error" in r) {
        expect(r.error).toBe("ATTACHMENT_IMAGE_INVALID");
      }
    });

    it("rejects MIME mismatch (PNG content declared as JPEG) → ATTACHMENT_IMAGE_MIME_MISMATCH", async () => {
      const { b64, sizeBytes } = makePng();
      const r = await parseImageBuffer("id", "test.png", "image/jpeg", b64, sizeBytes);
      expect("error" in r).toBe(true);
      if ("error" in r) {
        expect(r.error).toBe("ATTACHMENT_IMAGE_MIME_MISMATCH");
        expect(r.httpStatus).toBe(400);
      }
    });

    it("rejects file exceeding per-image size limit → ATTACHMENT_IMAGE_TOO_LARGE", async () => {
      // 6 MB > 5 MB limit
      const oversizedBytes = 6 * 1024 * 1024;
      const smallBuf = makePng();
      const r = await parseImageBuffer("id", "big.png", "image/png", smallBuf.b64, oversizedBytes);
      expect("error" in r).toBe(true);
      if ("error" in r) {
        expect(r.error).toBe("ATTACHMENT_IMAGE_TOO_LARGE");
        expect(r.httpStatus).toBe(413);
      }
    });
  });
});

// ── buildProviderMessages ─────────────────────────────────────────────────────

describe("buildProviderMessages", () => {
  const baseArgs = {
    provider:    "openai" as const,
    systemPrompt: "Tu es un assistant.",
    history:     [] as Array<{ role: "system" | "user" | "assistant"; content: string }>,
    userMessage: "Bonjour",
    imageAttachments: [] as NormalizedImageAttachment[],
  };

  it("text-only path: all content fields are strings", () => {
    const msgs = buildProviderMessages(baseArgs);
    expect(msgs).toHaveLength(2); // system + user
    const [sys, usr] = msgs;
    expect(sys.role).toBe("system");
    expect(typeof sys.content).toBe("string");
    expect(usr.role).toBe("user");
    expect(typeof usr.content).toBe("string");
    expect(usr.content).toBe("Bonjour");
  });

  it("text-only path: history is preserved between system and user", () => {
    const history = [
      { role: "user" as const,      content: "Premier message" },
      { role: "assistant" as const, content: "Première réponse" },
    ];
    const msgs = buildProviderMessages({ ...baseArgs, history });
    expect(msgs).toHaveLength(4); // system + 2 history + user
    expect(msgs[1].content).toBe("Premier message");
    expect(msgs[2].content).toBe("Première réponse");
    expect(msgs[3].content).toBe("Bonjour");
  });

  it("multimodal path: user message content is ContentBlock[]", () => {
    const img = makeImageAttachment();
    const msgs = buildProviderMessages({ ...baseArgs, imageAttachments: [img] });
    const userMsg = msgs[msgs.length - 1];
    expect(Array.isArray(userMsg.content)).toBe(true);
    if (Array.isArray(userMsg.content)) {
      expect(userMsg.content[0]).toEqual({ type: "text", text: "Bonjour" });
      expect(userMsg.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    }
  });

  it("multimodal path: text block comes before image block(s)", () => {
    const img = makeImageAttachment();
    const msgs = buildProviderMessages({ ...baseArgs, imageAttachments: [img] });
    const userMsg = msgs[msgs.length - 1];
    if (Array.isArray(userMsg.content)) {
      expect(userMsg.content[0].type).toBe("text");
      expect(userMsg.content[1].type).toBe("image");
    }
  });

  it("multimodal path: multiple images → multiple image blocks in order", () => {
    const img1 = makeImageAttachment({ id: "a", name: "a.png" });
    const img2 = makeImageAttachment({ id: "b", name: "b.png", mimeType: "image/jpeg" });
    const msgs = buildProviderMessages({ ...baseArgs, imageAttachments: [img1, img2] });
    const userMsg = msgs[msgs.length - 1];
    if (Array.isArray(userMsg.content)) {
      expect(userMsg.content).toHaveLength(3); // text + 2 images
      expect(userMsg.content[0].type).toBe("text");
      const img1Block = userMsg.content[1];
      const img2Block = userMsg.content[2];
      expect(img1Block.type).toBe("image");
      expect(img2Block.type).toBe("image");
      if (img1Block.type === "image") expect(img1Block.mimeType).toBe("image/png");
      if (img2Block.type === "image") expect(img2Block.mimeType).toBe("image/jpeg");
    }
  });

  it("multimodal path: system message is always a string (no image in system)", () => {
    const img = makeImageAttachment();
    const msgs = buildProviderMessages({ ...baseArgs, imageAttachments: [img] });
    const sys = msgs[0];
    expect(sys.role).toBe("system");
    expect(typeof sys.content).toBe("string");
  });

  it("multimodal path: system prompt text is preserved unchanged", () => {
    const UNIQUE = "UNIQUE_SYSTEM_MARKER_XYZ";
    const img = makeImageAttachment();
    const msgs = buildProviderMessages({ ...baseArgs, systemPrompt: UNIQUE, imageAttachments: [img] });
    const sys = msgs[0];
    expect(sys.content).toBe(UNIQUE);
  });

  it("provider=anthropic returns same structure (provider param reserved, not active)", () => {
    const img = makeImageAttachment();
    const msgs = buildProviderMessages({ ...baseArgs, provider: "anthropic", imageAttachments: [img] });
    const userMsg = msgs[msgs.length - 1];
    expect(Array.isArray(userMsg.content)).toBe(true);
  });
});

// ── getImageUsageMetadata ─────────────────────────────────────────────────────

describe("getImageUsageMetadata", () => {
  it("returns empty object when no images", () => {
    expect(getImageUsageMetadata([])).toEqual({});
  });

  it("returns correct metadata for one image", () => {
    const img = makeImageAttachment();
    const meta = getImageUsageMetadata([img]);
    expect(meta.hasImages).toBe(true);
    expect(meta.imageCount).toBe(1);
    expect(meta.imageTotalBytes).toBe(img.metadata.sizeBytes);
    expect(meta.imageEstimatedTokens).toBe(img.estimatedTokens);
    expect(Array.isArray(meta.imageFormats)).toBe(true);
    expect((meta.imageFormats as string[])).toContain("image/png");
  });

  it("aggregates multiple images", () => {
    const img1 = makeImageAttachment({ id: "a" });
    const img2 = makeImageAttachment({
      id: "b", name: "photo.jpg", mimeType: "image/jpeg",
      metadata: { sizeBytes: 200, parser: "image-native", truncated: false, extractionMs: 1 },
      estimatedTokens: 85,
    });
    const meta = getImageUsageMetadata([img1, img2]);
    expect(meta.imageCount).toBe(2);
    const formats = meta.imageFormats as string[];
    expect(formats).toContain("image/png");
    expect(formats).toContain("image/jpeg");
  });

  it("does NOT include base64 data in metadata", () => {
    const img = makeImageAttachment();
    const meta = JSON.stringify(getImageUsageMetadata([img]));
    const b64sample = img.image.dataBase64.slice(0, 20);
    expect(meta).not.toContain(b64sample);
  });
});

// ── isImageAttachment ─────────────────────────────────────────────────────────

describe("isImageAttachment", () => {
  it("returns true for NormalizedImageAttachment", () => {
    const img = makeImageAttachment();
    expect(isImageAttachment(img)).toBe(true);
  });

  it("returns false for a text NormalizedAttachment", () => {
    const txt = {
      id:            "t1",
      name:          "doc.txt",
      mimeType:      "text/plain",
      category:      "text" as const,
      extractedText: "hello",
      metadata:      { truncated: false, charCount: 5 },
      estimatedTokens: 2,
    };
    expect(isImageAttachment(txt as never)).toBe(false);
  });
});

// ── Dimension extraction and enforcement ──────────────────────────────────────

// Build a minimal PNG buffer with explicit IHDR dimensions.
// Layout: magic(8) + chunk_len(4) + "IHDR"(4) + width(4BE) + height(4BE) = 24 bytes.
function makePngWithDims(width: number, height: number): { b64: string; sizeBytes: number } {
  const buf = Buffer.alloc(24, 0);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47;
  buf[4] = 0x0D; buf[5] = 0x0A; buf[6] = 0x1A; buf[7] = 0x0A; // PNG magic
  buf.writeUInt32BE(13, 8);             // IHDR data length = 13
  buf.write("IHDR", 12, "ascii");       // chunk type
  buf.writeUInt32BE(width,  16);        // width  at bytes 16-19
  buf.writeUInt32BE(height, 20);        // height at bytes 20-23
  return { b64: buf.toString("base64"), sizeBytes: buf.length };
}

// Build a minimal JPEG buffer with a SOF0 marker immediately after SOI.
// Layout: SOI(2) + SOF0_marker(2) + seg_len(2) + precision(1) + height(2BE) + width(2BE) + …
function makeJpegWithDims(width: number, height: number): { b64: string; sizeBytes: number } {
  const buf = Buffer.alloc(20, 0);
  buf[0] = 0xFF; buf[1] = 0xD8;          // SOI
  buf[2] = 0xFF; buf[3] = 0xC0;          // SOF0 marker
  buf[4] = 0x00; buf[5] = 0x11;          // segment length = 17
  buf[6] = 0x08;                          // precision = 8 bits
  buf.writeUInt16BE(height, 7);           // height at scanner offset i+5 = 7
  buf.writeUInt16BE(width,  9);           // width  at scanner offset i+7 = 9
  return { b64: buf.toString("base64"), sizeBytes: buf.length };
}

// Build a minimal VP8X (extended WebP) buffer.
// Layout: RIFF(4)+size(4)+WEBP(4)+VP8X(4)+chunk_size(4)+flags(4)+width-1(3LE)+height-1(3LE)
function makeWebpVP8X(width: number, height: number): { b64: string; sizeBytes: number } {
  const buf = Buffer.alloc(30, 0);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);              // file size (arbitrary)
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8X", 12, "ascii");
  buf.writeUInt32LE(10, 16);             // VP8X chunk data size = 10 bytes
  // flags at bytes 20-23 (all zero = no animation, alpha, etc.)
  // canvas_width_minus_one: 3 bytes LE at bytes 24-26
  const wm1 = width - 1;
  buf[24] = wm1 & 0xFF;
  buf[25] = (wm1 >> 8) & 0xFF;
  buf[26] = (wm1 >> 16) & 0xFF;
  // canvas_height_minus_one: 3 bytes LE at bytes 27-29
  const hm1 = height - 1;
  buf[27] = hm1 & 0xFF;
  buf[28] = (hm1 >> 8) & 0xFF;
  buf[29] = (hm1 >> 16) & 0xFF;
  return { b64: buf.toString("base64"), sizeBytes: buf.length };
}

describe("parseImageBuffer — dimension extraction and enforcement", () => {
  // ── PNG ──────────────────────────────────────────────────────────────────

  it("PNG 1×1 — accepted (within limits)", async () => {
    const { b64, sizeBytes } = makePngWithDims(1, 1);
    const r = await parseImageBuffer("d1", "tiny.png", "image/png", b64, sizeBytes);
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.image.width).toBe(1);
      expect(r.image.height).toBe(1);
    }
  });

  it("PNG 4096×4096 — accepted (exactly at limit)", async () => {
    const { b64, sizeBytes } = makePngWithDims(4096, 4096);
    const r = await parseImageBuffer("d2", "limit.png", "image/png", b64, sizeBytes);
    expect("error" in r).toBe(false);
  });

  it("PNG 4097×1 — rejected ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE (413)", async () => {
    const { b64, sizeBytes } = makePngWithDims(4097, 1);
    const r = await parseImageBuffer("d3", "wide.png", "image/png", b64, sizeBytes);
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toBe("ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE");
      expect(r.httpStatus).toBe(413);
      expect(r.message).toContain("4097");
    }
  });

  it("PNG 1×5000 — rejected ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE (413)", async () => {
    const { b64, sizeBytes } = makePngWithDims(1, 5000);
    const r = await parseImageBuffer("d4", "tall.png", "image/png", b64, sizeBytes);
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toBe("ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE");
      expect(r.httpStatus).toBe(413);
    }
  });

  it("PNG truncated header (< 24 bytes) — rejected ATTACHMENT_IMAGE_INVALID (415)", async () => {
    // 15 bytes: PNG magic (8) + 7 padding bytes — too short to contain IHDR width/height
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      Buffer.alloc(7),
    ]);
    const b64 = buf.toString("base64");
    const r = await parseImageBuffer("d5", "trunc.png", "image/png", b64, buf.length);
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toBe("ATTACHMENT_IMAGE_INVALID");
      expect(r.httpStatus).toBe(415);
    }
  });

  // ── JPEG ─────────────────────────────────────────────────────────────────

  it("JPEG 100×200 — accepted, dimensions stored", async () => {
    const { b64, sizeBytes } = makeJpegWithDims(100, 200);
    const r = await parseImageBuffer("d6", "photo.jpg", "image/jpeg", b64, sizeBytes);
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.image.width).toBe(100);
      expect(r.image.height).toBe(200);
    }
  });

  it("JPEG 5000×100 — rejected ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE", async () => {
    const { b64, sizeBytes } = makeJpegWithDims(5000, 100);
    const r = await parseImageBuffer("d7", "wide.jpg", "image/jpeg", b64, sizeBytes);
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toBe("ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE");
    }
  });

  // ── WebP VP8X ────────────────────────────────────────────────────────────

  it("WebP VP8X 300×400 — accepted, dimensions stored", async () => {
    const { b64, sizeBytes } = makeWebpVP8X(300, 400);
    const r = await parseImageBuffer("d8", "banner.webp", "image/webp", b64, sizeBytes);
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.image.width).toBe(300);
      expect(r.image.height).toBe(400);
    }
  });

  it("WebP VP8X 5000×100 — rejected ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE", async () => {
    const { b64, sizeBytes } = makeWebpVP8X(5000, 100);
    const r = await parseImageBuffer("d9", "huge.webp", "image/webp", b64, sizeBytes);
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toBe("ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE");
      expect(r.httpStatus).toBe(413);
    }
  });

  // ── Dimension stored in result ────────────────────────────────────────────

  it("accepted PNG includes width and height in image field", async () => {
    const { b64, sizeBytes } = makePngWithDims(800, 600);
    const r = await parseImageBuffer("d10", "img.png", "image/png", b64, sizeBytes);
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.image.width).toBe(800);
      expect(r.image.height).toBe(600);
    }
  });
});
