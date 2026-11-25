import { describe, expect, it } from "vitest";
import {
  buildExtToMimes,
  extractExtension,
  sanitizeFilename,
  validateMimeExtConsistency,
} from "./file-validation.js";

const ALLOWED_MIME_FIXTURE: Record<string, string> = {
  "image/jpeg":       "jpg",
  "image/pjpeg":      "jpg",
  "image/png":        "png",
  "application/x-pdf": "pdf",
};

const EXT_TO_MIMES_FIXTURE = buildExtToMimes(ALLOWED_MIME_FIXTURE);

describe("sanitizeFilename", () => {
  it("retire les segments de chemin ../ et ne garde que le nom de base", () => {
    expect(sanitizeFilename("../../dossier/rapport.txt")).toBe("rapport.txt");
    expect(sanitizeFilename("/tmp/sous/dossier/rapport.txt")).toBe("rapport.txt");
  });

  it("supprime les antislashs restants", () => {
    expect(sanitizeFilename("dossier\\rapport.txt")).toBe("dossierrapport.txt");
    expect(sanitizeFilename("..\\..\\rapport.txt")).toBe(".rapport.txt");
  });

  it("remplace les caracteres interdits par _", () => {
    expect(sanitizeFilename("fich*ier?no:1.txt")).toBe("fich_ier_no_1.txt");
    expect(sanitizeFilename("rapport (final) #2.txt")).toBe("rapport _final_ _2.txt");
  });

  it("conserve lettres, chiffres, espace, point, underscore et tiret", () => {
    expect(sanitizeFilename("Mon rapport-2 _v1.txt")).toBe("Mon rapport-2 _v1.txt");
  });

  it("reduit toute suite de points en un seul point", () => {
    expect(sanitizeFilename("rapport...txt")).toBe("rapport.txt");
    expect(sanitizeFilename("rapport..final....txt")).toBe("rapport.final.txt");
  });

  it("tronque a 200 caracteres", () => {
    const long = sanitizeFilename(`${"a".repeat(250)}.txt`);
    expect(long).toHaveLength(200);
    expect(long).toBe("a".repeat(200));
  });

  it("se replie sur \"file\" pour une entree vide", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("/")).toBe("file");
  });
});

describe("extractExtension", () => {
  it("rend l'extension en minuscules", () => {
    expect(extractExtension("Rapport.TXT")).toBe("txt");
    expect(extractExtension("photo.JpG")).toBe("jpg");
  });

  it("prend le dernier segment pour un nom a plusieurs points", () => {
    expect(extractExtension("archive.tar.GZ")).toBe("gz");
  });

  it("sans point, rend le nom entier en minuscules", () => {
    expect(extractExtension("RAPPORT")).toBe("rapport");
  });

  it("rend une chaine vide pour une entree vide ou un point final", () => {
    expect(extractExtension("")).toBe("");
    expect(extractExtension("rapport.")).toBe("");
  });
});

describe("buildExtToMimes", () => {
  it("regroupe plusieurs MIME sous la meme extension", () => {
    expect(buildExtToMimes(ALLOWED_MIME_FIXTURE)).toEqual({
      jpg: ["image/jpeg", "image/pjpeg"],
      png: ["image/png"],
      pdf: ["application/x-pdf"],
    });
  });

  it("rend un objet vide pour une table vide", () => {
    expect(buildExtToMimes({})).toEqual({});
  });
});

describe("validateMimeExtConsistency", () => {
  it("rend null si l'extension n'est pas autorisee", () => {
    expect(
      validateMimeExtConsistency("image/jpeg", "rapport.exe", ALLOWED_MIME_FIXTURE, EXT_TO_MIMES_FIXTURE),
    ).toBeNull();
  });

  it("rend null si le MIME fourni n'est pas autorise", () => {
    expect(
      validateMimeExtConsistency("image/gif", "photo.jpg", ALLOWED_MIME_FIXTURE, EXT_TO_MIMES_FIXTURE),
    ).toBeNull();
  });

  it("rend null si le MIME fourni ne correspond pas a l'extension", () => {
    expect(
      validateMimeExtConsistency("image/png", "photo.jpg", ALLOWED_MIME_FIXTURE, EXT_TO_MIMES_FIXTURE),
    ).toBeNull();
  });

  it("rend le MIME fourni quand il est coherent avec l'extension", () => {
    expect(
      validateMimeExtConsistency("image/pjpeg", "Photo.JPG", ALLOWED_MIME_FIXTURE, EXT_TO_MIMES_FIXTURE),
    ).toBe("image/pjpeg");
  });

  it("rend le premier MIME de l'extension quand aucun MIME n'est fourni", () => {
    expect(
      validateMimeExtConsistency(undefined, "photo.jpg", ALLOWED_MIME_FIXTURE, EXT_TO_MIMES_FIXTURE),
    ).toBe("image/jpeg");
    expect(
      validateMimeExtConsistency("", "rapport.pdf", ALLOWED_MIME_FIXTURE, EXT_TO_MIMES_FIXTURE),
    ).toBe("application/x-pdf");
  });
});
