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
  type BehaviorRow,
  type BehaviorSource,
  type BehaviorTriggerType,
  type BehaviorAudienceKind,
  type BehaviorWebhookAuthMode,
} from "./models/behavior.model.js";
import { Op } from "sequelize";
import { encryptSecret } from "../../utils/crypto.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { CommandReconciler } from "../command-system/reconcile.service.js";

export type { BehaviorRoutesOptions };

// ── 輔助：Sequelize model instance → BehaviorRow ──────────────────────────────

function rowOf(model: InstanceType<typeof Behavior>): BehaviorRow {
  return {
    id: model.getDataValue("id") as number,
    title: model.getDataValue("title") as string,
    description: (model.getDataValue("description") as string) ?? "",
    enabled: !!model.getDataValue("enabled"),
    sortOrder: model.getDataValue("sortOrder") as number,
    stopOnMatch: !!model.getDataValue("stopOnMatch"),
    forwardType: model.getDataValue(
      "forwardType",
    ) as BehaviorRow["forwardType"],
    source: model.getDataValue("source") as BehaviorRow["source"],
    triggerType: model.getDataValue(
      "triggerType",
    ) as BehaviorRow["triggerType"],
    messagePatternKind:
      (model.getDataValue(
        "messagePatternKind",
      ) as BehaviorRow["messagePatternKind"]) ?? null,
    messagePatternValue:
      (model.getDataValue("messagePatternValue") as string | null) ?? null,
    slashCommandName:
      (model.getDataValue("slashCommandName") as string | null) ?? null,
    slashCommandDescription:
      (model.getDataValue("slashCommandDescription") as string | null) ?? null,
    scope: model.getDataValue("scope") as BehaviorRow["scope"],
    integrationTypes: model.getDataValue("integrationTypes") as string,
    contexts: model.getDataValue("contexts") as string,
    placementGuildId:
      (model.getDataValue("placementGuildId") as string | null) ?? null,
    placementChannelId:
      (model.getDataValue("placementChannelId") as string | null) ?? null,
    audienceKind: model.getDataValue(
      "audienceKind",
    ) as BehaviorRow["audienceKind"],
    audienceUserId:
      (model.getDataValue("audienceUserId") as string | null) ?? null,
    audienceGroupName:
      (model.getDataValue("audienceGroupName") as string | null) ?? null,
    webhookUrl: (model.getDataValue("webhookUrl") as string | null) ?? null,
    webhookSecret:
      (model.getDataValue("webhookSecret") as string | null) ?? null,
    webhookAuthMode:
      (model.getDataValue(
        "webhookAuthMode",
      ) as BehaviorRow["webhookAuthMode"]) ?? null,
    pluginId: (model.getDataValue("pluginId") as number | null) ?? null,
    pluginBehaviorKey:
      (model.getDataValue("pluginBehaviorKey") as string | null) ?? null,
    systemKey:
      (model.getDataValue("systemKey") as BehaviorRow["systemKey"]) ?? null,
  };
}

// ── 主函式 ────────────────────────────────────────────────────────────────────

export async function registerBehaviorRoutes(
  server: FastifyInstance,
  options: BehaviorRoutesOptions = {},
): Promise<void> {
  // 用 lazy getter 取得 CommandReconciler（bot 可能在 route 建立後才 ready）
  let reconcilerInstance: CommandReconciler | null = null;
  function getReconciler(): CommandReconciler {
    if (!reconcilerInstance) {
      reconcilerInstance = new CommandReconciler(() => options.bot ?? null);
    }
    return reconcilerInstance;
  }

  // ── GET /api/behaviors ──────────────────────────────────────────────────────

  server.get("/api/behaviors", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const query = request.query as {
      audienceKind?: string;
      source?: string;
      triggerType?: string;
    };

    const where: Record<string, unknown> = {};
    if (
      query.audienceKind &&
      ["all", "user", "group"].includes(query.audienceKind)
    ) {
      where["audienceKind"] = query.audienceKind;
    }
    if (query.source && ["custom", "plugin", "system"].includes(query.source)) {
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

    const behaviors = rows.map((r) => decryptedView(rowOf(r)));
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

    return reply.send({ behavior: decryptedView(rowOf(row)) });
  });

  // ── POST /api/behaviors ─────────────────────────────────────────────────────
  // 只允許 source=custom 建立；plugin/system 不可由 admin 手動建立。

  server.post("/api/behaviors", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const body = request.body as {
      title?: string;
      description?: string;
      source?: BehaviorSource;
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
      // source=plugin
      pluginId?: number;
      pluginBehaviorKey?: string;
    };

    // 基本驗證
    if (!body.title?.trim()) {
      return reply.code(400).send({ error: "title 為必填" });
    }
    if (!body.source) {
      return reply.code(400).send({ error: "source 為必填" });
    }
    if (!["custom", "plugin"].includes(body.source)) {
      return reply
        .code(400)
        .send({ error: "只能建立 custom 或 plugin source 的 behavior" });
    }
    if (
      !body.triggerType ||
      !["slash_command", "message_pattern"].includes(body.triggerType)
    ) {
      return reply.code(400).send({ error: "無效的 triggerType" });
    }

    // source=custom 驗證
    if (body.source === "custom") {
      if (!body.webhookUrl?.trim()) {
        return reply.code(400).send({ error: "source=custom 需要 webhookUrl" });
      }
      const urlCheck = await isValidWebhookUrl(body.webhookUrl.trim());
      if (!urlCheck.ok) {
        return reply.code(400).send({ error: urlCheck.reason });
      }
    }

    // source=plugin 驗證
    if (body.source === "plugin") {
      if (!body.pluginId) {
        return reply.code(400).send({ error: "source=plugin 需要 pluginId" });
      }
      if (!body.pluginBehaviorKey?.trim()) {
        return reply
          .code(400)
          .send({ error: "source=plugin 需要 pluginBehaviorKey" });
      }
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

    // 三軸排序
    const integrationTypes = sortJoin(body.integrationTypes || "guild_install");
    const contexts = sortJoin(body.contexts || "Guild");

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
      source: body.source,
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
      scope: body.scope ?? "global",
      integrationTypes,
      contexts,
      audienceKind: body.audienceKind ?? "all",
      audienceUserId:
        body.audienceKind === "user" ? (body.audienceUserId ?? null) : null,
      audienceGroupName:
        body.audienceKind === "group" ? (body.audienceGroupName ?? null) : null,
      webhookUrl:
        body.source === "custom" && body.webhookUrl
          ? encryptSecret(body.webhookUrl.trim())
          : null,
      webhookSecret: body.webhookSecret
        ? encryptSecret(body.webhookSecret)
        : null,
      webhookAuthMode: body.webhookSecret
        ? (body.webhookAuthMode ?? "token")
        : null,
      pluginId: body.source === "plugin" ? (body.pluginId ?? null) : null,
      pluginBehaviorKey:
        body.source === "plugin" ? (body.pluginBehaviorKey ?? null) : null,
      systemKey: null,
      forwardType: body.forwardType ?? "one_time",
      stopOnMatch: !!body.stopOnMatch,
      enabled: body.enabled !== undefined ? !!body.enabled : true,
      sortOrder: nextSortOrder,
    });

    const created = decryptedView(rowOf(row));

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
  // plugin：三軸 + audience + enabled + webhookSecret/webhookAuthMode
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

    const existingRow = rowOf(existing);
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
    } else if (existingRow.source === "plugin") {
      // plugin：三軸 + audience + enabled + webhookSecret/webhookAuthMode
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
      } else if ("webhookAuthMode" in body && existingRow.webhookSecret) {
        patch["webhookAuthMode"] = body["webhookAuthMode"];
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
      if ("pluginId" in body) patch["pluginId"] = body["pluginId"] ?? null;
      if ("pluginBehaviorKey" in body)
        patch["pluginBehaviorKey"] = body["pluginBehaviorKey"] ?? null;
    }

    if (Object.keys(patch).length === 0) {
      return reply.send({ behavior: decryptedView(existingRow) });
    }

    await existing.update(patch);
    const updated = decryptedView(rowOf(existing));

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

    const existingRow = rowOf(existing);
    if (existingRow.source === "system") {
      return reply.code(403).send({ error: "system behavior 不可刪除" });
    }
    if (existingRow.source === "plugin") {
      return reply.code(403).send({
        error: "plugin behavior 由 plugin manifest 管理，不可由 admin 刪除",
      });
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

    // 取所有 behavior，前端自行分組
    const rows = await Behavior.findAll({
      order: [
        ["audienceKind", "ASC"],
        ["audienceUserId", "ASC"],
        ["audienceGroupName", "ASC"],
      ],
      attributes: [
        "id",
        "audienceKind",
        "audienceUserId",
        "audienceGroupName",
        "source",
        "enabled",
      ],
    });

    const summary = rows.map((r) => ({
      id: r.getDataValue("id") as number,
      audienceKind: r.getDataValue("audienceKind") as string,
      audienceUserId:
        (r.getDataValue("audienceUserId") as string | null) ?? null,
      audienceGroupName:
        (r.getDataValue("audienceGroupName") as string | null) ?? null,
      source: r.getDataValue("source") as string,
      enabled: !!r.getDataValue("enabled"),
    }));

    return reply.send({ summary });
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
