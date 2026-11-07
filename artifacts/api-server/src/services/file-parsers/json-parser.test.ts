/**
 * json-parser.test.ts — parseJsonBuffer face a un BOM UTF-8 initial.
 *
 * Un fichier JSON enregistre sous Windows commence souvent par un BOM UTF-8
 * (EF BB BF). JSON.parse le rejette, alors que le contenu est valide : le
 * parseur doit le retirer avant l'analyse, sans rien changer d'autre.
 *
 * Couvre :
 *   - JSON valide avec BOM : analyse et contenu rendu
 *   - JSON invalide avec BOM : ATTACHMENT_JSON_INVALID
 *   - cle sensible avec BOM : valeur masquee par [REDACTED]
 *   - JSON trop profond avec BOM : ATTACHMENT_JSON_TOO_DEEP
 */

import { describe, it, expect } from "vitest";

import { parseJsonBuffer } from "./json-parser.js";

const BOM = "﻿";

function bufWithBom(text: string): Buffer {
  return Buffer.from(BOM + text, "utf-8");
}

describe("parseJsonBuffer — BOM UTF-8 initial", () => {
  it("analyse un JSON valide precede d'un BOM et rend son contenu", () => {
    const buf = bufWithBom(JSON.stringify({ name: "FlowPoint", count: 3 }));

    const r = parseJsonBuffer(buf, 10, 10_000);

    expect("error" in r).toBe(false);
    if ("error" in r) return;

    expect(JSON.parse(r.text)).toEqual({ name: "FlowPoint", count: 3 });
    expect(r.truncated).toBe(false);
    expect(r.charCount).toBe(r.text.length);
    // Le BOM n'est pas conserve dans la sortie.
    expect(r.text.charCodeAt(0)).not.toBe(0xFEFF);
  });

  it("rend ATTACHMENT_JSON_INVALID pour un JSON reellement invalide precede d'un BOM", () => {
    const buf = bufWithBom('{"name": "FlowPoint",}');

    const r = parseJsonBuffer(buf, 10, 10_000);

    expect(r).toEqual({ error: "ATTACHMENT_JSON_INVALID" });
  });

  it("masque une cle sensible par [REDACTED] dans un JSON precede d'un BOM", () => {
    const buf = bufWithBom(
      JSON.stringify({ user: "mael", password: "hunter2", tokenCount: 42 }),
    );

    const r = parseJsonBuffer(buf, 10, 10_000);

    expect("error" in r).toBe(false);
    if ("error" in r) return;

    expect(JSON.parse(r.text)).toEqual({
      user:       "mael",
      password:   "[REDACTED]",
      tokenCount: 42,
    });
    expect(r.text).not.toContain("hunter2");
  });

  it("rend toujours ATTACHMENT_JSON_TOO_DEEP pour un JSON trop profond, avec ou sans BOM", () => {
    const deep = JSON.stringify({ a: { b: { c: { d: 1 } } } });

    expect(parseJsonBuffer(bufWithBom(deep), 2, 10_000)).toEqual({
      error: "ATTACHMENT_JSON_TOO_DEEP",
    });
    expect(parseJsonBuffer(Buffer.from(deep, "utf-8"), 2, 10_000)).toEqual({
      error: "ATTACHMENT_JSON_TOO_DEEP",
    });
  });
});
