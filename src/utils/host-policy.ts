import { lookup } from "dns/promises";
import { isIP } from "net";
import { moduleLogger } from "../logger.js";

const log = moduleLogger("host-policy");

export class HostPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostPolicyError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata",
  "metadata.goog",
  "metadata.azure.com",
]);

function isBlockedIPv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)
  ) {
    return false;
  }
  const [a, b, c, d] = octets;
  // Link-local 169.254.0.0/16 — AWS/GCP/Azure/DO/IBM metadata all live here
  if (a === 169 && b === 254) return true;
  // Azure WireServer
  if (a === 168 && b === 63 && c === 129 && d === 16) return true;
  // Alibaba Cloud
  if (a === 100 && b === 100 && c === 100 && d === 200) return true;
  // Oracle Cloud
  if (a === 192 && b === 0 && c === 0 && d === 192) return true;
  return false;
}

/** Returns true for RFC1918 private ranges: 10/8, 172.16/12, 192.168/16. */
function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)
  ) {
    return false;
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** Returns true for loopback: 127.0.0.0/8. */
function isLoopbackIPv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)
  ) {
    return false;
  }
  return octets[0] === 127;
}

/** Returns true for 0.0.0.0 (unspecified). */
function isUnspecifiedIPv4(ip: string): boolean {
  return ip === "0.0.0.0";
}

/**
 * If `ip` is an IPv4-mapped IPv6 address (`::ffff:a.b.c.d` or
 * `::ffff:HI:LO` hex form), return the embedded IPv4 in dotted form;
 * otherwise null. Without this, an attacker can submit
 * `https://evil.example/` whose DNS resolves to `::ffff:127.0.0.1`,
 * which Node will happily connect to as IPv4 loopback while our IPv6
 * blocklist sees an unrecognised v6 address.
 */
function ipv4MappedToIPv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (dotted) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)) {
      return dotted[1];
    }
    return null;
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

/** Returns true for IPv6 unspecified `::` and its fully-expanded form. */
function isUnspecifiedIPv6(ip: string): boolean {
  if (ip === "::") return true;
  // Fully expanded all-zeros: 0:0:0:0:0:0:0:0 (with leading-zero variants)
  if (/^(0+:){7}0+$/.test(ip)) return true;
  return false;
}

/** Returns true for IPv6 loopback `::1` and its expanded forms. */
function isLoopbackIPv6(ip: string): boolean {
  if (ip === "::1") return true;
  // Fully expanded: 0:0:0:0:0:0:0:1 (with leading-zero variants)
  if (/^(0+:){7}0*1$/i.test(ip)) return true;
  return false;
}

/** Returns true for IPv6 addresses that should be blocked by external policy. */
function isBlockedIPv6(ip: string): boolean {
  if (isLoopbackIPv6(ip)) return true;
  if (isUnspecifiedIPv6(ip)) return true;
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(ip)) return true;
  // Unique-local fc00::/7 (fc:: and fd::)
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  return false;
}

/**
 * URL.hostname returns IPv6 literals wrapped in `[...]`; strip them so
 * the rest of host-policy can treat the address uniformly.
 */
function stripIPv6Brackets(host: string): string {
  if (host.length >= 2 && host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function isValidHostnameFormat(host: string): boolean {
  return (
    /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?$/.test(host) || isIP(host) !== 0
  );
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536;
}

/**
 * Shared DNS resolution helper. Resolves hostname to addresses and calls
 * `checkAddress(address, family)` for each result. If any call throws
 * HostPolicyError it propagates; non-HostPolicyError is wrapped as DNS failure.
 * No-ops if `host` is already a literal IP (isIP !== 0).
 */
async function resolveAndCheck(
  host: string,
  checkAddress: (address: string, family: number) => void,
): Promise<void> {
  if (isIP(host) !== 0) return;
  try {
    const resolved = await lookup(host, { all: true });
    for (const { address, family } of resolved) {
      checkAddress(address, family);
    }
  } catch (error) {
    if (error instanceof HostPolicyError) throw error;
    log.error({ err: error, host }, "DNS lookup failed");
    throw new HostPolicyError("無法解析主機名稱");
  }
}

/**
 * assertAllowedTarget — RCON / internal use.
 *
 * Blocks cloud metadata endpoints only (link-local 169.254/16, Azure
 * WireServer, Alibaba, Oracle). Does NOT block RFC1918 or loopback —
 * docker-internal services legitimately live in those ranges.
 */
export async function assertAllowedTarget(
  host: string,
  port: number,
): Promise<void> {
  host = stripIPv6Brackets(host);
  if (!isValidHostnameFormat(host)) {
    throw new HostPolicyError("無效的主機名稱");
  }
  if (!isValidPort(port)) {
    throw new HostPolicyError("無效的端口號碼");
  }

  if (BLOCKED_HOSTNAMES.has(host.toLowerCase().replace(/\.$/, ""))) {
    throw new HostPolicyError("主機目標不被允許");
  }

  if (isIP(host) === 4 && isBlockedIPv4(host)) {
    throw new HostPolicyError("主機目標不被允許");
  }
  if (isIP(host) === 6) {
    const mapped = ipv4MappedToIPv4(host);
    if (mapped && isBlockedIPv4(mapped)) {
      throw new HostPolicyError("主機目標不被允許");
    }
  }

  // Catch hostname -> metadata-IP tricks. Does not defend against DNS rebinding
  // between this check and the actual TCP connect; accepted trade-off for scope.
  await resolveAndCheck(host, (address, family) => {
    if (family === 4 && isBlockedIPv4(address)) {
      throw new HostPolicyError("主機目標不被允許");
    }
    if (family === 6) {
      const mapped = ipv4MappedToIPv4(address);
      if (mapped && isBlockedIPv4(mapped)) {
        throw new HostPolicyError("主機目標不被允許");
      }
    }
  });
}

/**
 * assertExternalTarget — Webhook URLs (admin-configured, bot calls outbound).
 *
 * Enforces the strictest policy: blocks cloud metadata, RFC1918 private
 * ranges, loopback, unspecified, and the IPv6 equivalents. Only public
 * internet addresses are accepted.
 *
 * Escape hatch: set env KARYL_WEBHOOK_ALLOW_PRIVATE=true to skip the
 * RFC1918 check (metadata is still blocked). Intended for ops debugging
 * only — never enable in production.
 */
export async function assertExternalTarget(
  host: string,
  port: number,
): Promise<void> {
  host = stripIPv6Brackets(host);
  if (!isValidHostnameFormat(host)) {
    throw new HostPolicyError("無效的主機名稱");
  }
  if (!isValidPort(port)) {
    throw new HostPolicyError("無效的端口號碼");
  }

  const allowPrivate = process.env.KARYL_WEBHOOK_ALLOW_PRIVATE === "true";
  const denyExternal = (): never => {
    throw new HostPolicyError("Webhook 目標不被允許");
  };
  const checkIPv4 = (ip: string) => {
    if (isBlockedIPv4(ip)) denyExternal();
    if (!allowPrivate && isPrivateIPv4(ip)) denyExternal();
    if (isLoopbackIPv4(ip)) denyExternal();
    if (isUnspecifiedIPv4(ip)) denyExternal();
  };

  if (BLOCKED_HOSTNAMES.has(host.toLowerCase().replace(/\.$/, ""))) {
    denyExternal();
  }

  if (isIP(host) === 4) {
    checkIPv4(host);
    return;
  }

  if (isIP(host) === 6) {
    const mapped = ipv4MappedToIPv4(host);
    if (mapped) {
      checkIPv4(mapped);
      return;
    }
    if (isBlockedIPv6(host)) denyExternal();
    return;
  }

  // Hostname — resolve and check all addresses
  await resolveAndCheck(host, (address, family) => {
    if (family === 4) {
      checkIPv4(address);
    } else if (family === 6) {
      const mapped = ipv4MappedToIPv4(address);
      if (mapped) {
        checkIPv4(mapped);
      } else if (isBlockedIPv6(address)) {
        denyExternal();
      }
    }
  });
}

/**
 * assertPluginTarget — Plugin manifest URLs (docker-compose internal services).
 *
 * Blocks cloud metadata endpoints (same as assertAllowedTarget). Allows
 * RFC1918 because docker bridge networks legitimately use 172.16-31.x.x.
 *
 * In production (NODE_ENV=production), additionally blocks loopback
 * (127.x.x.x / ::1) to prevent a manifest from self-referencing the
 * host process. In development loopback is allowed for local plugin testing.
 */
export async function assertPluginTarget(
  host: string,
  port: number,
): Promise<void> {
  host = stripIPv6Brackets(host);
  if (!isValidHostnameFormat(host)) {
    throw new HostPolicyError("無效的主機名稱");
  }
  if (!isValidPort(port)) {
    throw new HostPolicyError("無效的端口號碼");
  }

  const isProd = process.env.NODE_ENV === "production";
  const denyPlugin = (): never => {
    throw new HostPolicyError("Plugin 目標不被允許");
  };
  const checkIPv4 = (ip: string) => {
    if (isBlockedIPv4(ip)) denyPlugin();
    if (isProd && isLoopbackIPv4(ip)) denyPlugin();
  };

  if (BLOCKED_HOSTNAMES.has(host.toLowerCase().replace(/\.$/, ""))) {
    denyPlugin();
  }

  if (isIP(host) === 4) {
    checkIPv4(host);
    return;
  }

  if (isIP(host) === 6) {
    const mapped = ipv4MappedToIPv4(host);
    if (mapped) {
      checkIPv4(mapped);
      return;
    }
    if (isProd && (isLoopbackIPv6(host) || isUnspecifiedIPv6(host))) {
      denyPlugin();
    }
    return;
  }

  // Hostname — resolve and check all addresses
  await resolveAndCheck(host, (address, family) => {
    if (family === 4) {
      checkIPv4(address);
    } else if (family === 6) {
      const mapped = ipv4MappedToIPv4(address);
      if (mapped) {
        checkIPv4(mapped);
      } else if (isProd && (isLoopbackIPv6(address) || isUnspecifiedIPv6(address))) {
        denyPlugin();
      }
    }
  });
}
