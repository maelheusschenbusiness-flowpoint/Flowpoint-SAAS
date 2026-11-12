import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { streamReportPdf } from "./pdf.js";

describe("consolidated Agency Reporting PDF", () => {
  it("renders aggregate metrics and each selected site's measured values", async () => {
    const chunks: Buffer[] = [];
    const headers = new Map<string, string>();
    const response = new PassThrough() as PassThrough & {
      setHeader(name: string, value: string): PassThrough;
    };
    response.setHeader = vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
      return response;
    });
    response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

    await streamReportPdf(
      response as never,
      {
        id: "agency-report-test",
        name: "Client — Rapport multi-sites",
        type: "REPORT",
        template_key: "executive",
        date: "2026-11-09T12:00:00.000Z",
        agencySites: [
          { url: "https://site-a.example/landing", auditDate: "2026-11-01T10:00:00.000Z", score: 91, speed: 84, issues: 3 },
          { url: "https://site-b.example", auditDate: "2026-11-02T10:00:00.000Z", score: 72, speed: 68, issues: 9 },
        ],
      },
      undefined,
      [{ title: "Must not appear", date: "2026-11-01", notes: "Unrelated note" }],
      [{ name: "Unrelated workspace monitor" }],
      [{ title: "Unrelated workspace mission" }],
    );

    const pdfBuffer = Buffer.concat(chunks);
    expect(pdfBuffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(headers.get("content-type")).toBe("application/pdf");
    expect(headers.get("content-disposition")).toContain("agency-report-test.pdf");

    // pdf-parse's public entry point loads a fixture at module import time; use
    // the same internal parser path as the production attachment parser.
    // @ts-ignore — pdf-parse sub-path is available in the pinned v1 package
    const parser = await import("pdf-parse/lib/pdf-parse.js") as {
      default: (input: Buffer) => Promise<{ text: string }>;
    };
    const parsed = await parser.default(pdfBuffer);

    expect(parsed.text).toContain("Rapport multi-sites");
    expect(parsed.text).toContain("Moyenne SEO des sites");
    expect(parsed.text).toContain("81.5/100");
    expect(parsed.text).toContain("76.0/100");
    expect(parsed.text).toContain("12");
    expect(parsed.text).toContain("https://site-a.example/landing");
    expect(parsed.text).toContain("https://site-b.example");
    expect(parsed.text).not.toContain("Must not appear");
    expect(parsed.text).not.toContain("Unrelated workspace monitor");
    expect(parsed.text).not.toContain("Unrelated workspace mission");
  });
});
