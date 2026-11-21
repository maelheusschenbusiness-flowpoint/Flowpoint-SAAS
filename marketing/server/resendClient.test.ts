import assert from "node:assert/strict";
import test from "node:test";
import { getUncachableResendClient } from "./resendClient";

const environmentKeys = [
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "REPL_IDENTITY",
  "WEB_REPL_RENEWAL",
  "REPLIT_CONNECTORS_HOSTNAME",
] as const;

async function withEnvironment(
  values: Partial<Record<(typeof environmentKeys)[number], string | undefined>>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map(
    environmentKeys.map((key) => [key, process.env[key]]),
  );

  try {
    for (const key of environmentKeys) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const key of environmentKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Resend uses standard server environment variables outside Replit", async () => {
  await withEnvironment(
    {
      RESEND_API_KEY: "re_test_placeholder",
      RESEND_FROM_EMAIL: "staging@example.test",
    },
    async () => {
      const { client, fromEmail } = await getUncachableResendClient();
      assert.ok(client);
      assert.equal(fromEmail, "staging@example.test");
    },
  );
});

test("Resend reports missing environment setup without requiring a Replit connector", async () => {
  await withEnvironment({}, async () => {
    await assert.rejects(
      () => getUncachableResendClient(),
      /RESEND_API_KEY must be configured outside Replit/,
    );
  });
});
