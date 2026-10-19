import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import express from "express";
import compression from "compression";
import request from "supertest";

const require = createRequire(import.meta.url);
const mammothRequire = createRequire(require.resolve("mammoth"));
const excelRequire = createRequire(require.resolve("exceljs"));

describe("security dependency upgrade compatibility", () => {
  it("composes mail without contacting SMTP and normalizes IDN recipients", async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const result = await transport.sendMail({
      from: "FlowPoint <noreply@example.com>",
      to: "user@compa\u00adny.com",
      subject: "Activation",
      text: "Activate your account",
      html: "<p>Activate your account</p>",
    });
    expect(result.envelope.to).toEqual(["user@company.com"]);
    expect(result.message.toString()).toContain("Subject: Activation");
    expect(result.message.toString()).toContain("multipart/alternative");
  });

  it("retains Express routing and compression", async () => {
    const app = express();
    app.use(compression());
    app.get("/test", (_req, res) => res.json({ text: "FlowPoint ".repeat(1000) }));
    const response = await request(app).get("/test").set("Accept-Encoding", "gzip");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.body.text).toBe("FlowPoint ".repeat(1000));
  });

  it("does not trust arbitrary IPv4 clients for a short IPv6 proxy subnet", () => {
    const proxyaddr = createRequire(require.resolve("express"))("proxy-addr");
    expect(proxyaddr.compile("::ffff:10.0.0.0/8")("203.0.113.5")).toBe(false);
    expect(proxyaddr.compile("10.0.0.0/8")("10.1.2.3")).toBe(true);
  });

  it("round-trips Excel reports and rejects partial UUID buffer writes", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Report");
    sheet.addRow(["Score", 95]);
    // Comments exercise ExcelJS's transitive CommonJS uuid import.
    sheet.getCell("A1").note = "SEO score";
    const copy = new ExcelJS.Workbook();
    await copy.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(copy.getWorksheet("Report")!.getCell("B1").value).toBe(95);
    expect(copy.getWorksheet("Report")!.getCell("A1").note).toBeTruthy();
    const { v5 } = excelRequire("uuid");
    expect(() => v5("test", v5.DNS, new Uint8Array(8), 4)).toThrow(RangeError);
  });

  it("converts DOCX documents with Mammoth", async () => {
    const JSZip = mammothRequire("jszip");
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>FlowPoint report</w:t></w:r></w:p></w:body></w:document>');
    const result = await mammoth.convertToHtml({ buffer: await zip.generateAsync({ type: "nodebuffer" }) });
    expect(result.value).toContain("<p>FlowPoint report</p>");
  });

  it("preserves Mammoth CLI argument parsing without sprintf-js", () => {
    expect(mammothRequire("argparse/package.json").version).toBe("2.0.1");
    const output = execFileSync(process.execPath, [
      mammothRequire.resolve("mammoth/bin/mammoth"),
      "--help",
    ], { encoding: "utf8" });
    expect(output).toContain("--output-format");
    expect(output).toContain("docx-path");
  });

  it("keeps the logger's copy helper usable without prototype pollution", () => {
    const { copy } = createRequire(require.resolve("pino-pretty"))("fast-copy");
    const original = { level: 30, nested: { message: "test" } };
    expect(copy(original)).toEqual(original);
    expect(copy(original).nested).not.toBe(original.nested);
    const cloned = copy(JSON.parse('{"__proto__":{"polluted":true}}'));
    expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
