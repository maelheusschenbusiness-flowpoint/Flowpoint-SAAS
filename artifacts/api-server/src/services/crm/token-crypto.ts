import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement AES-256-GCM des jetons CRM au repos.
 * Cle INDEPENDANTE (CRM_TOKEN_ENCRYPTION_KEY, 32 octets en hex) : echec ferme si absente
 * ou mal formee -- aucun jeton n'est jamais stocke en clair.
 */
function encryptionKey(): Buffer {
  const raw = process.env["CRM_TOKEN_ENCRYPTION_KEY"] ?? "";
  if (!/^[a-f\d]{64}$/i.test(raw)) throw new Error("CRM_TOKEN_ENCRYPTION_KEY must be 32-byte hex");
  return Buffer.from(raw, "hex");
}

export function crmEncryptionConfigured(): boolean {
  return /^[a-f\d]{64}$/i.test(process.env["CRM_TOKEN_ENCRYPTION_KEY"] ?? "");
}

export function encryptCrmToken(value: string, key: Buffer = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${body.toString("hex")}`;
}

export function decryptCrmToken(value: string, key: Buffer = encryptionKey()): string {
  const [version, ivHex, tagHex, bodyHex] = value.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !bodyHex) throw new Error("Malformed encrypted CRM token");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(bodyHex, "hex")), decipher.final()]).toString("utf8");
}
