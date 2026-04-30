import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Strategy: use vi.resetModules() + dynamic import each test so the static
// connectionMap starts fresh. All heavy dependencies are mocked.
// ---------------------------------------------------------------------------

// Vitest hoists vi.mock calls, so the factories below run before any import.

vi.mock("../src/modules/bot-events/bot-event-log.js", () => ({
  botEventLog: { record: vi.fn() },
}));

vi.mock("../src/utils/host-policy.js", () => {
  class HostPolicyError extends Error {}
  return {
    assertAllowedTarget: vi.fn().mockResolvedValue(undefined),
    HostPolicyError,
  };
});

// Rcon must be mocked as a class (constructor). Using function syntax so
// `new Rcon(...)` works correctly.
vi.mock("rcon", () => {
  function MockRcon(
    this: {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      removeAllListeners: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    },
  ) {
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.disconnect = vi.fn().mockResolvedValue(undefined);
    this.send = vi.fn();
    this.removeAllListeners = vi.fn();
    this.on = vi.fn().mockReturnThis();
  }
  return { default: MockRcon };
});

vi.mock("../src/config.js", () => ({
  config: {
    rcon: {
      maxRetryAttempts: 3,
      maxQueueSize: 100,
      connectionTimeoutMs: 30_000,
      cleanupIntervalMs: 300_000,
      maxConnections: 50,
    },
  },
}));

vi.mock("../src/logger.js", () => ({
  moduleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../src/utils/constant.js", () => ({
  DEFAULT_COLOR: 0x5865f2,
  FAILED_COLOR: 0xed4245,
  SUCCEEDED_COLOR: 0x57f287,
}));

// ---------------------------------------------------------------------------

function makeChannel() {
  return {
    id: `channel-${Math.random()}`,
    send: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("discord.js").TextChannel;
}

type ServiceModule = typeof import("../src/modules/builtin-features/rcon-forward/rcon-connection.service.js");

// Helper: insert N fake connection stubs directly into the private static map.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fillConnectionMap(svc: any, count: number) {
  for (let i = 0; i < count; i++) {
    svc.connectionMap[`fake-conn-${i}`] = { host: `h${i}`, port: 25575 };
  }
}

// ---------------------------------------------------------------------------

describe("RconConnectionService – connection limit", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let svc: any;
  let RconLimitError: ServiceModule["RconLimitError"];
  let botEventLog: { record: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Reset module registry so each test gets a fresh static connectionMap.
    vi.resetModules();

    const mod = (await import(
      "../src/modules/builtin-features/rcon-forward/rcon-connection.service.js"
    )) as ServiceModule;
    svc = mod.RconConnectionService;
    RconLimitError = mod.RconLimitError;

    // The fresh module should have an empty map, but clear it explicitly.
    svc.connectionMap = {};
    svc.connectionLocks = new Map();

    const logMod = await import(
      "../src/modules/bot-events/bot-event-log.js"
    );
    botEventLog = logMod.botEventLog as unknown as {
      record: ReturnType<typeof vi.fn>;
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws RconLimitError when connectionMap is at MAX_CONNECTIONS (50)", async () => {
    fillConnectionMap(svc, 50);

    await expect(
      svc.initializeConnection(
        "new-conn",
        "10.0.0.1",
        25575,
        "secret",
        makeChannel(),
      ),
    ).rejects.toBeInstanceOf(RconLimitError);
  });

  it("RconLimitError message contains the host", async () => {
    fillConnectionMap(svc, 50);

    await expect(
      svc.initializeConnection(
        "new-conn",
        "10.0.0.2",
        25575,
        "secret",
        makeChannel(),
      ),
    ).rejects.toThrow("10.0.0.2");
  });

  it("writes a warn botEventLog entry containing the host when limit is hit", async () => {
    fillConnectionMap(svc, 50);

    await expect(
      svc.initializeConnection(
        "new-conn",
        "10.0.0.3",
        25575,
        "secret",
        makeChannel(),
      ),
    ).rejects.toBeInstanceOf(RconLimitError);

    expect(botEventLog.record).toHaveBeenCalledWith(
      "warn",
      "feature",
      expect.stringContaining("10.0.0.3"),
      expect.objectContaining({ host: "10.0.0.3" }),
    );
  });

  it("allows the 50th connection (49 existing → guard does not fire)", async () => {
    fillConnectionMap(svc, 49);

    await expect(
      svc.initializeConnection(
        "conn-50",
        "10.0.0.4",
        25575,
        "secret",
        makeChannel(),
      ),
    ).resolves.toBe(true);

    // No warn-level botEventLog call for the limit guard.
    const warnCalls = (
      botEventLog.record as ReturnType<typeof vi.fn>
    ).mock.calls.filter((args: unknown[]) => args[0] === "warn");
    expect(warnCalls).toHaveLength(0);
  });

  it("re-initializing an existing connectionName does not count toward the limit", async () => {
    // Fill to 49, then add the key we'll re-init as the 50th slot.
    fillConnectionMap(svc, 49);

    const fakeConn = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      removeAllListeners: vi.fn(),
      on: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    svc.connectionMap["existing-conn"] = {
      host: "10.0.0.5",
      port: 25575,
      conn: fakeConn,
      channels: new Set(),
      authenticated: false,
      queuedCommands: [],
      lastUsed: new Date(),
      reconnectAttempts: 0,
      maxQueueSize: 100,
    };
    // Now map has 50 entries; "existing-conn" is re-initialised → isNew=false.
    await expect(
      svc.initializeConnection(
        "existing-conn",
        "10.0.0.5",
        25575,
        "secret",
        makeChannel(),
      ),
    ).resolves.toBe(true);

    // No warn-level call from the limit guard.
    const warnCalls = (
      botEventLog.record as ReturnType<typeof vi.fn>
    ).mock.calls.filter((args: unknown[]) => args[0] === "warn");
    expect(warnCalls).toHaveLength(0);
  });
});
