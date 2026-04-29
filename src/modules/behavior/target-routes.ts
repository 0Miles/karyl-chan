import type { FastifyInstance, FastifyReply } from "fastify";
import {
  isBoundedString,
  isSnowflake,
} from "../web-core/validators.js";
import { recordAudit } from "../admin/admin-audit.service.js";
import {
  accessibleBehaviorTargetIds,
  type AdminCapability,
} from "../admin/admin-capabilities.js";
import {
  ALL_DMS_TARGET_ID,
  createGroupTarget,
  createUserTarget,
  deleteBehaviorTarget,
  findAllBehaviorTargets,
  findBehaviorTargetById,
  findGroupTargetByName,
  findUserTarget,
  renameGroupTarget,
} from "./models/behavior-target.model.js";
import { findGroupMembers } from "./models/behavior-target-member.model.js";
import {
  type BehaviorRoutesOptions,
  fetchProfile,
  requireBehaviorAdmin,
  visibleTargetFilter,
} from "./behavior-helpers.js";

const GROUP_NAME_MAX = 80;

export async function registerBehaviorTargetRoutes(
  server: FastifyInstance,
  options: BehaviorRoutesOptions,
): Promise<void> {
  const { bot } = options;

  server.get("/api/behaviors/targets", async (request, reply) => {
    // Every authorised behavior user (full admin OR scoped) reaches
    // this endpoint; the response is filtered to only the targets
    // their capabilities resolve to. Reject early if they hold no
    // behavior-related token at all so the page-load doesn't waste a
    // round-trip.
    const caps = request.authCapabilities as Set<AdminCapability> | undefined;
    const access = accessibleBehaviorTargetIds(
      caps ?? new Set<AdminCapability>(),
    );
    if (access !== "all" && access.size === 0) {
      reply.code(403).send({ error: "behavior.manage capability required" });
      return;
    }
    const allowed = visibleTargetFilter(request);
    const targets = (await findAllBehaviorTargets()).filter((t) =>
      allowed(t.id),
    );
    // Embed user profile for kind='user' rows so the sidebar can
    // render avatar + display name without a second round-trip per
    // entry (mirrors how DM channel summaries embed recipient).
    const enriched = await Promise.all(
      targets.map(async (t) => {
        if (t.kind !== "user" || !t.userId) {
          return { ...t, profile: null as Awaited<ReturnType<typeof fetchProfile>> };
        }
        return { ...t, profile: await fetchProfile(bot, t.userId) };
      }),
    );
    // Group-member counts for kind='group' rows so the sidebar can
    // show "Group X (N members)" without N+1 queries.
    const memberCounts = new Map<number, number>();
    for (const t of enriched) {
      if (t.kind === "group") {
        const members = await findGroupMembers(t.id);
        memberCounts.set(t.id, members.length);
      }
    }
    return {
      targets: enriched.map((t) => ({
        id: t.id,
        kind: t.kind,
        userId: t.userId,
        groupName: t.groupName,
        profile: t.profile,
        memberCount: t.kind === "group" ? (memberCounts.get(t.id) ?? 0) : null,
      })),
    };
  });

  server.post<{
    Body: { kind?: unknown; userId?: unknown; groupName?: unknown };
  }>("/api/behaviors/targets", async (request, reply) => {
    // Catalog mutation — module admin only. Scoped users can manage
    // behaviors under existing targets but not add new ones.
    if (!requireBehaviorAdmin(request, reply)) return;
    const kind = request.body?.kind;
    if (kind !== "user" && kind !== "group") {
      reply.code(400).send({ error: 'kind must be "user" or "group"' });
      return;
    }
    if (kind === "user") {
      const userId = request.body?.userId;
      if (!isSnowflake(userId)) {
        reply.code(400).send({ error: "userId must be a Discord snowflake" });
        return;
      }
      const existing = await findUserTarget(userId);
      if (existing) {
        reply
          .code(409)
          .send({ error: "target already exists", target: existing });
        return;
      }
      const created = await createUserTarget(userId);
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.target.create",
        String(created.id),
        {
          kind,
          userId,
        },
      );
      return { target: created };
    }
    const groupName = request.body?.groupName;
    if (!isBoundedString(groupName, GROUP_NAME_MAX)) {
      reply
        .code(400)
        .send({ error: `groupName required (max ${GROUP_NAME_MAX} chars)` });
      return;
    }
    const trimmed = groupName.trim();
    const dup = await findGroupTargetByName(trimmed);
    if (dup) {
      reply
        .code(409)
        .send({ error: "group with that name already exists", target: dup });
      return;
    }
    const created = await createGroupTarget(trimmed);
    await recordAudit(
      request.authUserId ?? "unknown",
      "behavior.target.create",
      String(created.id),
      {
        kind,
        groupName: trimmed,
      },
    );
    return { target: created };
  });

  server.patch<{ Params: { id: string }; Body: { groupName?: unknown } }>(
    "/api/behaviors/targets/:id",
    async (request, reply) => {
      // Renaming a group is catalog-level (the name is what scoped
      // grants reference indirectly via the id, but it's still the
      // visible identity of the target) — module admin only.
      if (!requireBehaviorAdmin(request, reply)) return;
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      const target = await findBehaviorTargetById(id);
      if (!target) {
        reply.code(404).send({ error: "target not found" });
        return;
      }
      if (target.kind !== "group") {
        reply.code(400).send({ error: "only group targets are renameable" });
        return;
      }
      const groupName = request.body?.groupName;
      if (!isBoundedString(groupName, GROUP_NAME_MAX)) {
        reply
          .code(400)
          .send({ error: `groupName required (max ${GROUP_NAME_MAX} chars)` });
        return;
      }
      const trimmed = groupName.trim();
      const dup = await findGroupTargetByName(trimmed);
      if (dup && dup.id !== id) {
        reply.code(409).send({ error: "group with that name already exists" });
        return;
      }
      await renameGroupTarget(id, trimmed);
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.target.rename",
        String(id),
        {
          groupName: trimmed,
        },
      );
      return { target: { ...target, groupName: trimmed } };
    },
  );

  server.delete<{ Params: { id: string } }>(
    "/api/behaviors/targets/:id",
    async (request, reply: FastifyReply) => {
      // Deleting a target wipes its behaviors AND its scoped grants —
      // module admin only.
      if (!requireBehaviorAdmin(request, reply)) return;
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      if (id === ALL_DMS_TARGET_ID) {
        reply.code(400).send({ error: "all_dms target is not deletable" });
        return;
      }
      const target = await findBehaviorTargetById(id);
      if (!target) {
        reply.code(404).send({ error: "target not found" });
        return;
      }
      await deleteBehaviorTarget(id);
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.target.delete",
        String(id),
        {
          kind: target.kind,
          userId: target.userId,
          groupName: target.groupName,
        },
      );
      return { ok: true };
    },
  );
}
