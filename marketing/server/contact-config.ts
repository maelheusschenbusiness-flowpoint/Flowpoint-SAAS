import { z } from "zod";

const DEFAULT_CONTACT_RECIPIENT = "support@flowpoint.pro";

export function getContactRecipient(
  value = process.env.CONTACT_TO_EMAIL,
): string {
  const recipient = value?.trim() || DEFAULT_CONTACT_RECIPIENT;
  const result = z.string().email().safeParse(recipient);
  if (!result.success) {
    throw new Error("CONTACT_TO_EMAIL must be a valid email address.");
  }
  return result.data;
}
