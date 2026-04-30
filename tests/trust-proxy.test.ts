/**
 * Tests for trust-proxy config logic (resolveTrustProxy) and the
 * Cloudflare CIDR list.
 *
 * Covers:
 *   - TRUSTED_PROXY unset / false → resolveTrustProxy returns false
 *   - TRUSTED_PROXY=true + empty CIDRs + TRUST_CLOUDFLARE=false → throws
 *   - TRUSTED_PROXY=true + invalid CIDR syntax → config.ts throws at load
 *   - TRUSTED_PROXY=true + valid CIDR → returns the CIDR list
 *   - TRUSTED_PROXY=true + TRUST_CLOUDFLARE=true → includes Cloudflare IPs
 *   - Cloudflare CIDR list sanity checks
 */

import { describe, it, expect } from "vitest";
import { isValidCidrSyntax, resolveTrustProxy } from "../src/config.js";
import type { AppConfig } from "../src/config.js";
import {
  CLOUDFLARE_CIDRS_V4,
  CLOUDFLARE_CIDRS_V6,
} from "../src/utils/cloudflare-ip-ranges.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeWebCfg(
  overrides: Partial<AppConfig["web"]> = {},
): AppConfig["web"] {
  return {
    port: 3000,
    host: "0.0.0.0",
    baseUrl: null,
    sslCertPath: null,
    sslKeyPath: null,
    sslCaPath: null,
    trustedProxy: false,
    trustedProxyCidrs: [],
    trustCloudflare: false,
    ...overrides,
  };
}

// ─── resolveTrustProxy ────────────────────────────────────────────────────────

describe("resolveTrustProxy", () => {
  it("trustedProxy=false → returns false (default)", () => {
    const result = resolveTrustProxy(
      makeWebCfg({ trustedProxy: false }),
      CLOUDFLARE_CIDRS_V4,
      CLOUDFLARE_CIDRS_V6,
    );
    expect(result).toBe(false);
  });

  it("trustedProxy=false ignores non-empty CIDRs → still false", () => {
    const result = resolveTrustProxy(
      makeWebCfg({ trustedProxy: false, trustedProxyCidrs: ["10.0.0.5/32"] }),
      CLOUDFLARE_CIDRS_V4,
      CLOUDFLARE_CIDRS_V6,
    );
    expect(result).toBe(false);
  });

  it("trustedProxy=true + empty CIDRs + trustCloudflare=false → throws", () => {
    expect(() =>
      resolveTrustProxy(
        makeWebCfg({
          trustedProxy: true,
          trustedProxyCidrs: [],
          trustCloudflare: false,
        }),
        CLOUDFLARE_CIDRS_V4,
        CLOUDFLARE_CIDRS_V6,
      ),
    ).toThrow(
      /TRUSTED_PROXY=true but TRUSTED_PROXY_CIDRS and TRUST_CLOUDFLARE are both empty/,
    );
  });

  it("trustedProxy=true + valid CIDR → returns that CIDR", () => {
    const result = resolveTrustProxy(
      makeWebCfg({
        trustedProxy: true,
        trustedProxyCidrs: ["10.0.0.5/32"],
        trustCloudflare: false,
      }),
      CLOUDFLARE_CIDRS_V4,
      CLOUDFLARE_CIDRS_V6,
    );
    expect(result).toEqual(["10.0.0.5/32"]);
  });

  it("trustedProxy=true + multiple CIDRs → returns all CIDRs", () => {
    const result = resolveTrustProxy(
      makeWebCfg({
        trustedProxy: true,
        trustedProxyCidrs: ["10.0.0.5/32", "192.168.1.0/24"],
        trustCloudflare: false,
      }),
      CLOUDFLARE_CIDRS_V4,
      CLOUDFLARE_CIDRS_V6,
    );
    expect(result).toEqual(["10.0.0.5/32", "192.168.1.0/24"]);
  });

  it("trustedProxy=true + trustCloudflare=true → includes all Cloudflare IPs", () => {
    const result = resolveTrustProxy(
      makeWebCfg({
        trustedProxy: true,
        trustedProxyCidrs: [],
        trustCloudflare: true,
      }),
      CLOUDFLARE_CIDRS_V4,
      CLOUDFLARE_CIDRS_V6,
    );
    expect(Array.isArray(result)).toBe(true);
    const arr = result as string[];
    // Every Cloudflare V4 CIDR must appear
    for (const cidr of CLOUDFLARE_CIDRS_V4) {
      expect(arr).toContain(cidr);
    }
    // Every Cloudflare V6 CIDR must appear
    for (const cidr of CLOUDFLARE_CIDRS_V6) {
      expect(arr).toContain(cidr);
    }
  });

  it("trustedProxy=true + own CIDR + trustCloudflare=true → own CIDR comes first", () => {
    const result = resolveTrustProxy(
      makeWebCfg({
        trustedProxy: true,
        trustedProxyCidrs: ["10.0.0.5/32"],
        trustCloudflare: true,
      }),
      CLOUDFLARE_CIDRS_V4,
      CLOUDFLARE_CIDRS_V6,
    ) as string[];
    expect(result[0]).toBe("10.0.0.5/32");
    for (const cidr of CLOUDFLARE_CIDRS_V4) {
      expect(result).toContain(cidr);
    }
  });
});

// ─── Cloudflare CIDR list sanity checks ──────────────────────────────────────

describe("cloudflare-ip-ranges", () => {
  it("exports at least 14 IPv4 CIDRs", () => {
    expect(CLOUDFLARE_CIDRS_V4.length).toBeGreaterThanOrEqual(14);
  });

  it("exports at least 6 IPv6 CIDRs", () => {
    expect(CLOUDFLARE_CIDRS_V6.length).toBeGreaterThanOrEqual(6);
  });

  it("all IPv4 CIDRs have /prefix notation", () => {
    for (const cidr of CLOUDFLARE_CIDRS_V4) {
      expect(cidr, `bad CIDR: ${cidr}`).toMatch(/^[\d.]+\/\d+$/);
    }
  });

  it("all IPv6 CIDRs have /prefix notation", () => {
    for (const cidr of CLOUDFLARE_CIDRS_V6) {
      expect(cidr, `bad CIDR: ${cidr}`).toMatch(/^[0-9a-f:]+\/\d+$/i);
    }
  });
});

// ─── isValidCidrSyntax (boot-time fail-fast contract) ────────────────────────

describe("isValidCidrSyntax", () => {
  it("accepts well-formed IPv4 CIDR", () => {
    expect(isValidCidrSyntax("10.0.0.0/8")).toBe(true);
    expect(isValidCidrSyntax("173.245.48.0/20")).toBe(true);
  });

  it("accepts well-formed IPv6 CIDR", () => {
    expect(isValidCidrSyntax("2606:4700::/32")).toBe(true);
    expect(isValidCidrSyntax("::1/128")).toBe(true);
  });

  it("rejects missing slash", () => {
    expect(isValidCidrSyntax("10.0.0.0")).toBe(false);
    expect(isValidCidrSyntax("garbage")).toBe(false);
  });

  it("rejects non-numeric prefix", () => {
    expect(isValidCidrSyntax("10.0.0.0/abc")).toBe(false);
    expect(isValidCidrSyntax("10.0.0.0/")).toBe(false);
  });

  it("rejects out-of-range prefix", () => {
    expect(isValidCidrSyntax("10.0.0.0/-1")).toBe(false);
    expect(isValidCidrSyntax("10.0.0.0/129")).toBe(false);
    expect(isValidCidrSyntax("10.0.0.0/9999")).toBe(false);
  });

  // The host portion isn't structurally validated here — proxy-addr
  // catches that at server boot. This test pins the documented trade-off
  // so a future tightening of the helper updates the test deliberately.
  it("does not validate the IP host portion (delegated to proxy-addr)", () => {
    expect(isValidCidrSyntax("999.999.999.999/24")).toBe(true);
    expect(isValidCidrSyntax("nonsense/24")).toBe(true);
  });
});
