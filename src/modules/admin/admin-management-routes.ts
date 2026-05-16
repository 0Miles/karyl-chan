import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Client } from "discord.js";
import { config } from "../../config.js";
import {
  addAuthorizedUser,
  GLOBAL_CAPABILITY_DESCRIPTIONS,
  GLOBAL_CAPABILITY_KEYS,
  createAdminRole,
  deleteAdminRole,
  findAuthorizedUser,
  grantRoleCapability,
  isAdminCapability,
  listAdminRoles,
  listAuthorizedUsers,
  removeAuthorizedUser,
  revokeRoleCapability,
  type AuthorizedUserRecord,
  type AdminCapability,
  type GlobalCapability,
} from "./authorized-user.service.js";
import { makePluginCapabilityToken } from "./admin-capabilities.js";
import { findAllPlugins } from "../plugin-system/models/plugin.model.js";
import { findAllCapabilities } from "../plugin-system/models/plugin-capability.model.js";
import { listAudit, recordAudit } from "./admin-audit.service.js";
import { avatarUrlFor } from "../web-core/message-mapper.js";
import { requireCapability } from "../web-core/route-guards.js";
import {
  isBoundedString,
  isNonEmptyString,
  isSnowflake,
  ROLE_DESCRIPTION_MAX,
  USER_NOTE_MAX,
} from "../web-core/validators.js";
import { getBuiltinFeatureStats } from "../builtin-features/guild-builtin.service.js";
import { AuthorizedUser } from "./models/authorized-user.model.js";
import { AdminRole } from "./models/admin-role.model.js";

export interface AdminManagementRoutesOptions {
  bot?: Client;
  /** Override owner ids for tests; production uses ownerIds. */
  ownerIds?: string[];
}

interface UserProfile {
  username: string;
  globalName: string | null;
  avatarUrl: string;
}

interface AdminUserView extends AuthorizedUserRecord {
  isOwner: boolean;
  profile: UserProfile | null;
}

// Small in-memory cache around bot.users.fetch — avatars and display
// names don't change often and the admin panel re-hits /api/admin/users
// + /api/admin/me on every refresh. Discord.js has its own user cache,
// but it's unbounded and not TTL'd; this keeps our view coherent.
const PROFILE_CACHE_TTL_MS = config.admin.profileCacheTtlMs;
const profileCache = new Map<
  string,
  { profile: UserProfile | null; expiresAt: number }
>();

async function fetchProfile(
  bot: Client | undefined,
  userId: string,
  now: number = Date.now(),
): Promise<UserProfile | null> {
  if (!bot) return null;
  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.profile;
  try {
    const user = await bot.users.fetch(userId);
    const profile: UserProfile = {
      username: user.username,
      globalName: user.globalName ?? null,
      avatarUrl: avatarUrlFor(user.id, user.avatar),
    };
    profileCache.set(userId, {
      profile,
      expiresAt: now + PROFILE_CACHE_TTL_MS,
    });
    return profile;
  } catch {
    // Unknown / deleted / not cacheable — cache the null too so we don't
    // hammer Discord for a user that never resolves.
    profileCache.set(userId, {
      profile: null,
      expiresAt: now + PROFILE_CACHE_TTL_MS,
    });
    return null;
  }
}

const requireAdmin = (request: FastifyRequest, reply: FastifyReply): boolean =>
  requireCapability(request, reply, "admin");

/**
 * Admin-only management surface for non-owner access: CRUD on the
 * authorized_users allow-list, admin_roles definitions, and the
 * role→capability mapping. Every route is gated behind the `admin`
 * capability so only a user whose role carries it (or the bot owner)
 * can reach them.
 */
export async function registerAdminManagementRoutes(
  server: FastifyInstance,
  options: AdminManagementRoutesOptions = {},
): Promise<void> {
  const { bot } = options;
  const ownerIds = options.ownerIds ?? config.bot.ownerIds;
  // Current session's identity + computed capability set. Used by the
  // frontend to render the avatar button, the profile page, and to gate
  // capability-aware UI elements without re-walking authorized_users on
  // every call.
  server.get("/api/admin/me", async (request, reply) => {
    // This route is authenticated by the onRequest hook; if we're here
    // the caller already has at least one capability. authUserId is set
    // by that hook.
    if (!request.authUserId) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    const isOwner = ownerIds.includes(request.authUserId);
    const row = isOwner ? null : await findAuthorizedUser(request.authUserId);
    const profile = await fetchProfile(bot, request.authUserId);
    return {
      userId: request.authUserId,
      isOwner,
      role: isOwner ? "owner" : (row?.role ?? null),
      note: row?.note ?? null,
      profile,
      capabilities: [...(request.authCapabilities ?? new Set())],
    };
  });

  // ── Users ────────────────────────────────────────────────────────────
  //
  // Returns the bot owner as a pinned, synthetic entry (role: 'owner',
  // isOwner: true) followed by the actual authorized_users rows in the
  // order the service produced them. Every entry is hydrated with the
  // Discord profile (avatar + display name) when the client is available;
  // profile is null if the fetch failed or the bot client is absent.
  server.get("/api/admin/users", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const rows = await listAuthorizedUsers();
    
    const ownerIdSet = new Set(ownerIds);
    const rowUserIds = new Set(rows.map((r) => r.userId));

    // Every profile fetch (owners included) runs concurrently.
    const profileJobs = new Map<string, Promise<UserProfile | null>>();
    for (const oid of ownerIds) {
      profileJobs.set(oid, fetchProfile(bot, oid));
    }
    for (const row of rows) {
      if (ownerIdSet.has(row.userId)) continue; // deduped below
      profileJobs.set(row.userId, fetchProfile(bot, row.userId));
    }
    await Promise.all(profileJobs.values());

    const hydrated: AdminUserView[] = [];
    // Synthetic entries for owners not already in authorized_users
    for (const oid of ownerIds) {
      if (!rowUserIds.has(oid)) {
        hydrated.push({
          userId: oid,
          role: "owner",
          note: null,
          isOwner: true,
          profile: (await profileJobs.get(oid)) ?? null,
        });
      }
    }
    for (const row of rows) {
      // Defensive: if an owner somehow lives in authorized_users, fold
      // isOwner:true in instead of surfacing a duplicate synthetic entry.
      hydrated.push({
        ...row,
        isOwner: ownerIdSet.has(row.userId),
        profile: (await profileJobs.get(row.userId)) ?? null,
      });
    }

    return { ownerIds, users: hydrated };
  });

  server.post<{ Body: { userId?: unknown; role?: unknown; note?: unknown } }>(
    "/api/admin/users",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = request.body ?? {};
      if (!isSnowflake(body.userId)) {
        reply.code(400).send({ error: "userId must be a Discord snowflake" });
        return;
      }
      if (!isNonEmptyString(body.role)) {
        reply.code(400).send({ error: "role is required" });
        return;
      }
      if (
        body.note !== undefined &&
        body.note !== null &&
        !isBoundedString(body.note, USER_NOTE_MAX)
      ) {
        reply.code(400).send({ error: `note must be ≤${USER_NOTE_MAX} chars` });
        return;
      }
      // Block setting an allow-list row for any owner — owners are
      // always implicitly admin, and a stale row would mislead.
      // Generic error message to avoid telling a (possibly stolen)
      // admin token whether a given userId is an owner.
      
      if (ownerIds.includes(body.userId as string)) {
        reply.code(400).send({ error: "userId not allowed" });
        return;
      }
      const roles = await listAdminRoles();
      const targetRole = roles.find((r) => r.name === body.role);
      if (!targetRole) {
        // Don't echo the role name back — keeps error logs from
        // accumulating arbitrary user input and avoids confirming
        // existence of nearby valid role names via differential
        // error messages.
        reply.code(400).send({ error: "unknown role" });
        return;
      }
      // Self-lockout guard: moving yourself to a role without the
      // `admin` capability would make this the last request you could
      // make. Owners are exempt via the ownerIds bypass.
      if (
        request.authUserId &&
        body.userId === request.authUserId &&
        !ownerIds.includes(request.authUserId) &&
        !targetRole.capabilities.includes("admin")
      ) {
        reply.code(400).send({
          error: "cannot move yourself to a role without the admin capability",
        });
        return;
      }
      const note = isNonEmptyString(body.note) ? body.note : null;
      const existing = await findAuthorizedUser(body.userId);
      const record = await addAuthorizedUser(body.userId, body.role, note);
      await recordAudit(
        request.authUserId!,
        existing ? "user.update" : "user.create",
        body.userId,
        {
          role: body.role,
          previousRole: existing?.role ?? null,
          note,
        },
      );
      return record;
    },
  );

  server.delete<{ Params: { userId: string } }>(
    "/api/admin/users/:userId",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      if (!isSnowflake(request.params.userId)) {
        reply.code(400).send({ error: "userId must be a Discord snowflake" });
        return;
      }
      // Self-lockout guard: deleting your own allow-list row severs access
      // the moment the capability cache expires. Owners are exempt.
      if (
        request.authUserId === request.params.userId &&
        !ownerIds.includes(request.authUserId ?? "")
      ) {
        reply
          .code(400)
          .send({ error: "cannot remove yourself from the allow list" });
        return;
      }
      const removed = await removeAuthorizedUser(request.params.userId);
      if (!removed) {
        reply.code(404).send({ error: "user not in allow list" });
        return;
      }
      await recordAudit(
        request.authUserId!,
        "user.delete",
        request.params.userId,
      );
      reply.code(204).send();
    },
  );

  // ── Capability catalog ───────────────────────────────────────────────
  // Returns the canonical list of capability tokens the server
  // recognises so the UI doesn't have to ship a hard-coded mirror that
  // drifts on every server-side addition. The UI is still responsible
  // for the human-readable label (i18n by key); this response just
  // pins the set of valid keys plus a fallback description.
  server.get("/api/admin/capabilities", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    // Per-guild scoped tokens (`guild:<id>.message`/`.manage`) are
    // generated on the client per-guild — they're not enumerable
    // here without listing every guild the bot is in. This catalog
    // returns just the global tokens; the UI composes scoped ones
    // separately from the bot's guild list.
    const capabilities = GLOBAL_CAPABILITY_KEYS.map(
      (key: GlobalCapability) => ({
        key,
        description: GLOBAL_CAPABILITY_DESCRIPTIONS[key],
      }),
    );
    return { capabilities };
  });

  // ── Plugin capability catalog ────────────────────────────────────────
  // Dynamic catalog: the RBAC capabilities each currently-enabled plugin
  // declared in its manifest. The role-permission modal renders one tab
  // per plugin from this. Token form: `plugin:<pluginKey>:<capKey>`.
  // Mirrors the behavior-scope-tabs pattern (a runtime catalog feeding a
  // capability tab) — see GET /api/behavior-tabs.
  server.get("/api/admin/plugin-capabilities", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const plugins = await findAllPlugins();
    const caps = await findAllCapabilities();
    const byId = new Map(plugins.map((p) => [p.id, p]));
    const grouped = new Map<
      number,
      {
        pluginKey: string;
        pluginName: string;
        capabilities: Array<{ token: string; key: string; description: string }>;
      }
    >();
    for (const c of caps) {
      const plugin = byId.get(c.pluginId);
      // Only surface capabilities for plugins that are enabled (the
      // admin on/off toggle). Disabled / orphaned rows stay hidden but
      // are NOT auto-purged — re-enabling restores the tab as-is.
      if (!plugin || !plugin.enabled) continue;
      let entry = grouped.get(c.pluginId);
      if (!entry) {
        entry = {
          pluginKey: plugin.pluginKey,
          pluginName: plugin.name,
          capabilities: [],
        };
        grouped.set(c.pluginId, entry);
      }
      entry.capabilities.push({
        token: makePluginCapabilityToken(plugin.pluginKey, c.capKey),
        key: c.capKey,
        description: c.description,
      });
    }
    const result = [...grouped.values()].sort((a, b) =>
      a.pluginKey.localeCompare(b.pluginKey),
    );
    return { plugins: result };
  });

  // ── Roles ────────────────────────────────────────────────────────────
  server.get("/api/admin/roles", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const roles = await listAdminRoles();
    return { roles };
  });

  server.post<{ Body: { name?: unknown; description?: unknown } }>(
    "/api/admin/roles",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = request.body ?? {};
      if (!isBoundedString(body.name, 64)) {
        reply.code(400).send({ error: "name is required (≤64 chars)" });
        return;
      }
      if (
        body.description !== undefined &&
        body.description !== null &&
        !isBoundedString(body.description, ROLE_DESCRIPTION_MAX)
      ) {
        reply.code(400).send({
          error: `description must be ≤${ROLE_DESCRIPTION_MAX} chars`,
        });
        return;
      }
      const description = isNonEmptyString(body.description)
        ? body.description
        : null;
      const existing = await listAdminRoles();
      const isUpdate = existing.some((r) => r.name === body.name);
      const record = await createAdminRole(body.name, description);
      await recordAudit(
        request.authUserId!,
        isUpdate ? "role.update" : "role.create",
        body.name,
        { description },
      );
      return record;
    },
  );

  server.patch<{ Params: { name: string }; Body: { description?: unknown } }>(
    "/api/admin/roles/:name",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      // PATCH on a non-existent role should 404 — the old handler
      // happily created one via the upsert shortcut, which made the
      // verb misleading.
      const existing = await listAdminRoles();
      if (!existing.some((r) => r.name === request.params.name)) {
        reply.code(404).send({ error: "role not found" });
        return;
      }
      const body = request.body ?? {};
      if (
        body.description !== undefined &&
        body.description !== null &&
        !isBoundedString(body.description, ROLE_DESCRIPTION_MAX)
      ) {
        reply.code(400).send({
          error: `description must be ≤${ROLE_DESCRIPTION_MAX} chars`,
        });
        return;
      }
      const description = isNonEmptyString(body.description)
        ? body.description
        : null;
      const record = await createAdminRole(request.params.name, description);
      await recordAudit(
        request.authUserId!,
        "role.update",
        request.params.name,
        { description },
      );
      return record;
    },
  );

  server.delete<{ Params: { name: string } }>(
    "/api/admin/roles/:name",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      // Block nuking the only admin-capable role the caller is actually
      // using — otherwise the request that just deleted it will be the
      // last one they can make. Owners are exempt since they retain access
      // via ownerIds bypass.
      if (
        request.authUserId &&
        !ownerIds.includes(request.authUserId)
      ) {
        const allUsers = await listAuthorizedUsers();
        const self = allUsers.find((u) => u.userId === request.authUserId);
        if (self && self.role === request.params.name) {
          reply
            .code(400)
            .send({ error: "cannot delete the role you are currently using" });
          return;
        }
      }
      const removed = await deleteAdminRole(request.params.name);
      if (!removed) {
        reply.code(404).send({ error: "role not found" });
        return;
      }
      await recordAudit(
        request.authUserId!,
        "role.delete",
        request.params.name,
      );
      reply.code(204).send();
    },
  );

  // ── Role capabilities ────────────────────────────────────────────────
  server.post<{ Params: { name: string }; Body: { capability?: unknown } }>(
    "/api/admin/roles/:name/capabilities",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const cap = request.body?.capability;
      if (!isNonEmptyString(cap) || !isAdminCapability(cap)) {
        reply.code(400).send({ error: "unknown capability token" });
        return;
      }
      const roles = await listAdminRoles();
      if (!roles.some((r) => r.name === request.params.name)) {
        reply.code(404).send({ error: "role not found" });
        return;
      }
      await grantRoleCapability(request.params.name, cap as AdminCapability);
      await recordAudit(
        request.authUserId!,
        "role.grant-capability",
        request.params.name,
        { capability: cap },
      );
      reply.code(204).send();
    },
  );

  server.delete<{ Params: { name: string; capability: string } }>(
    "/api/admin/roles/:name/capabilities/:capability",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      if (!isAdminCapability(request.params.capability)) {
        reply.code(400).send({ error: "unknown capability token" });
        return;
      }
      // Mirror of the "don't nuke your own role" guard — revoking the
      // `admin` token from your own role is instant self-lockout.
      if (
        request.params.capability === "admin" &&
        request.authUserId &&
        !ownerIds.includes(request.authUserId)
      ) {
        const allUsers = await listAuthorizedUsers();
        const self = allUsers.find((u) => u.userId === request.authUserId);
        if (self && self.role === request.params.name) {
          reply.code(400).send({
            error: "cannot revoke admin from the role you are currently using",
          });
          return;
        }
      }
      await revokeRoleCapability(
        request.params.name,
        request.params.capability as AdminCapability,
      );
      await recordAudit(
        request.authUserId!,
        "role.revoke-capability",
        request.params.name,
        {
          capability: request.params.capability,
        },
      );
      reply.code(204).send();
    },
  );

  // ── Audit ────────────────────────────────────────────────────────────
  // Reverse-chronological, id-cursor paginated. `before` takes the smallest
  // id from the previous page; omit it for the first page.
  server.get<{ Querystring: { limit?: string; before?: string } }>(
    "/api/admin/audit",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const parse = (s: string | undefined): number | undefined => {
        if (!s) return undefined;
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
      };
      const entries = await listAudit({
        limit: parse(request.query.limit),
        before: parse(request.query.before),
      });
      return { entries };
    },
  );

  // ── Feature summary ──────────────────────────────────────────────────
  // Cross-guild aggregate counts of every bot feature configuration.
  // Intended for the admin dashboard "what is this bot actually doing"
  // overview. Returns only counts — never row content.
  server.get("/api/admin/feature-summary", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const [stats, authorizedUsers, adminRoles] = await Promise.all([
        getBuiltinFeatureStats(),
        AuthorizedUser.count(),
        AdminRole.count(),
      ]);
      return {
        todoChannels: stats.rowCounts.todoChannels,
        pictureOnlyChannels: stats.rowCounts.pictureOnlyChannels,
        rconForwardChannels: stats.rowCounts.rconForwardChannels,
        roleEmojiGroups: stats.rowCounts.roleEmojiGroups,
        roleEmojis: stats.rowCounts.roleEmojis,
        authorizedUsers,
        adminRoles,
        distinctGuilds: stats.configuredGuildIds.size,
      };
    } catch (err) {
      request.log.error({ err }, "feature-summary query failed");
      reply.code(500).send({ error: "Failed to retrieve feature summary" });
    }
  });
}
