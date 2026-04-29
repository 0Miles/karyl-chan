import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SQLITE_DB_PATH = ":memory:";
});

import { sequelize } from "../src/db.js";
import {
  PluginFeatureDefault,
  findAllFeatureDefaults,
  findFeatureDefault,
  findFeatureDefaultsByPlugin,
  upsertFeatureDefault,
} from "../src/modules/feature-toggle/models/plugin-feature-default.model.js";

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

beforeEach(async () => {
  await PluginFeatureDefault.destroy({ where: {} });
});

describe("plugin-feature-default model", () => {
  it("upsert creates a row when none exists", async () => {
    const row = await upsertFeatureDefault(1, "feat-a", true);
    expect(row.pluginId).toBe(1);
    expect(row.featureKey).toBe("feat-a");
    expect(row.enabled).toBe(true);
  });

  it("upsert updates the existing row when called again", async () => {
    await upsertFeatureDefault(1, "feat-a", true);
    const updated = await upsertFeatureDefault(1, "feat-a", false);
    expect(updated.enabled).toBe(false);
    // Still one row, not two — uniqueness on (pluginId, featureKey).
    const all = await findAllFeatureDefaults();
    expect(all.length).toBe(1);
  });

  it("findFeatureDefault returns null for unknown rows", async () => {
    const row = await findFeatureDefault(99, "missing");
    expect(row).toBeNull();
  });

  it("findFeatureDefault returns the row when present", async () => {
    await upsertFeatureDefault(7, "feat-x", true);
    const row = await findFeatureDefault(7, "feat-x");
    expect(row).not.toBeNull();
    expect(row?.enabled).toBe(true);
  });

  it("findFeatureDefaultsByPlugin scopes to the requested pluginId", async () => {
    await upsertFeatureDefault(1, "a", true);
    await upsertFeatureDefault(1, "b", false);
    await upsertFeatureDefault(2, "a", true);
    const p1 = await findFeatureDefaultsByPlugin(1);
    expect(p1.map((r) => r.featureKey).sort()).toEqual(["a", "b"]);
    const p2 = await findFeatureDefaultsByPlugin(2);
    expect(p2.map((r) => r.featureKey)).toEqual(["a"]);
  });

  it("findAllFeatureDefaults returns every row across plugins", async () => {
    await upsertFeatureDefault(1, "a", true);
    await upsertFeatureDefault(2, "b", false);
    await upsertFeatureDefault(3, "c", true);
    const rows = await findAllFeatureDefaults();
    expect(rows.length).toBe(3);
  });

  it("(pluginId, featureKey) acts as the unique key", async () => {
    // Two upserts with the same (pluginId, featureKey) but different
    // enabled values should converge on a single row holding the
    // latest value.
    await upsertFeatureDefault(5, "shared", true);
    await upsertFeatureDefault(5, "shared", false);
    await upsertFeatureDefault(5, "shared", true);
    const all = await findFeatureDefaultsByPlugin(5);
    expect(all.length).toBe(1);
    expect(all[0].enabled).toBe(true);
  });
});
