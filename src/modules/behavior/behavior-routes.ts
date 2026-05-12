/**
 * behavior-routes.ts — M1-D1：v2 admin/behaviors REST API
 *
 * 提供完整 CRUD + resync endpoint，對應 v2 BehaviorRow 欄位。
 *
 * 路由表：
 *   GET    /api/behaviors                  — list（可帶 audienceKind/source/triggerType filter）
 *   GET    /api/behaviors/:id              — 單條
 *   POST   /api/behaviors                  — 建立（custom source 才能用）
 *   PATCH  /api/behaviors/:id              — 修改（source 依據限制不同欄位）
 *   DELETE /api/behaviors/:id              — 刪除（system/plugin 不可刪）
 *   POST   /api/behaviors/:id/resync       — 觸發 CommandReconciler.reconcileForBehavior
 *
 * 權限：requireBehaviorAdmin（需 behavior.manage 或 admin）。
 *
 * 審計 log：CRUD 後寫 botEventLog（沿用既有 pattern）。
 */

import type { FastifyInstance } from "fastify";
import type { BehaviorRoutesOptions } from "./behavior-helpers.js";
import {
  requireBehaviorAdmin,
  decryptedView,
  isValidWebhookUrl,
  isValidRegex,
} from "./behavior-helpers.js";
import { sortJoin } from "../../utils/sort-join.js";
import {
  Behavior,
  rowOfBehavior,
  type BehaviorRow,
  type BehaviorTriggerType,
  type BehaviorAudienceKind,
  type BehaviorWebhookAuthMode,
} from "./models/behavior.model.js";
import {
  BehaviorScopeTab,
  deriveFieldsFromTab,
  rowOf as tabRowOf,
} from "./models/behavior-scope-tab.model.js";
import { Op, fn, col } from "sequelize";
import { encryptSecret } from "../../utils/crypto.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import type { CommandReconciler } from "../command-system/reconcile.service.js";

export type { BehaviorRoutesOptions };

// ── 主函式 ────────────────────────────────────────────────────────────────────

export async function registerBehaviorRoutes(
  server: FastifyInstance,
  options: BehaviorRoutesOptions = {},
): Promise<void> {
  function getReconciler(): CommandReconciler {
    if (!options.reconciler) {
      throw new Error("CommandReconciler not provided to behavior routes");
    }
    return options.reconciler;
  }

  // ── GET /api/behaviors ──────────────────────────────────────────────────────

  server.get("/api/behaviors", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const query = request.query as {
      scopeTabId?: string;
      audienceKind?: string;
      audienceUserId?: string;
      audienceGroupName?: string;
      source?: string;
      triggerType?: string;
    };

    const where: Record<string, unknown> = {};
    if (query.scopeTabId) {
      const tabId = parseInt(query.scopeTabId, 10);
      if (!isNaN(tabId)) where["scopeTabId"] = tabId;
    }
    if (
      query.audienceKind &&
      ["all", "user", "group"].includes(query.audienceKind)
    ) {
      where["audienceKind"] = query.audienceKind;
    }
    if (query.audienceUserId) {
      where["audienceUserId"] = query.audienceUserId;
    }
    if (query.audienceGroupName) {
      where["audienceGroupName"] = query.audienceGroupName;
    }
    if (query.source && ["custom", "system"].includes(query.source)) {
      where["source"] = query.source;
    }
    if (
      query.triggerType &&
      ["slash_command", "message_pattern"].includes(query.triggerType)
    ) {
      where["triggerType"] = query.triggerType;
    }

    const rows = await Behavior.findAll({
      where: Object.keys(where).length > 0 ? where : undefined,
      order: [
        ["sortOrder", "ASC"],
        ["id", "ASC"],
      ],
    });

    const behaviors = rows.map((r) => decryptedView(rowOfBehavior(r)));
    return reply.send({ behaviors });
  });

  // ── GET /api/behaviors/:id ──────────────────────────────────────────────────

  server.get("/api/behaviors/:id", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return reply.code(400).send({ error: "無效的 behavior ID" });
    }

    const row = await Behavior.findByPk(numId);
    if (!row) {
      return reply.code(404).send({ error: "Behavior 不存在" });
    }

    return reply.send({ behavior: decryptedView(rowOfBehavior(row)) });
  });

  // ── POST /api/behaviors ─────────────────────────────────────────────────────
  // admin 只能建立 source=custom（webhook URL）的 behavior；system 由系統 seed。

  server.post("/api/behaviors", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const body = request.body as {
      title?: string;
      description?: string;
      triggerType?: BehaviorTriggerType;
      messagePatternKind?: string;
      messagePatternValue?: string;
      slashCommandName?: string;
      slashCommandDescription?: string;
      scope?: string;
      integrationTypes?: string;
      contexts?: string;
      audienceKind?: BehaviorAudienceKind;
      audienceUserId?: string;
      audienceGroupName?: string;
      webhookUrl?: string;
      webhookSecret?: string;
      webhookAuthMode?: BehaviorWebhookAuthMode;
      forwardType?: string;
      stopOnMatch?: boolean;
      enabled?: boolean;
      scopeTabId?: number;
    };

    // 基本驗證
    if (!body.title?.trim()) {
      return reply.code(400).send({ error: "title 為必填" });
    }
    if (
      !body.triggerType ||
      !["slash_command", "message_pattern"].includes(body.triggerType)
    ) {
      return reply.code(400).send({ error: "無效的 triggerType" });
    }

    // webhookUrl（custom behavior 必填）驗證
    if (!body.webhookUrl?.trim()) {
      return reply.code(400).send({ error: "需要 webhookUrl" });
    }
    const urlCheck = await isValidWebhookUrl(body.webhookUrl.trim());
    if (!urlCheck.ok) {
      return reply.code(400).send({ error: urlCheck.reason });
    }

    // triggerType 相關驗證
    if (body.triggerType === "message_pattern") {
      if (
        !body.messagePatternKind ||
        !["startswith", "endswith", "regex"].includes(body.messagePatternKind)
      ) {
        return reply.code(400).send({ error: "無效的 messagePatternKind" });
      }
      if (!body.messagePatternValue?.trim()) {
        return reply.code(400).send({ error: "messagePatternValue 為必填" });
      }
      if (
        body.messagePatternKind === "regex" &&
        !isValidRegex(body.messagePatternValue)
      ) {
        return reply.code(400).send({ error: "regex 格式錯誤" });
      }
    } else {
      // slash_command
      if (!body.slashCommandName?.trim()) {
        return reply.code(400).send({ error: "slashCommandName 為必填" });
      }
    }

    // webhookAuthMode 與 webhookSecret 一致性
    if (body.webhookAuthMode && !body.webhookSecret) {
      return reply.code(400).send({
        error: "設定 webhookAuthMode 需要先設定 webhookSecret",
      });
    }

    // Resolve scope tab — derive scope/contexts/audience/placement
    let derivedScope = body.scope ?? "global";
    let derivedContexts: string;
    let derivedAudienceKind = body.audienceKind ?? "all";
    let derivedAudienceUserId = body.audienceUserId ?? null;
    let derivedAudienceGroupName = body.audienceGroupName ?? null;
    let derivedPlacementGuildId: string | null = null;
    let derivedPlacementChannelId: string | null = null;
    let resolvedTabId = body.scopeTabId ?? 1;

    if (body.scopeTabId) {
      const tabRow = await BehaviorScopeTab.findByPk(body.scopeTabId);
      if (!tabRow) {
        return reply.code(400).send({ error: "無效的 scopeTabId" });
      }
      const tab = tabRowOf(tabRow);
      const derived = deriveFieldsFromTab(tab);
      derivedScope = derived.scope;
      derivedContexts = derived.contexts;
      derivedAudienceKind = derived.audienceKind;
      derivedAudienceUserId = derived.audienceUserId;
      derivedAudienceGroupName = derived.audienceGroupName;
      derivedPlacementGuildId = derived.placementGuildId;
      derivedPlacementChannelId = derived.placementChannelId;
      resolvedTabId = body.scopeTabId;
    } else {
      derivedContexts = sortJoin(body.contexts || "Guild");
    }

    // 三軸排序
    const integrationTypes = sortJoin(body.integrationTypes || "guild_install");
    const contexts = body.scopeTabId
      ? derivedContexts
      : sortJoin(body.contexts || "Guild");

    // 最大 sortOrder
    const maxSortRow = await Behavior.findOne({
      order: [["sortOrder", "DESC"]],
      attributes: ["sortOrder"],
    });
    const nextSortOrder = maxSortRow
      ? (maxSortRow.getDataValue("sortOrder") as number) + 1
      : 0;

    const row = await Behavior.create({
      title: body.title.trim(),
      description: body.description ?? "",
      source: "custom",
      triggerType: body.triggerType,
      messagePatternKind:
        body.triggerType === "message_pattern" ? body.messagePatternKind : null,
      messagePatternValue:
        body.triggerType === "message_pattern"
          ? body.messagePatternValue
          : null,
      slashCommandName:
        body.triggerType === "slash_command"
          ? body.slashCommandName?.trim()
          : null,
      slashCommandDescription:
        body.triggerType === "slash_command"
          ? (body.slashCommandDescription ?? "")
          : null,
      scope: derivedScope,
      integrationTypes,
      contexts,
      audienceKind: derivedAudienceKind,
      audienceUserId:
        derivedAudienceKind === "user" ? derivedAudienceUserId : null,
      audienceGroupName:
        derivedAudienceKind === "group" ? derivedAudienceGroupName : null,
      placementGuildId: derivedPlacementGuildId,
      placementChannelId: derivedPlacementChannelId,
      webhookUrl: encryptSecret(body.webhookUrl.trim()),
      webhookSecret: body.webhookSecret
        ? encryptSecret(body.webhookSecret)
        : null,
      webhookAuthMode: body.webhookSecret
        ? (body.webhookAuthMode ?? "token")
        : null,
      systemKey: null,
      forwardType: body.forwardType ?? "one_time",
      stopOnMatch: !!body.stopOnMatch,
      enabled: body.enabled !== undefined ? !!body.enabled : true,
      sortOrder: nextSortOrder,
      scopeTabId: resolvedTabId,
    });

    const created = decryptedView(rowOfBehavior(row));

    botEventLog.record(
      "info",
      "web",
      `behavior 已建立 id=${created.id} source=${created.source}`,
      {
        behaviorId: created.id,
      },
    );

    return reply.code(201).send({ behavior: created });
  });

  // ── PATCH /api/behaviors/:id ────────────────────────────────────────────────
  // custom：全欄位可改
  // system：只能改 trigger value（slashCommandName / messagePatternValue）+ enabled

  server.patch("/api/behaviors/:id", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return reply.code(400).send({ error: "無效的 behavior ID" });
    }

    const existing = await Behavior.findByPk(numId);
    if (!existing) {
      return reply.code(404).send({ error: "Behavior 不存在" });
    }

    const existingRow = rowOfBehavior(existing);
    const body = request.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (existingRow.source === "system") {
      // system：只能改 trigger value + enabled
      if (
        "slashCommandName" in body &&
        existingRow.triggerType === "slash_command"
      ) {
        const val = (body["slashCommandName"] as string | null)?.trim();
        if (val !== undefined) patch["slashCommandName"] = val;
      }
      if (
        "messagePatternValue" in body &&
        existingRow.triggerType === "message_pattern"
      ) {
        const val = (body["messagePatternValue"] as string | null)?.trim();
        if (val !== undefined) {
          if (
            existingRow.messagePatternKind === "regex" &&
            val &&
            !isValidRegex(val)
          ) {
            return reply.code(400).send({ error: "regex 格式錯誤" });
          }
          patch["messagePatternValue"] = val;
        }
      }
      if ("enabled" in body) {
        patch["enabled"] = !!body["enabled"];
      }
    } else {
      // custom：全欄位可改
      if ("title" in body) {
        const title = (body["title"] as string)?.trim();
        if (!title) return reply.code(400).send({ error: "title 不可為空" });
        patch["title"] = title;
      }
      if ("description" in body)
        patch["description"] = body["description"] ?? "";
      if ("triggerType" in body) {
        if (
          !["slash_command", "message_pattern"].includes(
            body["triggerType"] as string,
          )
        ) {
          return reply.code(400).send({ error: "無效的 triggerType" });
        }
        patch["triggerType"] = body["triggerType"];
      }
      if ("messagePatternKind" in body)
        patch["messagePatternKind"] = body["messagePatternKind"] ?? null;
      if ("messagePatternValue" in body) {
        const val =
          (body["messagePatternValue"] as string | null)?.trim() ?? null;
        if (
          val &&
          (body["messagePatternKind"] ?? existingRow.messagePatternKind) ===
            "regex" &&
          !isValidRegex(val)
        ) {
          return reply.code(400).send({ error: "regex 格式錯誤" });
        }
        patch["messagePatternValue"] = val;
      }
      if ("slashCommandName" in body)
        patch["slashCommandName"] =
          (body["slashCommandName"] as string | null)?.trim() ?? null;
      if ("slashCommandDescription" in body)
        patch["slashCommandDescription"] =
          body["slashCommandDescription"] ?? null;
      if ("scope" in body) patch["scope"] = body["scope"];
      if ("integrationTypes" in body) {
        patch["integrationTypes"] = sortJoin(
          body["integrationTypes"] as string,
        );
      }
      if ("contexts" in body) {
        patch["contexts"] = sortJoin(body["contexts"] as string);
      }
      if ("audienceKind" in body) patch["audienceKind"] = body["audienceKind"];
      if ("audienceUserId" in body)
        patch["audienceUserId"] = body["audienceUserId"] ?? null;
      if ("audienceGroupName" in body)
        patch["audienceGroupName"] = body["audienceGroupName"] ?? null;
      if ("enabled" in body) patch["enabled"] = !!body["enabled"];
      if ("forwardType" in body) patch["forwardType"] = body["forwardType"];
      if ("stopOnMatch" in body) patch["stopOnMatch"] = !!body["stopOnMatch"];
      if ("webhookUrl" in body) {
        const url = (body["webhookUrl"] as string | null)?.trim();
        if (url) {
          const urlCheck = await isValidWebhookUrl(url);
          if (!urlCheck.ok)
            return reply.code(400).send({ error: urlCheck.reason });
          patch["webhookUrl"] = encryptSecret(url);
        } else {
          patch["webhookUrl"] = null;
        }
      }
      if ("webhookSecret" in body) {
        const secret = body["webhookSecret"] as string | null;
        if (secret === null || secret === "") {
          patch["webhookSecret"] = null;
          patch["webhookAuthMode"] = null;
        } else {
          patch["webhookSecret"] = encryptSecret(secret);
          patch["webhookAuthMode"] =
            (body["webhookAuthMode"] as BehaviorWebhookAuthMode) ?? "token";
        }
      } else if ("webhookAuthMode" in body) {
        const mode = body["webhookAuthMode"] as BehaviorWebhookAuthMode | null;
        const currentSecret = existingRow.webhookSecret;
        if (mode && !currentSecret) {
          return reply
            .code(400)
            .send({ error: "設定 webhookAuthMode 需要先設定 webhookSecret" });
        }
        patch["webhookAuthMode"] = mode ?? null;
      }
    }

    if (Object.keys(patch).length === 0) {
      return reply.send({ behavior: decryptedView(existingRow) });
    }

    await existing.update(patch);
    const updated = decryptedView(rowOfBehavior(existing));

    botEventLog.record(
      "info",
      "web",
      `behavior 已更新 id=${numId} source=${existingRow.source}`,
      {
        behaviorId: numId,
      },
    );

    return reply.send({ behavior: updated });
  });

  // ── DELETE /api/behaviors/:id ───────────────────────────────────────────────

  server.delete("/api/behaviors/:id", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return reply.code(400).send({ error: "無效的 behavior ID" });
    }

    const existing = await Behavior.findByPk(numId);
    if (!existing) {
      return reply.code(404).send({ error: "Behavior 不存在" });
    }

    const existingRow = rowOfBehavior(existing);
    if (existingRow.source === "system") {
      return reply.code(403).send({ error: "system behavior 不可刪除" });
    }

    await existing.destroy();

    botEventLog.record("info", "web", `behavior 已刪除 id=${numId}`, {
      behaviorId: numId,
    });

    return reply.code(204).send();
  });

  // ── POST /api/behaviors/:id/resync ──────────────────────────────────────────

  server.post("/api/behaviors/:id/resync", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return reply.code(400).send({ error: "無效的 behavior ID" });
    }

    const existing = await Behavior.findByPk(numId);
    if (!existing) {
      return reply.code(404).send({ error: "Behavior 不存在" });
    }

    const result = await getReconciler().reconcileForBehavior(numId);

    botEventLog.record(
      "info",
      "web",
      `behavior resync id=${numId} result=${result.ok ? "ok" : "fail"}`,
      {
        behaviorId: numId,
      },
    );

    return reply.send({ result });
  });

  // ── GET /api/behaviors（別名：排序用，回傳 audienceKind 分組）───────────────
  // 用於 sidebar 取得 audience 列表（distinct audienceKind + user/group 聚合）

  server.get("/api/behaviors/audience-summary", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    // Use GROUP BY so the backend returns one row per distinct audience
    // instead of one row per behavior — avoids transferring large tables
    // when there are many behaviors per audience.
    const rows = await Behavior.findAll({
      attributes: [
        "audienceKind",
        "audienceUserId",
        "audienceGroupName",
        [fn("COUNT", col("id")), "behaviorCount"],
      ],
      group: ["audienceKind", "audienceUserId", "audienceGroupName"],
      order: [
        ["audienceKind", "ASC"],
        ["audienceUserId", "ASC"],
        ["audienceGroupName", "ASC"],
      ],
      raw: true,
    });

    const summary = (
      rows as unknown as Array<{
        audienceKind: string;
        audienceUserId: string | null;
        audienceGroupName: string | null;
        behaviorCount: string | number;
      }>
    ).map((r) => ({
      audienceKind: r.audienceKind,
      audienceUserId: r.audienceUserId ?? null,
      audienceGroupName: r.audienceGroupName ?? null,
      behaviorCount: Number(r.behaviorCount),
    }));

    return reply.send({ summary });
  });

  // ── DELETE /api/behaviors/bulk-by-audience ──────────────────────────────────
  // Atomically delete all behaviors for a given audience in one transaction.
  // Query params: audienceKind (required) + audienceUserId | audienceGroupName.

  server.delete("/api/behaviors/bulk-by-audience", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const query = request.query as {
      audienceKind?: string;
      audienceUserId?: string;
      audienceGroupName?: string;
    };

    if (
      !query.audienceKind ||
      !["all", "user", "group"].includes(query.audienceKind)
    ) {
      return reply
        .code(400)
        .send({ error: "audienceKind 為必填 (all | user | group)" });
    }
    if (query.audienceKind === "user" && !query.audienceUserId) {
      return reply
        .code(400)
        .send({ error: "audienceKind=user 需要 audienceUserId" });
    }
    if (query.audienceKind === "group" && !query.audienceGroupName) {
      return reply
        .code(400)
        .send({ error: "audienceKind=group 需要 audienceGroupName" });
    }

    const where: Record<string, unknown> = { audienceKind: query.audienceKind };
    if (query.audienceKind === "user")
      where["audienceUserId"] = query.audienceUserId;
    if (query.audienceKind === "group")
      where["audienceGroupName"] = query.audienceGroupName;

    // system behaviors cannot be deleted — exclude them from the bulk delete.
    where["source"] = { [Op.ne]: "system" };

    const deleted = await Behavior.destroy({ where });

    botEventLog.record(
      "info",
      "web",
      `bulk delete audience behaviors: kind=${query.audienceKind} count=${deleted}`,
      {},
    );

    return reply.send({ deleted });
  });

  // ── PATCH /api/behaviors/reorder ────────────────────────────────────────────
  // 接受 orderedIds: number[]，只針對 source=custom 的排序

  server.patch("/api/behaviors/reorder", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const body = request.body as { orderedIds?: number[] };
    if (!Array.isArray(body.orderedIds)) {
      return reply.code(400).send({ error: "orderedIds 為必填陣列" });
    }

    await Promise.all(
      body.orderedIds.map((id, index) =>
        Behavior.update(
          { sortOrder: index },
          { where: { id, source: "custom" } },
        ),
      ),
    );

    return reply.send({ ok: true });
  });
}
