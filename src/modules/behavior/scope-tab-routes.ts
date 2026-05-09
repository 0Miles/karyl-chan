/**
 * scope-tab-routes.ts — CRUD for behavior_scope_tabs
 *
 * Routes:
 *   GET    /api/behavior-tabs           — list all tabs
 *   POST   /api/behavior-tabs           — create dynamic tab
 *   PATCH  /api/behavior-tabs/:id       — update tab label/sortOrder
 *   DELETE /api/behavior-tabs/:id       — delete dynamic tab + its behaviors
 *
 * Fixed tabs (isFixed=true) cannot be deleted or have their type changed.
 * Creating/deleting tabs requires behavior.manage or admin.
 */

import type { FastifyInstance } from "fastify";
import { Op } from "sequelize";
import { sequelize } from "../../db.js";
import { requireBehaviorAdmin } from "./behavior-helpers.js";
import {
  BehaviorScopeTab,
  FIXED_TAB_IDS,
  rowOf,
  scopeKeyOf,
  type ScopeTabType,
  type BehaviorScopeTabRow,
} from "./models/behavior-scope-tab.model.js";
import { Behavior } from "./models/behavior.model.js";
import { botEventLog } from "../bot-events/bot-event-log.js";

const VALID_TAB_TYPES: ScopeTabType[] = [
  "global_all",
  "all_dms",
  "all_bot_dms",
  "all_guilds",
  "specific_guild",
  "specific_channel",
  "specific_user",
  "specific_group",
];

const DYNAMIC_TAB_TYPES: ScopeTabType[] = [
  "specific_guild",
  "specific_channel",
  "specific_user",
  "specific_group",
];

export async function registerScopeTabRoutes(
  server: FastifyInstance,
): Promise<void> {
  // ── GET /api/behavior-tabs ─────────────────────────────────────────────────

  server.get("/api/behavior-tabs", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const rows = await BehaviorScopeTab.findAll({
      order: [
        ["isFixed", "DESC"],
        ["sortOrder", "ASC"],
        ["id", "ASC"],
      ],
    });

    const tabs: BehaviorScopeTabRow[] = rows.map(rowOf);

    // Attach behavior count per tab
    const counts = (await Behavior.findAll({
      attributes: [
        "scopeTabId",
        [Behavior.sequelize!.fn("COUNT", Behavior.sequelize!.col("id")), "cnt"],
      ],
      group: ["scopeTabId"],
      raw: true,
    })) as unknown as Array<{ scopeTabId: number; cnt: string | number }>;

    const countMap = new Map(counts.map((c) => [c.scopeTabId, Number(c.cnt)]));
    const tabsWithCount = tabs.map((t) => ({
      ...t,
      scopeKey: scopeKeyOf(t),
      behaviorCount: countMap.get(t.id) ?? 0,
    }));

    return reply.send({ tabs: tabsWithCount });
  });

  // ── POST /api/behavior-tabs ────────────────────────────────────────────────

  server.post("/api/behavior-tabs", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const body = request.body as {
      tabType?: string;
      label?: string;
      guildId?: string;
      channelId?: string;
      userId?: string;
      groupName?: string;
    };

    if (
      !body.tabType ||
      !DYNAMIC_TAB_TYPES.includes(body.tabType as ScopeTabType)
    ) {
      return reply.code(400).send({
        error: `tabType 必須為: ${DYNAMIC_TAB_TYPES.join(", ")}`,
      });
    }

    const tabType = body.tabType as ScopeTabType;

    // Validate required fields per tab type
    if (tabType === "specific_guild") {
      if (!body.guildId?.trim()) {
        return reply.code(400).send({ error: "specific_guild 需要 guildId" });
      }
    } else if (tabType === "specific_channel") {
      if (!body.guildId?.trim() || !body.channelId?.trim()) {
        return reply
          .code(400)
          .send({ error: "specific_channel 需要 guildId 和 channelId" });
      }
    } else if (tabType === "specific_user") {
      if (!body.userId?.trim()) {
        return reply.code(400).send({ error: "specific_user 需要 userId" });
      }
    } else if (tabType === "specific_group") {
      if (!body.groupName?.trim()) {
        return reply.code(400).send({ error: "specific_group 需要 groupName" });
      }
    }

    // Check for duplicates
    const where: Record<string, unknown> = { tabType };
    if (tabType === "specific_guild") where["guildId"] = body.guildId!.trim();
    if (tabType === "specific_channel") {
      where["guildId"] = body.guildId!.trim();
      where["channelId"] = body.channelId!.trim();
    }
    if (tabType === "specific_user") where["userId"] = body.userId!.trim();
    if (tabType === "specific_group")
      where["groupName"] = body.groupName!.trim();

    const existing = await BehaviorScopeTab.findOne({ where });
    if (existing) {
      return reply
        .code(409)
        .send({ error: "此分頁已存在", tab: rowOf(existing) });
    }

    // Max sort order among dynamic tabs
    const maxSort = await BehaviorScopeTab.findOne({
      where: { isFixed: false },
      order: [["sortOrder", "DESC"]],
      attributes: ["sortOrder"],
    });
    const nextSort = maxSort
      ? (maxSort.getDataValue("sortOrder") as number) + 1
      : 100;

    const row = await BehaviorScopeTab.create({
      tabType,
      label: body.label?.trim() || "",
      isFixed: false,
      guildId:
        tabType === "specific_guild" || tabType === "specific_channel"
          ? body.guildId!.trim()
          : null,
      channelId: tabType === "specific_channel" ? body.channelId!.trim() : null,
      userId: tabType === "specific_user" ? body.userId!.trim() : null,
      groupName: tabType === "specific_group" ? body.groupName!.trim() : null,
      sortOrder: nextSort,
    });

    const created = rowOf(row);

    botEventLog.record(
      "info",
      "web",
      `scope tab created id=${created.id} type=${created.tabType}`,
      { tabId: created.id },
    );

    return reply
      .code(201)
      .send({
        tab: { ...created, scopeKey: scopeKeyOf(created), behaviorCount: 0 },
      });
  });

  // ── PATCH /api/behavior-tabs/:id ───────────────────────────────────────────

  server.patch("/api/behavior-tabs/:id", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return reply.code(400).send({ error: "無效的 tab ID" });
    }

    const existing = await BehaviorScopeTab.findByPk(numId);
    if (!existing) {
      return reply.code(404).send({ error: "Tab 不存在" });
    }

    const body = request.body as { label?: string; sortOrder?: number };
    const patch: Record<string, unknown> = {};

    if ("label" in body) {
      if (rowOf(existing).isFixed) {
        return reply.code(400).send({ error: "固定分頁的標籤不可修改" });
      }
      patch["label"] = body.label?.trim() ?? "";
    }
    if ("sortOrder" in body) {
      if (
        typeof body.sortOrder !== "number" ||
        !Number.isFinite(body.sortOrder)
      ) {
        return reply.code(400).send({ error: "sortOrder 必須為有效數字" });
      }
      patch["sortOrder"] = body.sortOrder;
    }

    if (Object.keys(patch).length === 0) {
      return reply.send({ tab: rowOf(existing) });
    }

    await existing.update(patch);
    return reply.send({ tab: rowOf(existing) });
  });

  // ── DELETE /api/behavior-tabs/:id ──────────────────────────────────────────

  server.delete("/api/behavior-tabs/:id", async (request, reply) => {
    if (!requireBehaviorAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return reply.code(400).send({ error: "無效的 tab ID" });
    }

    const existing = await BehaviorScopeTab.findByPk(numId);
    if (!existing) {
      return reply.code(404).send({ error: "Tab 不存在" });
    }

    if (rowOf(existing).isFixed) {
      return reply.code(403).send({ error: "固定分頁不可刪除" });
    }

    const result = await sequelize.transaction(async (t) => {
      // Reassign system behaviors to global_all before deleting the tab
      await Behavior.update(
        { scopeTabId: FIXED_TAB_IDS.global_all },
        { where: { scopeTabId: numId, source: "system" }, transaction: t },
      );
      const deleted = await Behavior.destroy({
        where: { scopeTabId: numId, source: { [Op.ne]: "system" } },
        transaction: t,
      });
      await existing.destroy({ transaction: t });
      return deleted;
    });

    botEventLog.record(
      "info",
      "web",
      `scope tab deleted id=${numId}, ${result} behavior(s) removed`,
      { tabId: numId, behaviorsDeleted: result },
    );

    return reply.send({ deleted: result });
  });
}
