/**
 * command-system/webhook-forwarder.service.ts
 *
 * WebhookForwarder：把 `source='custom'` behavior 的 webhook 轉發到 admin
 * 設定的外部 URL（POST schema 對齊 RESTPostAPIWebhookWithTokenJSONBody）。
 *
 *   - HMAC 簽署依 behavior.webhookAuthMode（CR-2）：
 *       'token'  → X-Plugin-Webhook-Token: <secret>
 *       'hmac'   → X-Karyl-Signature + X-Karyl-Signature-V1（雙簽）
 *       null     → 不簽（裸 HTTP）
 *   - source='system' 不發外部 HTTP（InteractionDispatcher 不會呼叫 forward()）
 *   - URL 從 behaviors.webhookUrl 解密讀
 *   - 解析 response 拿 relayContent + 偵測 [BEHAVIOR:END] sentinel
 *   - 回 ForwardResult { ok, ended, relayContent, status?, error? }
 */

import type { RESTPostAPIWebhookWithTokenJSONBody } from "discord.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import {
  buildOutboundSignatureHeaders,
  verifyInboundSignature,
  SIGNATURE_HEADER,
  SIGNATURE_HEADER_V1,
} from "../../utils/hmac.js";
import { shouldRecord } from "../bot-events/bot-event-dedup.js";
import {
  assertExternalTarget,
  HostPolicyError,
} from "../../utils/host-policy.js";
import { decryptSecret } from "../../utils/crypto.js";
import type { BehaviorRow } from "../behavior/models/behavior.model.js";
import type { ForwardResult } from "./types.js";

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

    return { ok: false, error: `未知或不可轉發的 source：${behavior.source}` };
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
      return {
        ok: false,
        ended: false,
        relayContent: "",
        error: "無效的 webhook URL",
      };
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
      await assertExternalTarget(url.hostname, port);
    } catch (err) {
      if (!(err instanceof HostPolicyError)) throw err;
      return { ok: false, ended: false, relayContent: "", error: err.message };
    }

    // 發送 HTTP POST
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
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

    // Response signature verification:
    //
    //  - hmac mode → required, fail closed if missing/invalid.
    //  - token mode → optional but verified opportunistically: if the
    //    webhook server signs its response with the shared bearer
    //    secret as the HMAC key, we verify and trust. If it omits the
    //    signature headers, we log once (deduped) so the operator
    //    knows responses from this behavior aren't authenticated,
    //    but accept the response — most existing token-mode webhooks
    //    don't sign and forcing them to upgrade in lockstep would
    //    break compat.
    //
    //  Webhook authors who want token-mode signing can use the same
    //  buildOutboundSignatureHeaders helper from utils/hmac.ts.
    const hasSignatureHeaders =
      res.headers.has(SIGNATURE_HEADER) || res.headers.has(SIGNATURE_HEADER_V1);
    if (rawSecret && (authMode === "hmac" || hasSignatureHeaders)) {
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
    } else if (
      authMode === "token" &&
      rawText.length > 0 &&
      shouldRecord(`webhook-token-unsigned:${behavior.id}`)
    ) {
      botEventLog.record(
        "warn",
        "bot",
        `webhook-forwarder: behavior ${behavior.id} (token mode) returned an unsigned response — content is being relayed unauthenticated. Switch to hmac mode or sign responses with the shared secret to harden.`,
        { behaviorId: behavior.id, authMode },
      );
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
