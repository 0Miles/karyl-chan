import { ApiError, authedFetch } from "./client";

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
 *                  POST /api/plugins/:id/feature-defaults/:featureKey/apply-to-all
 *     Used in the "All Servers" dashboard to manage operator-level
 *     defaults that override the manifest's enabled_by_default for
 *     every (current and future) guild.
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
  enabled: boolean;
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

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(
      response.status,
      body.error ?? `${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
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

export async function applyFeatureDefaultToAll(
  pluginId: number,
  featureKey: string,
): Promise<{ updated: number; skipped: number }> {
  const r = await authedFetch(
    `/api/plugins/${pluginId}/feature-defaults/${featureKey}/apply-to-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  return jsonOrThrow<{ updated: number; skipped: number }>(r);
}
