/**
 * command-system/webhook-forwarder.service.ts — M1-C1 骨架實作
 *
 * WebhookForwarder：統一 source=custom/plugin/system 的外部 HTTP 轉發。
 * 取代分散在 user-slash-behavior.service.ts 與 webhook-behavior.events.ts 的雙路邏輯。
 *
 * 對齊 C-runtime §7（裸 Plugin Webhook 相容契約）：
 *   - POST schema 對齊 RESTPostAPIWebhookWithTokenJSONBody
 *   - HMAC 簽署依 behavior.webhookAuthMode（CR-2）：
 *       'token'  → X-Plugin-Webhook-Token: <secret>
 *       'hmac'   → X-Karyl-Signature + X-Karyl-Signature-V1（雙簽，現有路徑）
 *       null     → 不簽（裸 HTTP）
 *   - source=system：不發外部 HTTP（直接 throw，由 InteractionDispatcher 不呼叫此方法）
 *   - source=plugin：URL = {plugins.url}{webhook_path}（從 manifest behaviors[] 找）
 *   - source=custom：URL 從 behaviors.webhookUrl 解密讀
 *   - 解析 response 拿 relayContent + 偵測 [BEHAVIOR:END] sentinel
 *   - 回 ForwardResult { ok, ended, relayContent, status?, error? }
 *
 * 狀態：dormant（M1-C1）。
 *   - 所有真實邏輯已實作（可供 M1-C2 接線）。
 *   - 不從 main.ts import，不掛任何 event listener。
 *
 * M1-C2 接線時：
 *   - InteractionDispatcher 的 constructor 傳入此 WebhookForwarder instance
 *   - MessagePatternMatcher 的 constructor 傳入此 WebhookForwarder instance
 *   - source=system 路徑由 InteractionDispatcher 直接處理，不會流到 forward()
 */

import type { RESTPostAPIWebhookWithTokenJSONBody } from "discord.js";
import { findPluginById } from "../plugin-system/models/plugin.model.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import {
  buildOutboundSignatureHeaders,
  verifyInboundSignature,
} from "../../utils/hmac.js";
import {
  assertExternalTarget,
  assertPluginTarget,
  HostPolicyError,
} from "../../utils/host-policy.js";
import { decryptSecret } from "../../utils/crypto.js";
import type { BehaviorRow } from "../behavior/models/behavior.model.js";
import type { ForwardResult } from "./types.js";
import type {
  PluginManifest,
  ManifestBehaviorV2,
} from "../plugin-system/plugin-registry.service.js";

// ── 常數 ─────────────────────────────────────────────────────────────────────

/**
 * sentinel token（C-runtime §7.3 / R-3 保留）。
 * 出現在 response.content 時觸發 endSession。
 * 與 webhook-dispatch.service.ts 的 BEHAVIOR_END_TOKEN 一致。
 */
export const BEHAVIOR_END_TOKEN = "[BEHAVIOR:END]";
const BEHAVIOR_END_RE = /\[BEHAVIOR:END\]/gi;

/** X-Plugin-Webhook-Token header name（CR-2 token mode）。 */
const PLUGIN_WEBHOOK_TOKEN_HEADER = "x-plugin-webhook-token";

// ── WebhookForwarder ─────────────────────────────────────────────────────────

export class WebhookForwarder {
  /**
   * 轉發 behavior webhook POST。
   *
   * @param behavior  behaviors 表的 row（含三軸欄位）
   * @param payload   Discord webhook 形狀的 body（RESTPostAPIWebhookWithTokenJSONBody 相容）
   * @returns         含 ended / relayContent 的結果
   */
  async forward(
    behavior: BehaviorRow,
    payload: Record<string, unknown>,
  ): Promise<ForwardResult> {
    // source=system 不應該流到這裡
    if (behavior.source === "system") {
      botEventLog.record(
        "warn",
        "bot",
        `webhook-forwarder: source=system behavior ${behavior.id} 不應呼叫 forward()，跳過`,
        { behaviorId: behavior.id },
      );
      return {
        ok: false,
        ended: false,
        relayContent: "",
        error: "source=system behaviors 不走外部 HTTP 轉發",
      };
    }

    // 計算目標 URL
    const urlResult = await this.resolveUrl(behavior);
    if (!urlResult.ok) {
      return {
        ok: false,
        ended: false,
        relayContent: "",
        error: urlResult.error,
      };
    }
    const webhookUrl = urlResult.url;

    // 計算 secret（需在解密後才能簽署）
    const rawSecret = behavior.webhookSecret
      ? this.safeDecrypt(behavior.webhookSecret, behavior.id)
      : null;

    return this.doPost(webhookUrl, payload, behavior, rawSecret);
  }

  // ── 私有：URL 解析 ────────────────────────────────────────────────────────

  private async resolveUrl(
    behavior: BehaviorRow,
  ): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    if (behavior.source === "custom") {
      // source=custom：URL 從 behaviors.webhookUrl 解密讀
      if (!behavior.webhookUrl) {
        return { ok: false, error: "custom behavior 缺少 webhookUrl" };
      }
      try {
        const decrypted = decryptSecret(behavior.webhookUrl);
        return { ok: true, url: decrypted };
      } catch (err) {
        return {
          ok: false,
          error: `webhookUrl 解密失敗：${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    if (behavior.source === "plugin") {
      // source=plugin：URL = {plugins.url}{webhook_path}（從 manifest behaviors[] 找）
      if (!behavior.pluginId || !behavior.pluginBehaviorKey) {
        return { ok: false, error: "plugin behavior 缺少 pluginId 或 pluginBehaviorKey" };
      }
      const plugin = await findPluginById(behavior.pluginId);
      if (!plugin) {
        return { ok: false, error: `plugin ${behavior.pluginId} 不存在` };
      }
      if (!plugin.enabled || plugin.status !== "active") {
        return {
          ok: false,
          error: `plugin ${plugin.pluginKey} 目前離線或已停用`,
        };
      }

      // 解析 manifest 找 webhook_path（OQ-14：schema_version 必須為 '2'）
      let manifest: PluginManifest | null = null;
      try {
        const parsed = JSON.parse(plugin.manifestJson) as PluginManifest;
        if (parsed.schema_version !== "2") {
          return { ok: false, error: `plugin ${plugin.pluginKey} manifest 非 v2，跳過` };
        }
        manifest = parsed;
      } catch {
        return { ok: false, error: `plugin ${plugin.pluginKey} manifest 解析失敗` };
      }

      const behaviorDef = this.findBehaviorDef(manifest, behavior.pluginBehaviorKey);
      if (!behaviorDef) {
        return {
          ok: false,
          error: `plugin ${plugin.pluginKey} manifest behaviors[] 中找不到 key=${behavior.pluginBehaviorKey}`,
        };
      }

      const baseUrl = plugin.url.replace(/\/$/, "");
      const path = behaviorDef.webhook_path.startsWith("/")
        ? behaviorDef.webhook_path
        : `/${behaviorDef.webhook_path}`;
      return { ok: true, url: `${baseUrl}${path}` };
    }

    return { ok: false, error: `未知 source：${behavior.source}` };
  }

  private findBehaviorDef(
    manifest: PluginManifest,
    behaviorKey: string,
  ): ManifestBehaviorV2 | null {
    return manifest.behaviors?.find((b: ManifestBehaviorV2) => b.key === behaviorKey) ?? null;
  }

  // ── 私有：HTTP POST ───────────────────────────────────────────────────────

  private async doPost(
    webhookUrl: string,
    payload: Record<string, unknown>,
    behavior: BehaviorRow,
    rawSecret: string | null,
  ): Promise<ForwardResult> {
    let url: URL;
    try {
      url = new URL(webhookUrl);
    } catch {
      return { ok: false, ended: false, relayContent: "", error: "無效的 webhook URL" };
    }

    url.searchParams.set("wait", "true");

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // HMAC 簽署（CR-2 兩 mode）
    const authMode = behavior.webhookAuthMode;
    if (rawSecret) {
      if (authMode === "token") {
        // token mode：X-Plugin-Webhook-Token: <secret>（裸 shared secret）
        headers[PLUGIN_WEBHOOK_TOKEN_HEADER] = rawSecret;
      } else if (authMode === "hmac") {
        // hmac mode：走現有雙簽路徑
        const sigHeaders = buildOutboundSignatureHeaders(
          rawSecret,
          "POST",
          url.pathname,
          body,
        );
        Object.assign(headers, sigHeaders);
      }
      // authMode=null 且有 secret：異常狀態，不簽（已由 CR-6 DB CHECK 攔截）
    }

    // host-policy 檢查
    const port = url.port
      ? Number(url.port)
      : url.protocol === "https:"
        ? 443
        : 80;

    try {
      if (behavior.source === "plugin") {
        await assertPluginTarget(url.hostname, port);
      } else {
        await assertExternalTarget(url.hostname, port);
      }
    } catch (err) {
      if (!(err instanceof HostPolicyError)) throw err;
      return { ok: false, ended: false, relayContent: "", error: err.message };
    }

    // 發送 HTTP POST
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        ended: false,
        relayContent: "",
        error: `network error: ${msg}`,
      };
    }

    const rawText = await res.text().catch(() => "");

    if (!res.ok) {
      return {
        ok: false,
        ended: false,
        relayContent: "",
        status: res.status,
        error: rawText ? rawText.slice(0, 500) : `HTTP ${res.status}`,
      };
    }

    // hmac mode：驗證 response 簽名
    if (rawSecret && authMode === "hmac") {
      const verdict = verifyInboundSignature(
        rawSecret,
        res.headers,
        rawText,
        Math.floor(Date.now() / 1000),
        "POST",
        url.pathname,
      );
      if (!verdict.ok) {
        return {
          ok: false,
          ended: false,
          relayContent: "",
          status: res.status,
          error: verdict.reason,
        };
      }
    }

    // 解析 response body
    let responseContent = "";
    if (rawText.length > 0) {
      try {
        const parsed = JSON.parse(rawText) as { content?: unknown };
        if (typeof parsed.content === "string") {
          responseContent = parsed.content;
        }
      } catch {
        // wait=true 應永遠回 JSON，misbehaving webhook server 回純文字時視為無 content
        return { ok: true, ended: false, relayContent: "" };
      }
    }

    // 偵測 [BEHAVIOR:END] sentinel（C-runtime §7.3 / R-3）
    const ended = BEHAVIOR_END_RE.test(responseContent);
    BEHAVIOR_END_RE.lastIndex = 0; // 重置 global regex lastIndex
    const relayContent = ended
      ? responseContent.replace(BEHAVIOR_END_RE, "").trim()
      : responseContent.trim();
    BEHAVIOR_END_RE.lastIndex = 0;

    return { ok: true, ended, relayContent };
  }

  // ── 私有：安全解密（不讓解密失敗 crash forward）──────────────────────────

  private safeDecrypt(encrypted: string, behaviorId: number): string | null {
    try {
      return decryptSecret(encrypted);
    } catch (err) {
      botEventLog.record(
        "warn",
        "bot",
        `webhook-forwarder: behavior ${behaviorId} webhookSecret 解密失敗，以 null 處理：${err instanceof Error ? err.message : String(err)}`,
        { behaviorId },
      );
      return null;
    }
  }
}
