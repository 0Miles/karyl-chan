/**
 * Plugin SDK type contract — the wire format between the bot and any
 * external plugin. Lifted out of `plugin-registry.service.ts` so:
 *
 *   1. Plugin authors have a single, narrow file to import or copy
 *      when authoring a v2 manifest, instead of pulling a service
 *      file's worth of runtime code along with it.
 *   2. The boundary between "data contract" (this file, version-
 *      gated by `schema_version`) and "registry implementation"
 *      (plugin-registry.service.ts) is explicit.
 *   3. A future breaking change (`schema_version: "3"`) bumps this
 *      file in lockstep — easier to diff and easier to ship a
 *      migration shim alongside.
 *
 * The fields here match what `validateManifest` accepts.
 */

export interface ManifestCommandOption {
  type: string;
  name: string;
  description?: string;
  required?: boolean;
  channel_types?: string[];
  options?: ManifestCommandOption[];
  choices?: Array<{ name: string; value: string | number }>;
}

export interface ManifestCommand {
  name: string;
  description: string;
  scope?: "guild" | "global";
  default_member_permissions?: string;
  default_ephemeral?: boolean;
  required_capability?: string;
  dm_permission?: boolean;
  /**
   * Discord interaction context restriction. Modern replacement for
   * `dm_permission`. Set to e.g. ["BotDM","PrivateChannel"] for a
   * DM-only command, or ["Guild","BotDM","PrivateChannel"] to allow
   * everywhere. When omitted, Discord's default ([Guild]) applies.
   */
  contexts?: ("Guild" | "BotDM" | "PrivateChannel")[];
  /**
   * Where the bot can be installed for this command to be visible.
   * "guild_install" = traditional bot-in-server install,
   * "user_install" = personal-attach install. Most plugins want
   * ["guild_install","user_install"] so DM commands work when the
   * user has user-installed the bot. When omitted, Discord defaults
   * to ["guild_install"] only.
   */
  integration_types?: ("guild_install" | "user_install")[];
  options?: ManifestCommandOption[];
}

export interface ManifestConfigField {
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

export interface ManifestGuildFeature {
  key: string;
  name: string;
  icon?: string;
  description?: string;
  enabled_by_default?: boolean;
  events_subscribed?: string[];
  config_schema?: ManifestConfigField[];
  surfaces?: string[];
  overview_metrics?: Array<{ key: string; label: string; type: string }>;
  /**
   * Slash commands that belong to this guild_feature. They register
   * per-guild and are gated by the same per-guild toggle that
   * controls the feature itself — toggle off → commands deleted from
   * Discord for that guild; toggle on → commands re-registered.
   *
   * This is distinct from top-level `manifest.commands[]`, which
   * register globally and stay visible regardless of any per-guild
   * feature state.
   */
  commands?: ManifestCommand[];
}

/**
 * v2：plugin 宣告的一個 RBAC 權限詞條（manifest 形式）。
 */
export interface ManifestCapabilityDecl {
  /** plugin 內唯一，格式 [a-z0-9][a-z0-9._-]*。 */
  key: string;
  /** 給 admin 看的說明文字（非空）。 */
  description: string;
}

/**
 * v2 軌三：plugin_commands[]（plugin 鎖死三軸，admin 只能 on/off）。
 */
export interface ManifestPluginCommandV2 {
  /** Discord slash command name，格式 [a-z0-9][a-z0-9-]{0,31}。 */
  name: string;
  /** 必填，非空字串（V-05）。 */
  description: string;
  /** V-06：必須是 "guild" 或 "global"。 */
  scope: "guild" | "global";
  /** V-07：必須是合法子集。 */
  integration_types: Array<"guild_install" | "user_install">;
  /** V-08：必須是合法子集。 */
  contexts: Array<"Guild" | "BotDM" | "PrivateChannel">;
  options?: ManifestCommandOption[];
  default_member_permissions?: string;
  default_ephemeral?: boolean;
  required_capability?: string;
}

/**
 * Top-level plugin manifest as posted to `/api/plugins/register`.
 * Bot-side validation lives in `plugin-registry.service.ts`'s
 * `validateManifest`; both the bot and the plugin SDK should treat
 * this file as the authoritative shape.
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
  /**
   * Plugin-level config that the operator can edit from the admin UI.
   * Values persist in the `plugin_configs` table.
   */
  config_schema?: ManifestConfigField[];
  guild_features?: ManifestGuildFeature[];
  /** v2 軌三：plugin 自訂指令（三軸寫死）。 */
  plugin_commands?: ManifestPluginCommandV2[];
  /**
   * v2：plugin 為自身需求宣告的 RBAC 權限詞條。register 時持久化到
   * plugin_capabilities，並在 admin 身分組權限 modal 開專屬分頁。
   * 對外 token 形式 `plugin:<plugin.id>:<key>`。
   */
  capabilities?: ManifestCapabilityDecl[];
  /**
   * @deprecated v1 欄位，v2 改用 plugin_commands[]。
   * 保留型別以不破壞 manifestJson 的 JSON.parse；validateManifest 不再接受含此欄位的 manifest。
   */
  commands?: ManifestCommand[];
  events_subscribed_global?: string[];
  endpoints?: {
    events?: string;
    /** v2：取代 v1 的 command。 */
    plugin_command?: string;
    /** v2：plugin 元件（按鈕）互動派送端點，預設 `/components`。 */
    plugin_component?: string;
    guild_feature_action?: string;
    /** @deprecated v1 欄位。 */
    command?: string;
  };
}
