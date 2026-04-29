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

function isValidHostnameFormat(host: string): boolean {
  return (
    /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?$/.test(host) || isIP(host) !== 0
  );
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536;
}

export async function assertAllowedTarget(
  host: string,
  port: number,
): Promise<void> {
  if (!isValidHostnameFormat(host)) {
    throw new HostPolicyError("無效的主機名稱");
  }
  if (!isValidPort(port)) {
    throw new HostPolicyError("無效的端口號碼");
  }

  if (BLOCKED_HOSTNAMES.has(host.toLowerCase())) {
    throw new HostPolicyError("主機目標不被允許");
  }

  if (isIP(host) === 4 && isBlockedIPv4(host)) {
    throw new HostPolicyError("主機目標不被允許");
  }

  // Catch hostname -> metadata-IP tricks. Does not defend against DNS rebinding
  // between this check and the actual TCP connect; accepted trade-off for scope.
  if (isIP(host) === 0) {
    try {
      const resolved = await lookup(host, { all: true });
      for (const { address, family } of resolved) {
        if (family === 4 && isBlockedIPv4(address)) {
          throw new HostPolicyError("主機目標不被允許");
        }
      }
    } catch (error) {
      if (error instanceof HostPolicyError) throw error;
      log.error({ err: error, host }, "DNS lookup failed");
      throw new HostPolicyError("無法解析主機名稱");
    }
  }
}
