import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { escapeHtml } from "./html-escape";
import { isAllowedMarketingOrigin } from "./request-origin";

function requestForOrigin({
  origin,
  referer,
  protocol = "https",
  host = "flowpoint-staging.onrender.com",
}: {
  origin?: string;
  referer?: string;
  protocol?: string;
  host?: string;
} = {}): Request {
  return {
    headers: { origin, referer },
    protocol,
    get: (header: string) => (header.toLowerCase() === "host" ? host : undefined),
  } as unknown as Request;
}

test("accepts same-origin requests from the Render staging host", () => {
  assert.equal(
    isAllowedMarketingOrigin(
      requestForOrigin({ origin: "https://flowpoint-staging.onrender.com" }),
    ),
    true,
  );
});

test("continues allowing the FlowPoint application origins", () => {
  assert.equal(
    isAllowedMarketingOrigin(
      requestForOrigin({ origin: "https://app.flowpoint.pro" }),
    ),
    true,
  );
});

test("rejects a cross-site origin and missing origin headers", () => {
  assert.equal(
    isAllowedMarketingOrigin(requestForOrigin({ origin: "https://attacker.test" })),
    false,
  );
  assert.equal(isAllowedMarketingOrigin(requestForOrigin()), false);
});

test("escapes user-controlled contact fields before email HTML rendering", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')">&`),
    "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;",
  );
});
