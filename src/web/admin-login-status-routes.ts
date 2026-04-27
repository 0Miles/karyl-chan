import type { FastifyInstance } from "fastify";
import { fn, col, Op } from "sequelize";
import { RefreshToken } from "../models/refresh-token.model.js";
import { listAuthorizedUsers } from "./authorized-user.service.js";
import { requireCapability } from "./route-guards.js";
import type { FastifyReply, FastifyRequest } from "fastify";

const requireAdmin = (request: FastifyRequest, reply: FastifyReply): boolean =>
  requireCapability(request, reply, "admin");

function readOwnerId(): string | null {
  return process.env.BOT_OWNER_ID?.trim() || null;
}

interface AdminLoginStatusEntry {
  userId: string;
  role: string;
  note: string | null;
  lastLoginAt: string | null;
  hasActiveSession: boolean;
  isOwner: boolean;
}

/**
 * Two aggregate queries cover all admins in a single round-trip each:
 *   1. MAX(createdAt) GROUP BY ownerId  → lastLoginAt per user
 *   2. MAX(expiresAt) GROUP BY ownerId  → compare with now to get hasActiveSession
 *
 * Both queries run in parallel via Promise.all, then results are joined
 * in JS. This keeps DB pressure O(1) regardless of admin count.
 */
async function fetchTokenAggregates(now: number): Promise<{
  lastLoginAtMap: Map<string, string>;
  hasActiveSessionSet: Set<string>;
}> {
  const [lastLoginRows, maxExpiresRows] = await Promise.all([
    RefreshToken.findAll({
      attributes: ["ownerId", [fn("MAX", col("createdAt")), "lastLoginAt"]],
      group: ["ownerId"],
      raw: true,
    }),
    RefreshToken.findAll({
      attributes: ["ownerId", [fn("MAX", col("expiresAt")), "maxExpiresAt"]],
      where: { expiresAt: { [Op.gt]: now } },
      group: ["ownerId"],
      raw: true,
    }),
  ]);

  const lastLoginAtMap = new Map<string, string>();
  for (const row of lastLoginRows as unknown as Array<{
    ownerId: string;
    lastLoginAt: string | null;
  }>) {
    if (row.lastLoginAt !== null) {
      // SQLite stores timestamps as strings; wrap in Date to normalise to ISO.
      const parsed = new Date(row.lastLoginAt);
      if (!isNaN(parsed.getTime())) {
        lastLoginAtMap.set(row.ownerId, parsed.toISOString());
      }
    }
  }

  const hasActiveSessionSet = new Set<string>();
  for (const row of maxExpiresRows as unknown as Array<{ ownerId: string }>) {
    hasActiveSessionSet.add(row.ownerId);
  }

  return { lastLoginAtMap, hasActiveSessionSet };
}

export async function registerAdminLoginStatusRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.get("/api/admin/login-status", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    try {
      const now = Date.now();
      const [users, { lastLoginAtMap, hasActiveSessionSet }] =
        await Promise.all([listAuthorizedUsers(), fetchTokenAggregates(now)]);

      const ownerId = readOwnerId();

      // Build the full list: owner entry (synthetic or folded) + authorized users.
      // Owner pinned first. If owner is also in authorized_users, fold
      // isOwner:true into that entry instead of duping.
      const ownerInTable = ownerId
        ? users.some((u) => u.userId === ownerId)
        : false;
      const admins: AdminLoginStatusEntry[] = [];

      if (ownerId && !ownerInTable) {
        admins.push({
          userId: ownerId,
          role: "owner",
          note: null,
          lastLoginAt: lastLoginAtMap.get(ownerId) ?? null,
          hasActiveSession: hasActiveSessionSet.has(ownerId),
          isOwner: true,
        });
      }

      for (const user of users) {
        admins.push({
          userId: user.userId,
          role: user.role,
          note: user.note,
          lastLoginAt: lastLoginAtMap.get(user.userId) ?? null,
          hasActiveSession: hasActiveSessionSet.has(user.userId),
          isOwner: ownerId !== null && user.userId === ownerId,
        });
      }

      // Sort: owner pinned first, then by role, then by userId for stability.
      admins.sort(
        (a, b) =>
          Number(b.isOwner) - Number(a.isOwner) ||
          a.role.localeCompare(b.role, "en-US") ||
          a.userId.localeCompare(b.userId, "en-US"),
      );

      return { admins };
    } catch (err) {
      request.log.error({ err }, "admin.login-status query failed");
      reply.code(500).send({ error: "Failed to retrieve login status" });
    }
  });
}
