import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePublicAuditUrl,
  PublicAuditTargetError,
  createPinnedPublicAuditLookup,
  resolvePublicAuditRedirect,
  safePublicFetch,
  isPublicAuditAddress,
  validatePublicAuditResolution,
} from "./public-audit-fetch";

test("public destinations exclude private, local, mapped, and reserved networks", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:192.168.1.1",
    "2001:db8::1",
  ]) {
    assert.equal(isPublicAuditAddress(address), false, `${address} must be blocked`);
  }

  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
  ]) {
    assert.equal(isPublicAuditAddress(address), true, `${address} is public`);
  }
});

test("DNS answers reject mixed private records and pin validated addresses", () => {
  const publicAnswer = { address: "8.8.8.8", family: 4 } as const;
  const privateAnswer = { address: "127.0.0.1", family: 4 } as const;
  const validated = validatePublicAuditResolution([publicAnswer]);
  assert.throws(
    () => validatePublicAuditResolution([publicAnswer, privateAnswer]),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "blocked_destination",
  );
  assert.throws(
    () => validatePublicAuditResolution([]),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "blocked_destination",
  );

  const lookup = createPinnedPublicAuditLookup(validated);
  let resolvedAddress: string | undefined;
  let resolvedFamily: number | undefined;
  lookup("example.com", {}, (error, address, family) => {
    assert.ifError(error);
    resolvedAddress = address as string;
    resolvedFamily = family;
  });
  assert.equal(resolvedAddress, publicAnswer.address);
  assert.equal(resolvedFamily, publicAnswer.family);

  let resolvedAll: readonly { address: string; family: number }[] | undefined;
  lookup("example.com", { all: true }, (error, addresses) => {
    assert.ifError(error);
    resolvedAll = addresses;
  });
  assert.deepEqual(resolvedAll, [publicAnswer]);
});

test("URL normalization removes query strings and fragments", () => {
  const url = normalizePublicAuditUrl(
    "https://example.com/a-page?email=private%40example.com#details",
  );
  assert.equal(url.toString(), "https://example.com/a-page");
});

test("URL normalization rejects unsupported schemes, credentials, and ports", () => {
  for (const value of [
    "ftp://example.com",
    "https://user:password@example.com",
    "https://example.com:8443/",
  ]) {
    assert.throws(
      () => normalizePublicAuditUrl(value),
      (error) =>
        error instanceof PublicAuditTargetError &&
        error.code === "invalid_url",
    );
  }
});

test("private and metadata destinations are rejected before a request", async () => {
  for (const value of [
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://metadata.google.internal/",
    "http://localhost/",
  ]) {
    await assert.rejects(
      () => safePublicFetch(value),
      (error) =>
        error instanceof PublicAuditTargetError &&
        error.code === "blocked_destination",
    );
  }
});

test("same-origin resource checks reject a different initial origin", async () => {
  await assert.rejects(
    () =>
      safePublicFetch("https://example.com/", {
        expectedOrigin: "https://other.example",
      }),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "cross_origin_redirect",
  );
});

test("redirect validation normalizes relative targets and keeps resource checks same-origin", () => {
  const current = new URL("https://example.com/start");
  assert.equal(
    resolvePublicAuditRedirect(current, "../about?email=hidden#team", 0).toString(),
    "https://example.com/about",
  );
  assert.throws(
    () =>
      resolvePublicAuditRedirect(
        current,
        "https://other.example/page",
        0,
        1,
        "https://example.com",
      ),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "cross_origin_redirect",
  );
});

test("redirect validation rejects unsafe schemes and redirect loops", () => {
  const current = new URL("https://example.com/start");
  assert.throws(
    () => resolvePublicAuditRedirect(current, "javascript:alert(1)", 0),
    (error) =>
      error instanceof PublicAuditTargetError && error.code === "invalid_url",
  );
  assert.throws(
    () => resolvePublicAuditRedirect(current, "/next", 2, 2),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "too_many_redirects",
  );
});
