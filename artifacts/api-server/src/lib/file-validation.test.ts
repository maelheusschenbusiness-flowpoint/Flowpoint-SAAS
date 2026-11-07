import { describe, it, expect } from "vitest";
import { buildExtToMimes, extractExtension, validateMimeExtConsistency } from "./file-validation.js";

const ALLOWED_MIME: Record<string, string> = { "application/pdf": "pdf" };
const EXT_TO_MIMES = buildExtToMimes(ALLOWED_MIME);

describe("file-validation — ce qu'un nom de fichier prouve de son type", () => {
  it("rend en minuscules la partie qui suit le dernier point", () => {
    expect(extractExtension("rapport.PDF")).toBe("pdf");
    expect(extractExtension("archive.tar.gz")).toBe("gz");
  });

  it("ne voit aucune extension sans point interne", () => {
    expect(extractExtension("README")).toBe("");
    expect(extractExtension("pdf")).toBe("");
    expect(extractExtension(".env")).toBe("");
    expect(extractExtension("fichier.")).toBe("");
  });

  it("refuse de confirmer un fichier nomme « pdf » annonce comme application/pdf", () => {
    expect(validateMimeExtConsistency("application/pdf", "pdf", ALLOWED_MIME, EXT_TO_MIMES))
      .toBeNull();
  });

  it("confirme rapport.pdf annonce comme application/pdf", () => {
    expect(validateMimeExtConsistency("application/pdf", "rapport.pdf", ALLOWED_MIME, EXT_TO_MIMES))
      .toBe("application/pdf");
  });
});
