import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SQLITE_DB_PATH = ":memory:";
});

import { sequelize } from "../src/models/db.js";
import {
  PluginKv,
  incrementKv,
  getKv,
  setKv,
} from "../src/models/plugin-kv.model.js";

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

beforeEach(async () => {
  await PluginKv.destroy({ where: {} });
});

describe("incrementKv", () => {
  const PID = 1;
  const GID = "guild-a";
  const KEY = "counter";

  it("seeds at delta when row does not exist", async () => {
    const r = await incrementKv(PID, GID, KEY, 1);
    expect(r.value).toBe(1);
    const row = await getKv(PID, GID, KEY);
    expect(row?.value).toBe("1");
  });

  it("accumulates across calls", async () => {
    expect((await incrementKv(PID, GID, KEY, 1)).value).toBe(1);
    expect((await incrementKv(PID, GID, KEY, 1)).value).toBe(2);
    expect((await incrementKv(PID, GID, KEY, 5)).value).toBe(7);
  });

  it("honors negative deltas", async () => {
    await incrementKv(PID, GID, KEY, 10);
    const r = await incrementKv(PID, GID, KEY, -3);
    expect(r.value).toBe(7);
  });

  it("throws when existing value is not numeric", async () => {
    await setKv(PID, GID, KEY, "not-a-number");
    await expect(incrementKv(PID, GID, KEY, 1)).rejects.toThrow(
      /not a finite number/,
    );
  });

  it("keeps separate counters per (pluginId, guildId, key)", async () => {
    await incrementKv(PID, GID, "a", 1);
    await incrementKv(PID, GID, "a", 1);
    await incrementKv(PID, "guild-b", "a", 1);
    await incrementKv(2, GID, "a", 1);
    expect((await getKv(PID, GID, "a"))?.value).toBe("2");
    expect((await getKv(PID, "guild-b", "a"))?.value).toBe("1");
    expect((await getKv(2, GID, "a"))?.value).toBe("1");
  });

  it("concurrent increments produce distinct sequential values", async () => {
    // Regression test for the read-modify-write race we hit when
    // counters were implemented via kv_get + kv_set. With the
    // IMMEDIATE-mode transaction in incrementKv, N parallel calls
    // must end with the row at exactly N and the returned values
    // must be the set {1..N} (in some order). The previous code
    // would lose increments and end with row < N.
    const N = 10;
    const promises: Promise<{ value: number }>[] = [];
    for (let i = 0; i < N; i++) {
      promises.push(incrementKv(PID, GID, KEY, 1));
    }
    const results = await Promise.all(promises);
    const values = results.map((r) => r.value).sort((a, b) => a - b);
    expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await getKv(PID, GID, KEY))?.value).toBe(String(N));
  });
});
