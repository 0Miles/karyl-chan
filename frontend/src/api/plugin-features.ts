import { authedFetch, jsonOrThrow } from "./client";

/**
 * Plugin guild-feature admin API. Two complementary surfaces:
 *
 *   - Per-guild: GET /api/plugins/guilds/:guildId/features
 *                PUT /api/plugins/:id/guilds/:guildId/features/:featureKey
 *     Used inside a single-guild detail page to toggle / configure
 *     plugin-provided features for that guild.
 *
 *   - Cross-guild: GET /api/plugins/feature-defaults
 *                  PUT /api/plugins/:id/feature-defaults/:featureKey
 *     Used in the "All Servers" dashboard to manage operator-level
 *     defaults that override the manifest's enabled_by_default. A
 *     guild with no explicit per-guild row follows the default, so
 *     changing it takes effect everywhere automatically (the bot
 *     re-syncs the feature's slash commands) — no "apply to all" step.
 */

export interface GuildFeatureItem {
  pluginId: number;
  pluginKey: string;
  pluginName: string;
  featureKey: string;
  name: string;
  description: string | undefined;
  icon: string | undefined;
  configSchema: unknown;
  surfaces: string[];
  /** Effective on/off for this guild: per-guild row → operator default → manifest default → false. */
  enabled: boolean;
  /** True if there's an explicit per-guild row (i.e. this guild overrides the default). */
  overridden: boolean;
  /** The default this guild falls back to when not overridden. */
  defaultEnabled: boolean;
  config: Record<string, unknown>;
  metrics: Record<string, unknown>;
  pluginEnabled: boolean;
  pluginStatus: "active" | "inactive";
}

export interface FeatureDefaultItem {
  pluginId: number;
  pluginKey: string;
  pluginName: string;
  pluginEnabled: boolean;
  pluginStatus: "active" | "inactive";
  featureKey: string;
  featureName: string;
  featureDescription: string | undefined;
  featureIcon: string | undefined;
  manifestDefault: boolean;
  override: boolean | null;
  effectiveDefault: boolean;
  enabledGuildCount: number;
  disabledGuildCount: number;
}

export async function listGuildFeatures(
  guildId: string,
): Promise<GuildFeatureItem[]> {
  const r = await authedFetch(`/api/plugins/guilds/${guildId}/features`);
  const body = await jsonOrThrow<{ features: GuildFeatureItem[] }>(r);
  return body.features;
}

export async function setGuildFeatureEnabled(
  pluginId: number,
  guildId: string,
  featureKey: string,
  enabled: boolean,
): Promise<void> {
  const r = await authedFetch(
    `/api/plugins/${pluginId}/guilds/${guildId}/features/${featureKey}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  await jsonOrThrow<unknown>(r);
}

export async function listFeatureDefaults(): Promise<FeatureDefaultItem[]> {
  const r = await authedFetch("/api/plugins/feature-defaults");
  const body = await jsonOrThrow<{ features: FeatureDefaultItem[] }>(r);
  return body.features;
}

export async function setFeatureDefault(
  pluginId: number,
  featureKey: string,
  enabled: boolean,
): Promise<void> {
  const r = await authedFetch(
    `/api/plugins/${pluginId}/feature-defaults/${featureKey}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  await jsonOrThrow<unknown>(r);
}
