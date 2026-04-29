import { ApiError, authedFetch } from "./client";

/**
 * Plugin admin API client. Mirrors the bot-side route shapes in
 * src/modules/plugin-system/plugin-routes.ts. The plugin manifest passes through as an
 * opaque object — the page renders fields it knows about and shows
 * the rest as a folded JSON blob.
 */

export type PluginStatus = "active" | "inactive";

/**
 * Loosely-typed manifest as it arrives from the bot. The bot validated
 * `schema_version=1` shape on accept; we trust `plugin.{id,name,...}`
 * exists and treat optional sections as truly optional in the UI.
 */
export interface PluginManifest {
  schema_version: string;
  plugin: {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    homepage?: string;
    url: string;
    healthcheck_path?: string;
  };
  rpc_methods_used?: string[];
  storage?: {
    guild_kv?: boolean;
    guild_kv_quota_kb?: number;
    requires_secrets?: boolean;
  };
  config_schema?: Array<{
    key: string;
    type: string;
    label: string;
    description?: string;
    required?: boolean;
  }>;
  guild_features?: Array<{
    key: string;
    name: string;
    icon?: string;
    description?: string;
    events_subscribed?: string[];
    surfaces?: string[];
    /**
     * Slash commands declared inside this feature, registered per-
     * guild and gated by the per-guild feature toggle.
     */
    commands?: Array<{
      name: string;
      description: string;
      scope?: "guild" | "global";
    }>;
  }>;
  dm_behaviors?: Array<{
    key: string;
    name: string;
    description?: string;
    supports_continuous?: boolean;
  }>;
  commands?: Array<{
    name: string;
    description: string;
    scope?: "guild" | "global";
  }>;
}

export interface PluginRecord {
  id: number;
  pluginKey: string;
  name: string;
  version: string;
  url: string;
  status: PluginStatus;
  enabled: boolean;
  lastHeartbeatAt: string | null;
  manifest: PluginManifest | null;
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

export async function listPlugins(): Promise<PluginRecord[]> {
  const r = await authedFetch("/api/plugins");
  const body = await jsonOrThrow<{ plugins: PluginRecord[] }>(r);
  return body.plugins;
}

export async function getPlugin(id: number): Promise<PluginRecord> {
  const r = await authedFetch(`/api/plugins/${id}`);
  const body = await jsonOrThrow<{ plugin: PluginRecord }>(r);
  return body.plugin;
}

export async function setPluginEnabled(
  id: number,
  enabled: boolean,
): Promise<{ id: number; pluginKey: string; enabled: boolean }> {
  const r = await authedFetch(`/api/plugins/${id}/enabled`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const body = await jsonOrThrow<{
    plugin: { id: number; pluginKey: string; enabled: boolean };
  }>(r);
  return body.plugin;
}

// ─── Plugin-level config (admin-editable) ──────────────────────────

export interface PluginConfigField {
  key: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "channel"
    | "role"
    | "user"
    | "url"
    | "secret"
    | "regex";
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
}

export interface PluginConfigValue {
  key: string;
  set: boolean;
  /** For secret fields the API returns "********" instead of plaintext. */
  value: string | null;
}

export interface PluginConfigPayload {
  schema: PluginConfigField[];
  values: PluginConfigValue[];
}

export async function getPluginConfig(
  id: number,
): Promise<PluginConfigPayload> {
  const r = await authedFetch(`/api/plugins/${id}/config`);
  return jsonOrThrow<PluginConfigPayload>(r);
}

export async function setPluginConfig(
  id: number,
  values: Record<string, string | null>,
): Promise<{ accepted: string[]; skipped: string[] }> {
  const r = await authedFetch(`/api/plugins/${id}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  return jsonOrThrow<{ accepted: string[]; skipped: string[] }>(r);
}
