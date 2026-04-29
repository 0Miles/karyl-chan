import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SQLITE_DB_PATH = ":memory:";
});

import { sequelize } from "../src/models/db.js";
import {
  PluginGuildFeature,
  findFeatureRow,
  findFeatureRowsByGuild,
  findFeatureRowsByPlugin,
  upsertFeatureRow,
  updateMetricsJson,
} from "../src/models/plugin-guild-feature.model.js";

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

beforeEach(async () => {
  await PluginGuildFeature.destroy({ where: {} });
});

describe("plugin-guild-feature model", () => {
  it("upsert creates a new row with sensible defaults", async () => {
    const row = await upsertFeatureRow({
      pluginId: 1,
      guildId: "g1",
      featureKey: "feat",
    });
    expect(row.enabled).toBe(false);
    expect(row.configJson).toBe("{}");
    expect(row.metricsJson).toBe("{}");
  });

  it("upsert preserves existing fields when caller omits them", async () => {
    await upsertFeatureRow({
      pluginId: 1,
      guildId: "g1",
      featureKey: "feat",
      enabled: true,
      configJson: '{"a":1}',
    });
    const updated = await upsertFeatureRow({
      pluginId: 1,
      guildId: "g1",
      featureKey: "feat",
      enabled: false,
      // configJson omitted on purpose
    });
    expect(updated.enabled).toBe(false);
    expect(updated.configJson).toBe('{"a":1}');
  });

  it("findFeatureRow returns null for missing rows", async () => {
    const row = await findFeatureRow(99, "missing", "x");
    expect(row).toBeNull();
  });

  it("findFeatureRowsByGuild scopes correctly", async () => {
    await upsertFeatureRow({
      pluginId: 1,
      guildId: "ga",
      featureKey: "f1",
      enabled: true,
    });
    await upsertFeatureRow({
      pluginId: 1,
      guildId: "ga",
      featureKey: "f2",
      enabled: false,
    });
    await upsertFeatureRow({
      pluginId: 1,
      guildId: "gb",
      featureKey: "f1",
      enabled: true,
    });
    const ga = await findFeatureRowsByGuild("ga");
    expect(ga.length).toBe(2);
    expect(ga.every((r) => r.guildId === "ga")).toBe(true);
  });

  it("findFeatureRowsByPlugin scopes correctly", async () => {
    await upsertFeatureRow({
      pluginId: 1,
      guildId: "ga",
      featureKey: "f",
      enabled: true,
    });
    await upsertFeatureRow({
      pluginId: 2,
      guildId: "ga",
      featureKey: "f",
      enabled: true,
    });
    const p1 = await findFeatureRowsByPlugin(1);
    expect(p1.length).toBe(1);
    expect(p1[0].pluginId).toBe(1);
  });

  it("updateMetricsJson only touches the metrics column", async () => {
    await upsertFeatureRow({
      pluginId: 1,
      guildId: "g1",
      featureKey: "f",
      enabled: true,
      configJson: '{"k":"v"}',
    });
    const updated = await updateMetricsJson(1, "g1", "f", '{"counter":42}');
    expect(updated?.metricsJson).toBe('{"counter":42}');
    expect(updated?.configJson).toBe('{"k":"v"}');
    expect(updated?.enabled).toBe(true);
  });

  it("updateMetricsJson returns null when row does not exist", async () => {
    const updated = await updateMetricsJson(99, "missing", "x", "{}");
    expect(updated).toBeNull();
  });

  it("(pluginId, guildId, featureKey) is unique — upsert collapses duplicates", async () => {
    for (let i = 0; i < 4; i++) {
      await upsertFeatureRow({
        pluginId: 1,
        guildId: "g",
        featureKey: "f",
        enabled: i % 2 === 0,
      });
    }
    const all = await findFeatureRowsByPlugin(1);
    expect(all.length).toBe(1);
  });
});
