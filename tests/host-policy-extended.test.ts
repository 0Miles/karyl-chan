import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({
  lookup: vi.fn(),
}));

const { lookup } = await import("dns/promises");
const { assertExternalTarget, assertPluginTarget, HostPolicyError } =
  await import("../src/utils/host-policy.js");

const mockedLookup = vi.mocked(lookup);

function stubResolve(address: string, family: 4 | 6 = 4) {
  mockedLookup.mockResolvedValue([{ address, family }] as unknown as Awaited<
    ReturnType<typeof lookup>
  >);
}

// ─────────────────────────────────────────────────────────────────────────────
// assertExternalTarget
// ─────────────────────────────────────────────────────────────────────────────
describe("assertExternalTarget", () => {
  beforeEach(() => {
    mockedLookup.mockReset();
    delete process.env.KARYL_WEBHOOK_ALLOW_PRIVATE;
  });

  afterEach(() => {
    delete process.env.KARYL_WEBHOOK_ALLOW_PRIVATE;
  });

  it("rejects cloud metadata 169.254.169.254", async () => {
    await expect(
      assertExternalTarget("169.254.169.254", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("rejects RFC1918 10.0.0.5", async () => {
    await expect(assertExternalTarget("10.0.0.5", 80)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("rejects RFC1918 172.16.0.1", async () => {
    await expect(assertExternalTarget("172.16.0.1", 80)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("rejects RFC1918 192.168.1.1", async () => {
    await expect(
      assertExternalTarget("192.168.1.1", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("rejects loopback 127.0.0.1", async () => {
    await expect(assertExternalTarget("127.0.0.1", 80)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("rejects loopback 127.255.255.255", async () => {
    await expect(
      assertExternalTarget("127.255.255.255", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("rejects unspecified 0.0.0.0", async () => {
    await expect(assertExternalTarget("0.0.0.0", 80)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("rejects IPv6 loopback ::1", async () => {
    await expect(assertExternalTarget("::1", 80)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("rejects IPv6 link-local fe80::1", async () => {
    await expect(assertExternalTarget("fe80::1", 80)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("rejects IPv6 unique-local fd00::1", async () => {
    await expect(assertExternalTarget("fd00::1", 80)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("resolves public IP 8.8.8.8", async () => {
    await expect(assertExternalTarget("8.8.8.8", 443)).resolves.toBeUndefined();
  });

  it("resolves public hostname (discord.com -> public IP)", async () => {
    stubResolve("162.159.130.234");
    await expect(
      assertExternalTarget("discord.com", 443),
    ).resolves.toBeUndefined();
  });

  it("rejects hostname resolving to RFC1918", async () => {
    stubResolve("10.0.0.5");
    await expect(
      assertExternalTarget("internal.corp", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("rejects hostname resolving to metadata IP", async () => {
    stubResolve("169.254.169.254");
    await expect(
      assertExternalTarget("sneaky.example.com", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  describe("KARYL_WEBHOOK_ALLOW_PRIVATE=true escape hatch", () => {
    beforeEach(() => {
      process.env.KARYL_WEBHOOK_ALLOW_PRIVATE = "true";
    });

    it("allows RFC1918 10.0.0.5 when escape hatch enabled", async () => {
      await expect(
        assertExternalTarget("10.0.0.5", 80),
      ).resolves.toBeUndefined();
    });

    it("still rejects metadata 169.254.169.254 even with escape hatch", async () => {
      await expect(
        assertExternalTarget("169.254.169.254", 80),
      ).rejects.toBeInstanceOf(HostPolicyError);
    });

    it("still rejects loopback 127.0.0.1 even with escape hatch", async () => {
      await expect(
        assertExternalTarget("127.0.0.1", 80),
      ).rejects.toBeInstanceOf(HostPolicyError);
    });

    it("allows RFC1918 hostname with escape hatch", async () => {
      stubResolve("10.0.0.5");
      await expect(
        assertExternalTarget("internal.corp", 80),
      ).resolves.toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assertPluginTarget
// ─────────────────────────────────────────────────────────────────────────────
describe("assertPluginTarget", () => {
  const origNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockedLookup.mockReset();
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
  });

  it("rejects cloud metadata 169.254.169.254", async () => {
    await expect(
      assertPluginTarget("169.254.169.254", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("allows RFC1918 172.18.0.5 (docker bridge)", async () => {
    await expect(
      assertPluginTarget("172.18.0.5", 3000),
    ).resolves.toBeUndefined();
  });

  it("allows RFC1918 10.0.0.5 (docker bridge)", async () => {
    await expect(assertPluginTarget("10.0.0.5", 3000)).resolves.toBeUndefined();
  });

  it("allows loopback 127.0.0.1 in development", async () => {
    process.env.NODE_ENV = "development";
    await expect(
      assertPluginTarget("127.0.0.1", 3000),
    ).resolves.toBeUndefined();
  });

  it("rejects loopback 127.0.0.1 in production", async () => {
    process.env.NODE_ENV = "production";
    await expect(assertPluginTarget("127.0.0.1", 3000)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("allows hostname resolving to RFC1918 (docker service name)", async () => {
    stubResolve("172.18.0.3");
    await expect(
      assertPluginTarget("karyl-utility-plugin", 3000),
    ).resolves.toBeUndefined();
  });

  it("rejects hostname resolving to metadata IP", async () => {
    stubResolve("169.254.169.254");
    await expect(
      assertPluginTarget("sneaky-plugin", 3000),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("rejects loopback hostname in production", async () => {
    process.env.NODE_ENV = "production";
    stubResolve("127.0.0.1");
    await expect(assertPluginTarget("localhost", 3000)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("allows loopback hostname in development", async () => {
    process.env.NODE_ENV = "development";
    stubResolve("127.0.0.1");
    await expect(
      assertPluginTarget("localhost", 3000),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IPv6 bypass guards (regression tests for the critic-found holes)
// ─────────────────────────────────────────────────────────────────────────────
describe("IPv6 bypass guards", () => {
  beforeEach(() => {
    mockedLookup.mockReset();
    delete process.env.KARYL_WEBHOOK_ALLOW_PRIVATE;
  });

  it("blocks IPv4-mapped IPv6 loopback ::ffff:127.0.0.1 (literal)", async () => {
    await expect(
      assertExternalTarget("::ffff:127.0.0.1", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("blocks IPv4-mapped IPv6 metadata ::ffff:169.254.169.254 (literal)", async () => {
    await expect(
      assertExternalTarget("::ffff:169.254.169.254", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("blocks IPv4-mapped IPv6 RFC1918 ::ffff:10.0.0.5 (literal)", async () => {
    await expect(
      assertExternalTarget("::ffff:10.0.0.5", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("blocks IPv4-mapped IPv6 hex form ::ffff:7f00:1 (= 127.0.0.1)", async () => {
    await expect(
      assertExternalTarget("::ffff:7f00:1", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("blocks IPv4-mapped IPv6 hex form ::ffff:a9fe:a9fe (= 169.254.169.254)", async () => {
    await expect(
      assertExternalTarget("::ffff:a9fe:a9fe", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("blocks hostname resolving to IPv4-mapped IPv6 metadata", async () => {
    mockedLookup.mockResolvedValue([
      { address: "::ffff:169.254.169.254", family: 6 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);
    await expect(
      assertExternalTarget("evil.example", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("blocks IPv6 unspecified ::", async () => {
    await expect(assertExternalTarget("::", 80)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("blocks IPv6 loopback expanded form 0:0:0:0:0:0:0:1", async () => {
    await expect(
      assertExternalTarget("0:0:0:0:0:0:0:1", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("strips brackets from IPv6 literal hostnames", async () => {
    await expect(assertExternalTarget("[::1]", 80)).rejects.toBeInstanceOf(
      HostPolicyError,
    );
  });

  it("allows public IPv6 (e.g. Cloudflare 2606:4700::1111)", async () => {
    await expect(
      assertExternalTarget("2606:4700:4700::1111", 443),
    ).resolves.toBeUndefined();
  });

  it("plugin: blocks IPv4-mapped loopback in production", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      assertPluginTarget("::ffff:127.0.0.1", 3000),
    ).rejects.toBeInstanceOf(HostPolicyError);
    process.env.NODE_ENV = "development";
  });

  it("plugin: blocks IPv4-mapped metadata regardless of env", async () => {
    process.env.NODE_ENV = "development";
    await expect(
      assertPluginTarget("::ffff:169.254.169.254", 3000),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });

  it("blocks metadata hostname with trailing dot (FQDN form)", async () => {
    await expect(
      assertExternalTarget("metadata.google.internal.", 80),
    ).rejects.toBeInstanceOf(HostPolicyError);
  });
});
