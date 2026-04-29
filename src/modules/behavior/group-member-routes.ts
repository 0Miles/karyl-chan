import type { FastifyInstance } from "fastify";
import { isSnowflake } from "../web-core/validators.js";
import { recordAudit } from "../admin/admin-audit.service.js";
import {
  findBehaviorTargetById,
} from "./models/behavior-target.model.js";
import {
  addGroupMember,
  findGroupMembers,
  removeGroupMember,
  replaceGroupMembers,
} from "./models/behavior-target-member.model.js";
import {
  type BehaviorRoutesOptions,
  fetchProfile,
  requireBehaviorAdmin,
  requireBehaviorTarget,
} from "./behavior-helpers.js";

export async function registerBehaviorGroupMemberRoutes(
  server: FastifyInstance,
  options: BehaviorRoutesOptions,
): Promise<void> {
  const { bot } = options;

  server.get<{ Params: { id: string } }>(
    "/api/behaviors/targets/:id/members",
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      // Reading group membership requires being able to manage that
      // target — scoped users can see who's in the group whose
      // behaviors they manage.
      if (!requireBehaviorTarget(request, reply, id)) return;
      const target = await findBehaviorTargetById(id);
      if (!target || target.kind !== "group") {
        reply.code(404).send({ error: "group target not found" });
        return;
      }
      const userIds = await findGroupMembers(id);
      const members = await Promise.all(
        userIds.map(async (uid) => ({
          userId: uid,
          profile: await fetchProfile(bot, uid),
        })),
      );
      return { members };
    },
  );

  server.post<{ Params: { id: string }; Body: { userId?: unknown } }>(
    "/api/behaviors/targets/:id/members",
    async (request, reply) => {
      // Adding members shifts who the group's behaviors apply to —
      // catalog-level, module admin only.
      if (!requireBehaviorAdmin(request, reply)) return;
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      const target = await findBehaviorTargetById(id);
      if (!target || target.kind !== "group") {
        reply.code(404).send({ error: "group target not found" });
        return;
      }
      const userId = request.body?.userId;
      if (!isSnowflake(userId)) {
        reply.code(400).send({ error: "userId must be a Discord snowflake" });
        return;
      }
      await addGroupMember(id, userId);
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.target.member.add",
        String(id),
        { userId },
      );
      return {
        ok: true,
        member: { userId, profile: await fetchProfile(bot, userId) },
      };
    },
  );

  server.delete<{ Params: { id: string; userId: string } }>(
    "/api/behaviors/targets/:id/members/:userId",
    async (request, reply) => {
      if (!requireBehaviorAdmin(request, reply)) return;
      const id = Number(request.params.id);
      const userId = request.params.userId;
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      if (!isSnowflake(userId)) {
        reply.code(400).send({ error: "invalid user id" });
        return;
      }
      const target = await findBehaviorTargetById(id);
      if (!target || target.kind !== "group") {
        reply.code(404).send({ error: "group target not found" });
        return;
      }
      await removeGroupMember(id, userId);
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.target.member.remove",
        String(id),
        { userId },
      );
      return { ok: true };
    },
  );

  server.put<{ Params: { id: string }; Body: { userIds?: unknown } }>(
    "/api/behaviors/targets/:id/members",
    async (request, reply) => {
      if (!requireBehaviorAdmin(request, reply)) return;
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      const target = await findBehaviorTargetById(id);
      if (!target || target.kind !== "group") {
        reply.code(404).send({ error: "group target not found" });
        return;
      }
      const userIds = request.body?.userIds;
      if (!Array.isArray(userIds) || userIds.some((u) => !isSnowflake(u))) {
        reply
          .code(400)
          .send({ error: "userIds must be array of Discord snowflakes" });
        return;
      }
      await replaceGroupMembers(id, userIds as string[]);
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.target.member.replace",
        String(id),
        {
          count: userIds.length,
        },
      );
      return { ok: true };
    },
  );
}
