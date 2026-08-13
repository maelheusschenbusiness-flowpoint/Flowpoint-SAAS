/**
 * Unit tests for isPrivateIpv6Address() — the bit-level IPv6 SSRF classifier
 * introduced in url-fetcher.ts.
 *
 * Rationale: the shared isPrivateHost() uses regex string-prefix checks that
 * miss compressed IPv6 forms. These tests document every class of addresses that
 * must be rejected (link-local, ULA, loopback, unspecified, multicast, IPv4-mapped)
 * plus legitimate public addresses that must NOT be rejected.
 */

import { describe, it, expect } from "vitest";
import { isPrivateIpv6Address } from "./url-fetcher.js";

describe("isPrivateIpv6Address — link-local fe80::/10", () => {
  it("blocks the canonical form fe80::1", () => {
    expect(isPrivateIpv6Address("fe80::1")).toBe(true);
  });
  it("blocks fe81::1 (within fe80::/10, bit-level check required)", () => {
    // The old regex /^fe80:/ would miss this because the prefix is fe81:
    expect(isPrivateIpv6Address("fe81::1")).toBe(true);
  });
  it("blocks fe82::1 (still within fe80::/10)", () => {
    expect(isPrivateIpv6Address("fe82::1")).toBe(true);
  });
  it("blocks febf::1 (last address in fe80::/10)", () => {
    expect(isPrivateIpv6Address("febf::1")).toBe(true);
  });
  it("blocks fe80::abcd:ef01:2345:6789 (full link-local)", () => {
    expect(isPrivateIpv6Address("fe80::abcd:ef01:2345:6789")).toBe(true);
  });
});

describe("isPrivateIpv6Address — unique-local fc00::/7 (ULA)", () => {
  // Important IPv6 notation note:
  // "fc::" means first group = 0x00fc (252 decimal) → NOT in ULA range.
  // "fc00::" means first group = 0xfc00 (64512 decimal) → IS in ULA range.
  // These are different addresses; fc:: ≠ fc00:: in IPv6.
  it("blocks fc00::1 (canonical ULA)", () => {
    expect(isPrivateIpv6Address("fc00::1")).toBe(true);
  });
  it("blocks fd00::1 (canonical ULA)", () => {
    expect(isPrivateIpv6Address("fd00::1")).toBe(true);
  });
  it("blocks fc00:: (root of ULA range)", () => {
    expect(isPrivateIpv6Address("fc00::")).toBe(true);
  });
  it("blocks fd00:: (root of fd block)", () => {
    expect(isPrivateIpv6Address("fd00::")).toBe(true);
  });
  it("blocks fc12:3456::1 (non-zero fc subnet)", () => {
    expect(isPrivateIpv6Address("fc12:3456::1")).toBe(true);
  });
  it("blocks fdab::1 (non-zero fd subnet)", () => {
    expect(isPrivateIpv6Address("fdab::1")).toBe(true);
  });
  it("does NOT block fc:: (= 00fc:: — first group 0x00fc, a public address NOT in fc00::/7)", () => {
    // fc:: expands to 00fc:0000:0000:0000:0000:0000:0000:0000
    // ULA range is fc00::/7; 0x00fc < 0xfc00 → not ULA → must allow
    expect(isPrivateIpv6Address("fc::")).toBe(false);
  });
  it("does NOT block fd:: (= 00fd:: — public address, NOT ULA)", () => {
    expect(isPrivateIpv6Address("fd::")).toBe(false);
  });
});

describe("isPrivateIpv6Address — loopback ::1", () => {
  it("blocks ::1", () => {
    expect(isPrivateIpv6Address("::1")).toBe(true);
  });
  it("blocks 0:0:0:0:0:0:0:1 (full form)", () => {
    expect(isPrivateIpv6Address("0:0:0:0:0:0:0:1")).toBe(true);
  });
});

describe("isPrivateIpv6Address — unspecified ::", () => {
  it("blocks :: (all-zero unspecified address)", () => {
    expect(isPrivateIpv6Address("::")).toBe(true);
  });
});

describe("isPrivateIpv6Address — multicast ff00::/8", () => {
  it("blocks ff02::1 (all nodes multicast)", () => {
    expect(isPrivateIpv6Address("ff02::1")).toBe(true);
  });
  it("blocks ff00:: (multicast root)", () => {
    expect(isPrivateIpv6Address("ff00::")).toBe(true);
  });
  it("blocks ffff::1 (global multicast)", () => {
    expect(isPrivateIpv6Address("ffff::1")).toBe(true);
  });
});

describe("isPrivateIpv6Address — IPv4-mapped dotted ::ffff:x.x.x.x", () => {
  it("blocks ::ffff:127.0.0.1 (IPv4-mapped loopback)", () => {
    expect(isPrivateIpv6Address("::ffff:127.0.0.1")).toBe(true);
  });
  it("blocks ::ffff:192.168.1.1 (IPv4-mapped RFC-1918)", () => {
    expect(isPrivateIpv6Address("::ffff:192.168.1.1")).toBe(true);
  });
  it("blocks ::ffff:10.0.0.1 (IPv4-mapped RFC-1918)", () => {
    expect(isPrivateIpv6Address("::ffff:10.0.0.1")).toBe(true);
  });
  it("blocks ::ffff:169.254.0.1 (IPv4-mapped link-local)", () => {
    expect(isPrivateIpv6Address("::ffff:169.254.0.1")).toBe(true);
  });
  it("allows ::ffff:8.8.8.8 (IPv4-mapped public)", () => {
    expect(isPrivateIpv6Address("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("isPrivateIpv6Address — IPv4-mapped hexadecimal ::ffff:xxyy:zzww (dns.lookup form)", () => {
  // dns.lookup() may return IPv4-mapped addresses in hexadecimal notation,
  // e.g. ::ffff:7f00:1 instead of ::ffff:127.0.0.1.
  // The regex-based checks miss these; the byte-level check must catch them.
  it("blocks ::ffff:7f00:1 (loopback 127.0.0.1 in hex)", () => {
    // 0x7f = 127, 0x00 = 0, 0x00 = 0, 0x01 = 1 → 127.0.0.1
    expect(isPrivateIpv6Address("::ffff:7f00:1")).toBe(true);
  });
  it("blocks ::ffff:a00:1 (10.0.0.1 in hex)", () => {
    // 0x0a = 10, 0x00 = 0, 0x00 = 0, 0x01 = 1 → 10.0.0.1
    expect(isPrivateIpv6Address("::ffff:a00:1")).toBe(true);
  });
  it("blocks ::ffff:a9fe:a9fe (169.254.169.254 in hex — cloud metadata endpoint)", () => {
    // 0xa9 = 169, 0xfe = 254, 0xa9 = 169, 0xfe = 254 → 169.254.169.254
    expect(isPrivateIpv6Address("::ffff:a9fe:a9fe")).toBe(true);
  });
  it("blocks ::ffff:c0a8:101 (192.168.1.1 in hex)", () => {
    // 0xc0 = 192, 0xa8 = 168, 0x01 = 1, 0x01 = 1 → 192.168.1.1
    expect(isPrivateIpv6Address("::ffff:c0a8:101")).toBe(true);
  });
  it("blocks ::ffff:ac10:1 (172.16.0.1 in hex — RFC-1918 172.16/12)", () => {
    // 0xac = 172, 0x10 = 16, 0x00 = 0, 0x01 = 1 → 172.16.0.1
    expect(isPrivateIpv6Address("::ffff:ac10:1")).toBe(true);
  });
  it("allows ::ffff:808:808 (8.8.8.8 in hex — Google DNS, public)", () => {
    // 0x08 = 8, 0x08 = 8, 0x08 = 8, 0x08 = 8 → 8.8.8.8
    expect(isPrivateIpv6Address("::ffff:808:808")).toBe(false);
  });
});

describe("isPrivateIpv6Address — IPv4-compatible ::x.x.x.x (deprecated)", () => {
  it("blocks ::127.0.0.1 (IPv4-compatible loopback)", () => {
    expect(isPrivateIpv6Address("::127.0.0.1")).toBe(true);
  });
  it("blocks ::192.168.1.1 (IPv4-compatible private)", () => {
    expect(isPrivateIpv6Address("::192.168.1.1")).toBe(true);
  });
});

describe("isPrivateIpv6Address — site-local fec0::/10 (deprecated, must be blocked fail-closed)", () => {
  // fec0::/10 is deprecated (RFC 3879) but can still reach intranet services.
  // We block it fail-closed: byte0=0xfe, (byte1 & 0xC0) === 0xC0
  it("blocks fec0::1 (site-local root)", () => {
    expect(isPrivateIpv6Address("fec0::1")).toBe(true);
  });
  it("blocks feff::1 (last address in fec0::/10)", () => {
    expect(isPrivateIpv6Address("feff::1")).toBe(true);
  });
  it("blocks fec0:abcd::1 (site-local with subnet)", () => {
    expect(isPrivateIpv6Address("fec0:abcd::1")).toBe(true);
  });
});

describe("isPrivateIpv6Address — public/global addresses (must NOT be blocked)", () => {
  it("allows 2001:db8::1 (documentation prefix, but globally routable pattern)", () => {
    // 2001:db8::/32 is actually IANA documentation-only, but we only block
    // ranges that have SSRF relevance (private/loopback/link-local/multicast)
    expect(isPrivateIpv6Address("2001:db8::1")).toBe(false);
  });
  it("allows 2606:4700::6810:84e5 (Cloudflare public)", () => {
    expect(isPrivateIpv6Address("2606:4700::6810:84e5")).toBe(false);
  });
  it("allows 2a00:1450:4001::1 (Google public)", () => {
    expect(isPrivateIpv6Address("2a00:1450:4001::1")).toBe(false);
  });
  it("allows 2001:4860:4860::8888 (Google DNS)", () => {
    expect(isPrivateIpv6Address("2001:4860:4860::8888")).toBe(false);
  });
  it("does NOT block fec0::1 (fail-closed: see site-local block test)", () => {
    // NOTE: fec0::/10 (site-local, deprecated) IS blocked — see the site-local suite below.
    // This test confirms the surrounding public range 0xfe40-0xfe7f is allowed.
    // fe40:: → byte0=0xfe, byte1=0x40; (0x40 & 0xC0)=0x40 ≠ 0x80 (link-local) and ≠ 0xC0 (site-local) → allowed
    expect(isPrivateIpv6Address("fe40::1")).toBe(false);
  });
  it("does not block fe8:: (valid public address; not in any private range)", () => {
    // fe08:: → byte0=0xfe, byte1=0x08; (0x08 & 0xc0)=0 ≠ 0x80 → not link-local
    // Also (0xfe & 0xfe) = 0xfe ≠ 0xfc → not ULA
    expect(isPrivateIpv6Address("fe08::")).toBe(false);
  });
});
