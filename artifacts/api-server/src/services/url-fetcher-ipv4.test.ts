/**
 * Unit tests for isPrivateIpv4Address() — the numeric CIDR-based IPv4 SSRF classifier.
 *
 * The shared isPrivateHost() uses regexes that miss several non-globally-routable
 * IPv4 ranges. These tests document every class of addresses that must be blocked
 * plus public addresses that must NOT be blocked.
 */

import { describe, it, expect } from "vitest";
import { isPrivateIpv4Address } from "./url-fetcher.js";

describe("isPrivateIpv4Address — 0.0.0.0/8 (this network)", () => {
  it("blocks 0.0.0.0 (root of this-network range)", () => {
    expect(isPrivateIpv4Address("0.0.0.0")).toBe(true);
  });
  it("blocks 0.0.0.1 (non-routable this-network address missed by old regex)", () => {
    expect(isPrivateIpv4Address("0.0.0.1")).toBe(true);
  });
  it("blocks 0.255.255.255 (last address in 0/8)", () => {
    expect(isPrivateIpv4Address("0.255.255.255")).toBe(true);
  });
});

describe("isPrivateIpv4Address — 10.0.0.0/8 (RFC 1918)", () => {
  it("blocks 10.0.0.1", () => {
    expect(isPrivateIpv4Address("10.0.0.1")).toBe(true);
  });
  it("blocks 10.255.255.254 (last valid in range)", () => {
    expect(isPrivateIpv4Address("10.255.255.254")).toBe(true);
  });
});

describe("isPrivateIpv4Address — 127.0.0.0/8 (loopback)", () => {
  it("blocks 127.0.0.1 (standard loopback)", () => {
    expect(isPrivateIpv4Address("127.0.0.1")).toBe(true);
  });
  it("blocks 127.255.255.255 (last loopback)", () => {
    expect(isPrivateIpv4Address("127.255.255.255")).toBe(true);
  });
});

describe("isPrivateIpv4Address — 169.254.0.0/16 (link-local / cloud metadata)", () => {
  it("blocks 169.254.169.254 (AWS/GCP/Azure metadata endpoint)", () => {
    expect(isPrivateIpv4Address("169.254.169.254")).toBe(true);
  });
  it("blocks 169.254.0.1 (link-local start)", () => {
    expect(isPrivateIpv4Address("169.254.0.1")).toBe(true);
  });
});

describe("isPrivateIpv4Address — 172.16.0.0/12 (RFC 1918)", () => {
  it("blocks 172.16.0.1", () => {
    expect(isPrivateIpv4Address("172.16.0.1")).toBe(true);
  });
  it("blocks 172.31.255.254 (last in range)", () => {
    expect(isPrivateIpv4Address("172.31.255.254")).toBe(true);
  });
});

describe("isPrivateIpv4Address — 192.168.0.0/16 (RFC 1918)", () => {
  it("blocks 192.168.1.1", () => {
    expect(isPrivateIpv4Address("192.168.1.1")).toBe(true);
  });
});

describe("isPrivateIpv4Address — 224.0.0.0/4 (IPv4 multicast, missed by old regex)", () => {
  it("blocks 224.0.0.1 (all routers multicast)", () => {
    expect(isPrivateIpv4Address("224.0.0.1")).toBe(true);
  });
  it("blocks 239.255.255.255 (last multicast address)", () => {
    expect(isPrivateIpv4Address("239.255.255.255")).toBe(true);
  });
  it("blocks 224.0.0.0 (root of multicast range)", () => {
    expect(isPrivateIpv4Address("224.0.0.0")).toBe(true);
  });
});

describe("isPrivateIpv4Address — 240.0.0.0/4 (IANA reserved/experimental)", () => {
  it("blocks 240.0.0.1 (first reserved address)", () => {
    expect(isPrivateIpv4Address("240.0.0.1")).toBe(true);
  });
  it("blocks 254.255.255.255 (last before broadcast)", () => {
    expect(isPrivateIpv4Address("254.255.255.255")).toBe(true);
  });
});

describe("isPrivateIpv4Address — 255.255.255.255 (limited broadcast)", () => {
  it("blocks 255.255.255.255 (broadcast, missed by old regex)", () => {
    expect(isPrivateIpv4Address("255.255.255.255")).toBe(true);
  });
});

describe("isPrivateIpv4Address — 100.64.0.0/10 (CGNAT)", () => {
  it("blocks 100.64.0.1 (CGNAT start)", () => {
    expect(isPrivateIpv4Address("100.64.0.1")).toBe(true);
  });
  it("blocks 100.127.255.254 (CGNAT end)", () => {
    expect(isPrivateIpv4Address("100.127.255.254")).toBe(true);
  });
});

describe("isPrivateIpv4Address — fail-closed on invalid input", () => {
  it("blocks malformed address (too few octets)", () => {
    expect(isPrivateIpv4Address("1.2.3")).toBe(true);
  });
  it("blocks address with out-of-range octet", () => {
    expect(isPrivateIpv4Address("256.0.0.1")).toBe(true);
  });
  it("blocks address with non-numeric octet", () => {
    expect(isPrivateIpv4Address("a.b.c.d")).toBe(true);
  });
  it("blocks address with octal notation (0x prefix)", () => {
    // 0x7f = 127 decimal — octal notation should be rejected (fail-closed)
    expect(isPrivateIpv4Address("0127.0.0.1")).toBe(true);
  });
});

describe("isPrivateIpv4Address — public/globally-routable (must NOT be blocked)", () => {
  it("allows 8.8.8.8 (Google DNS)", () => {
    expect(isPrivateIpv4Address("8.8.8.8")).toBe(false);
  });
  it("allows 1.1.1.1 (Cloudflare DNS)", () => {
    expect(isPrivateIpv4Address("1.1.1.1")).toBe(false);
  });
  it("allows 93.184.216.34 (example.com)", () => {
    expect(isPrivateIpv4Address("93.184.216.34")).toBe(false);
  });
  it("allows 104.16.85.20 (Cloudflare CDN)", () => {
    expect(isPrivateIpv4Address("104.16.85.20")).toBe(false);
  });
  it("allows 172.67.1.1 (Cloudflare CDN, NOT in 172.16/12 range)", () => {
    // 172.67 > 172.31 (end of RFC 1918) → public
    expect(isPrivateIpv4Address("172.67.1.1")).toBe(false);
  });
  it("allows 11.0.0.1 (NOT in any private range; 10/8 ends at 10.255.255.255)", () => {
    expect(isPrivateIpv4Address("11.0.0.1")).toBe(false);
  });
  it("allows 100.128.0.1 (just outside CGNAT 100.64/10 range)", () => {
    expect(isPrivateIpv4Address("100.128.0.1")).toBe(false);
  });
  it("allows 223.255.255.255 (last address before multicast range)", () => {
    expect(isPrivateIpv4Address("223.255.255.255")).toBe(false);
  });
});
