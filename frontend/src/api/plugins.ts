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
  /** v2 manifest behaviors（軌二），取代 dm_behaviors */
  behaviors?: Array<{
    key: string;
    name: string;
    description?: string;
    supports_continuous?: boolean;
    scope?: string;
    integration_types?: string[];
    contexts?: string[];
    webhook_path?: string;
  }>;
  /** v2 manifest plugin_commands（軌三），admin 只能 on/off */
  plugin_commands?: Array<{
    name: string;
    description?: string;
    scope?: string;
    integration_types?: string[];
    contexts?: string[];
    default_member_permissions?: string;
    default_ephemeral?: boolean;
  }>;
  commands?: Array<{
    name: string;
    description: string;
    scope?: "guild" | "global";
  }>;
}

/** 軌三 plugin_command DB 行（詳情頁專用） */
export interface PluginCommandRecord {
  id: number;
  name: string;
  featureKey: string | null;
  adminEnabled: boolean;
  manifestJson: string;
}

/** Plugin 詳情頁回傳（含 pluginCommands） */
export interface PluginDetailRecord extends PluginRecord {
  pluginCommands: PluginCommandRecord[];
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
  approvedScopes: string[];
  pendingScopes: string[];
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

// ─── Plugin scope approval ─────────────────────────────────────────

export interface ApproveScopesResult {
  approved: string[];
  pending: string[];
}

export async function approvePluginScopes(
  id: number,
): Promise<ApproveScopesResult> {
  const r = await authedFetch(`/api/plugins/${id}/approve-scopes`, {
    method: "POST",
  });
  return jsonOrThrow<ApproveScopesResult>(r);
}

// ─── Plugin delete ─────────────────────────────────────────────────

export async function deletePlugin(id: number): Promise<void> {
  const r = await authedFetch(`/api/plugins/${id}`, { method: "DELETE" });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(r.status, body.error ?? `${r.status} ${r.statusText}`);
  }
}

// ─── Plugin setup secret ───────────────────────────────────────────

export interface GenerateSetupSecretResult {
  pluginKey: string;
  setupSecret: string;
}

export async function generatePluginSetupSecret(
  pluginKey: string,
  secret?: string,
): Promise<GenerateSetupSecretResult> {
  const r = await authedFetch("/api/plugins/setup-secret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      secret !== undefined ? { pluginKey, secret } : { pluginKey },
    ),
  });
  return jsonOrThrow<GenerateSetupSecretResult>(r);
}

// ─── Plugin detail (by pluginKey) ─────────────────────────────────

/** GET /api/plugins/by-key/:pluginKey — 詳情頁（含 pluginCommands） */
export async function getPluginByKey(
  pluginKey: string,
): Promise<PluginDetailRecord> {
  const r = await authedFetch(`/api/plugins/by-key/${encodeURIComponent(pluginKey)}`);
  const body = await jsonOrThrow<{ plugin: PluginDetailRecord }>(r);
  return body.plugin;
}

// ─── Plugin command admin-enabled toggle ───────────────────────────

export interface SetPluginCommandEnabledResult {
  command: { id: number; adminEnabled: boolean };
}

/** PATCH /api/plugin-commands/:id/admin-enabled */
export async function setPluginCommandEnabled(
  id: number,
  enabled: boolean,
): Promise<SetPluginCommandEnabledResult> {
  const r = await authedFetch(`/api/plugin-commands/${id}/admin-enabled`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return jsonOrThrow<SetPluginCommandEnabledResult>(r);
}
