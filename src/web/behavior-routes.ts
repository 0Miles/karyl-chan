import type { Client } from "discordx";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireCapability } from "./route-guards.js";
import {
  accessibleBehaviorTargetIds,
  hasAdminCapability,
  hasBehaviorCapability,
  type AdminCapability,
} from "../permission/admin-capabilities.js";
import { recordAudit } from "./admin-audit.service.js";
import { avatarUrlFor } from "./message-mapper.js";
import {
  isSnowflake,
  isBoundedString,
  isNonEmptyString,
} from "./validators.js";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";
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
  type BehaviorTargetKind,
} from "../models/behavior-target.model.js";
import {
  addGroupMember,
  findGroupMembers,
  removeGroupMember,
  replaceGroupMembers,
} from "../models/behavior-target-member.model.js";
import {
  createBehavior,
  deleteBehavior,
  findBehaviorById,
  findBehaviorsByTarget,
  reorderBehaviors,
  updateBehavior,
  type BehaviorForwardType,
  type BehaviorRow,
  type BehaviorTriggerType,
} from "../models/behavior.model.js";
import { endSessionsForBehavior } from "../models/behavior-session.model.js";
import { findPluginById } from "../models/plugin.model.js";
import type { PluginManifest } from "../services/plugin-registry.service.js";

export interface BehaviorRoutesOptions {
  bot?: Client;
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const TRIGGER_VALUE_MAX = 2000;
const GROUP_NAME_MAX = 80;
const WEBHOOK_URL_MAX = 1000;
const WEBHOOK_SECRET_MAX = 200;

const TRIGGER_TYPES: BehaviorTriggerType[] = [
  "startswith",
  "endswith",
  "regex",
  "slash_command",
];
const FORWARD_TYPES: BehaviorForwardType[] = ["one_time", "continuous"];

interface UserProfile {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
}

const PROFILE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<
  string,
  { profile: UserProfile | null; expiresAt: number }
>();

async function fetchProfile(
  bot: Client | undefined,
  userId: string,
): Promise<UserProfile | null> {
  if (!bot) return null;
  const cached = profileCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.profile;
  try {
    const user = await bot.users.fetch(userId);
    const profile: UserProfile = {
      id: user.id,
      username: user.username,
      globalName: user.globalName ?? null,
      avatarUrl: avatarUrlFor(user.id, user.avatar),
    };
    profileCache.set(userId, { profile, expiresAt: now + PROFILE_TTL_MS });
    return profile;
  } catch {
    profileCache.set(userId, {
      profile: null,
      expiresAt: now + PROFILE_TTL_MS,
    });
    return null;
  }
}

/**
 * Decrypt the URL + secret before handing them to the admin UI. Both
 * fields round-trip in plaintext: the URL is operator config (treated
 * as plain config like a host:port) and the secret is needed to
 * verify it matches what the receiving server expects. They remain
 * AES-encrypted at rest.
 */
function decryptedView(row: BehaviorRow): BehaviorRow {
  return {
    ...row,
    webhookUrl: row.webhookUrl ? decryptSecret(row.webhookUrl) : row.webhookUrl,
    webhookSecret: row.webhookSecret ? decryptSecret(row.webhookSecret) : null,
  };
}

/**
 * Per-target gate: satisfied by `admin`, `behavior.manage`, or the
 * matching `behavior:<targetId>.manage` token. Unlike requireCapability
 * this resolves dynamically against the path's targetId so a scoped
 * role only unlocks the targets it was granted.
 */
function requireBehaviorTarget(
  request: FastifyRequest,
  reply: FastifyReply,
  targetId: number,
): boolean {
  const caps = request.authCapabilities as Set<AdminCapability> | undefined;
  if (caps && hasBehaviorCapability(caps, targetId)) return true;
  reply.code(403).send({
    error: `behavior.manage (or behavior:${targetId}.manage) capability required`,
  });
  return false;
}

/**
 * Module-level gate for actions that mutate the TARGET catalog itself
 * (add target, delete target, manage group membership). Per the spec
 * scoped users can only CRUD behaviors UNDER targets they were granted
 * — the catalog stays admin / behavior.manage.
 */
function requireBehaviorAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  return requireCapability(request, reply, "behavior.manage");
}

/**
 * "What targets is this caller allowed to see?" — `'all'` for full
 * admins, otherwise the explicit set their per-target tokens grant.
 * all_dms is NOT auto-included: managing all_dms behaviors affects
 * every DM sender, so the admin must explicitly grant
 * `behavior:1.manage` for a scoped user to touch it.
 */
function visibleTargetFilter(
  request: FastifyRequest,
): (targetId: number) => boolean {
  const caps = request.authCapabilities as Set<AdminCapability> | undefined;
  if (!caps) return () => false;
  const access = accessibleBehaviorTargetIds(caps);
  if (access === "all") return () => true;
  return (targetId: number) => access.has(String(targetId));
}

function isValidWebhookUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidRegex(value: string): boolean {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

export async function registerBehaviorRoutes(
  server: FastifyInstance,
  options: BehaviorRoutesOptions = {},
): Promise<void> {
  const { bot } = options;

  // ───────────────────────── targets ─────────────────────────

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
          return { ...t, profile: null as UserProfile | null };
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
    async (request, reply) => {
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

  // ───────────────────────── group members ─────────────────────────

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

  // ───────────────────────── behaviors ─────────────────────────

  server.get<{ Params: { id: string } }>(
    "/api/behaviors/targets/:id/behaviors",
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      if (!requireBehaviorTarget(request, reply, id)) return;
      const target = await findBehaviorTargetById(id);
      if (!target) {
        reply.code(404).send({ error: "target not found" });
        return;
      }
      const rows = await findBehaviorsByTarget(id);
      return { behaviors: rows.map(decryptedView) };
    },
  );

  server.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/behaviors/targets/:id/behaviors",
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      if (!requireBehaviorTarget(request, reply, id)) return;
      const target = await findBehaviorTargetById(id);
      if (!target) {
        reply.code(404).send({ error: "target not found" });
        return;
      }
      const body = request.body ?? {};
      const title = body.title;
      const description = body.description;
      const triggerType = body.triggerType;
      const triggerValue = body.triggerValue;
      const forwardType = body.forwardType;
      const webhookUrl = body.webhookUrl;
      const webhookSecret = body.webhookSecret;
      const stopOnMatch = body.stopOnMatch;
      const enabled = body.enabled;
      // Plugin discriminator. Default 'webhook' keeps every existing
      // create-call working. type='plugin' switches the dispatch path
      // and ignores webhookUrl/webhookSecret in favour of pluginId +
      // pluginBehaviorKey.
      const rawType = body.type;
      const behaviorType: "webhook" | "plugin" =
        rawType === "plugin" ? "plugin" : "webhook";
      const pluginIdInput = body.pluginId;
      const pluginBehaviorKeyInput = body.pluginBehaviorKey;

      if (!isBoundedString(title, TITLE_MAX)) {
        reply
          .code(400)
          .send({ error: `title required (max ${TITLE_MAX} chars)` });
        return;
      }
      if (
        description !== undefined &&
        (typeof description !== "string" ||
          description.length > DESCRIPTION_MAX)
      ) {
        reply
          .code(400)
          .send({ error: `description max ${DESCRIPTION_MAX} chars` });
        return;
      }
      if (
        typeof triggerType !== "string" ||
        !TRIGGER_TYPES.includes(triggerType as BehaviorTriggerType)
      ) {
        reply.code(400).send({
          error: `triggerType must be one of ${TRIGGER_TYPES.join("|")}`,
        });
        return;
      }
      if (!isBoundedString(triggerValue, TRIGGER_VALUE_MAX)) {
        reply.code(400).send({
          error: `triggerValue required (max ${TRIGGER_VALUE_MAX} chars)`,
        });
        return;
      }
      if (triggerType === "regex" && !isValidRegex(triggerValue)) {
        reply.code(400).send({ error: "triggerValue is not a valid regex" });
        return;
      }
      // type='plugin' + triggerType='slash_command' is a dead combo:
      // the plugin's slash commands are registered through its
      // manifest.commands[] and routed by plugin-interaction-dispatch,
      // NOT through the behavior table. A behavior row with this
      // combo would never fire.
      if (behaviorType === "plugin" && triggerType === "slash_command") {
        reply.code(400).send({
          error:
            "type='plugin' cannot use triggerType='slash_command'; declare slash commands in the plugin's manifest.commands instead",
        });
        return;
      }
      if (
        typeof forwardType !== "string" ||
        !FORWARD_TYPES.includes(forwardType as BehaviorForwardType)
      ) {
        reply.code(400).send({
          error: `forwardType must be one of ${FORWARD_TYPES.join("|")}`,
        });
        return;
      }
      // Per-type validation. Webhook rows need a real URL + optional
      // HMAC secret. Plugin rows need pluginId + pluginBehaviorKey
      // and ignore webhookUrl/secret entirely (a placeholder URL is
      // synthesized to satisfy the NOT NULL column).
      let encryptedUrlField: string;
      let encryptedSecret: string | null = null;
      let resolvedPluginId: number | null = null;
      let resolvedPluginBehaviorKey: string | null = null;
      if (behaviorType === "webhook") {
        if (
          !isNonEmptyString(webhookUrl) ||
          webhookUrl.length > WEBHOOK_URL_MAX ||
          !isValidWebhookUrl(webhookUrl)
        ) {
          reply.code(400).send({
            error: "webhookUrl required (must be a valid http/https URL)",
          });
          return;
        }
        if (typeof webhookSecret === "string" && webhookSecret.length > 0) {
          if (webhookSecret.length > WEBHOOK_SECRET_MAX) {
            reply.code(400).send({
              error: `webhookSecret max ${WEBHOOK_SECRET_MAX} chars`,
            });
            return;
          }
          encryptedSecret = encryptSecret(webhookSecret);
        }
        encryptedUrlField = encryptSecret(webhookUrl);
      } else {
        // type === 'plugin'
        const pluginId = Number(pluginIdInput);
        if (!Number.isInteger(pluginId) || pluginId <= 0) {
          reply.code(400).send({ error: "pluginId required for type=plugin" });
          return;
        }
        if (
          typeof pluginBehaviorKeyInput !== "string" ||
          pluginBehaviorKeyInput.length === 0 ||
          pluginBehaviorKeyInput.length > 80
        ) {
          reply
            .code(400)
            .send({ error: "pluginBehaviorKey required for type=plugin" });
          return;
        }
        // Verify the plugin exists and exposes the requested
        // dm_behavior. Do this upfront so a misconfigured behavior
        // never reaches the dispatcher.
        const plugin = await findPluginById(pluginId);
        if (!plugin) {
          reply.code(404).send({ error: `plugin id=${pluginId} not found` });
          return;
        }
        let manifest: PluginManifest | null = null;
        try {
          manifest = JSON.parse(plugin.manifestJson) as PluginManifest;
        } catch {
          /* malformed manifest — fall through to behavior_key check fail */
        }
        const declared = manifest?.dm_behaviors?.some(
          (b) => b.key === pluginBehaviorKeyInput,
        );
        if (!declared) {
          reply.code(400).send({
            error: `plugin '${plugin.pluginKey}' does not declare dm_behavior key='${pluginBehaviorKeyInput}'`,
          });
          return;
        }
        resolvedPluginId = pluginId;
        resolvedPluginBehaviorKey = pluginBehaviorKeyInput;
        // Synthesize a non-functional placeholder for the NOT NULL
        // webhookUrl column. The dispatcher reads plugins.url at
        // dispatch time and never decrypts this placeholder.
        encryptedUrlField = encryptSecret(
          `plugin://${plugin.pluginKey}/${pluginBehaviorKeyInput}`,
        );
      }
      const created = await createBehavior({
        targetId: id,
        title: title.trim(),
        description: typeof description === "string" ? description : "",
        triggerType: triggerType as BehaviorTriggerType,
        triggerValue,
        forwardType: forwardType as BehaviorForwardType,
        webhookUrl: encryptedUrlField,
        webhookSecret: encryptedSecret,
        stopOnMatch: !!stopOnMatch,
        enabled: enabled === undefined ? true : !!enabled,
        type: behaviorType,
        pluginId: resolvedPluginId,
        pluginBehaviorKey: resolvedPluginBehaviorKey,
      });
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.create",
        String(created.id),
        {
          targetId: id,
          triggerType,
          forwardType,
          stopOnMatch: !!stopOnMatch,
          signed: !!encryptedSecret,
          type: behaviorType,
          pluginId: resolvedPluginId,
          pluginBehaviorKey: resolvedPluginBehaviorKey,
        },
      );
      return { behavior: decryptedView(created) };
    },
  );

  server.patch<{
    Params: { behaviorId: string };
    Body: Record<string, unknown>;
  }>("/api/behaviors/behaviors/:behaviorId", async (request, reply) => {
    const behaviorId = Number(request.params.behaviorId);
    if (!Number.isInteger(behaviorId) || behaviorId <= 0) {
      reply.code(400).send({ error: "invalid behavior id" });
      return;
    }
    const existing = await findBehaviorById(behaviorId);
    if (!existing) {
      reply.code(404).send({ error: "behavior not found" });
      return;
    }
    // Scoped users may CRUD behaviors UNDER targets they have a token
    // for. The check uses the existing behavior's targetId (not the
    // body's, which is the proposed new home — that's verified
    // separately below if the move is requested).
    if (!requireBehaviorTarget(request, reply, existing.targetId)) return;

    const body = request.body ?? {};
    const update: Parameters<typeof updateBehavior>[1] = {};

    // System behaviors are bot-built-in fixtures with locked-down
    // edits: only triggerType / triggerValue may change. `enabled`
    // is locked to true — these flows (e.g. admin-login) are part of
    // bot infrastructure and disabling them would lock admins out.
    // Refuse anything else loudly so the UI's read-only fields can't
    // be bypassed by hand-crafting the patch body.
    if (existing.type === "system") {
      const allowed = new Set(["triggerType", "triggerValue"]);
      const offending = Object.keys(body).filter((k) => !allowed.has(k));
      if (offending.length > 0) {
        reply.code(400).send({
          error: `system behavior fields locked: cannot modify ${offending.join(", ")}`,
        });
        return;
      }
    }

    if (body.title !== undefined) {
      if (!isBoundedString(body.title, TITLE_MAX)) {
        reply.code(400).send({ error: `title max ${TITLE_MAX} chars` });
        return;
      }
      update.title = (body.title as string).trim();
    }
    if (body.description !== undefined) {
      if (
        typeof body.description !== "string" ||
        body.description.length > DESCRIPTION_MAX
      ) {
        reply
          .code(400)
          .send({ error: `description max ${DESCRIPTION_MAX} chars` });
        return;
      }
      update.description = body.description;
    }
    if (body.triggerType !== undefined) {
      if (
        typeof body.triggerType !== "string" ||
        !TRIGGER_TYPES.includes(body.triggerType as BehaviorTriggerType)
      ) {
        reply.code(400).send({
          error: `triggerType must be one of ${TRIGGER_TYPES.join("|")}`,
        });
        return;
      }
      update.triggerType = body.triggerType as BehaviorTriggerType;
    }
    if (body.triggerValue !== undefined) {
      if (!isBoundedString(body.triggerValue, TRIGGER_VALUE_MAX)) {
        reply
          .code(400)
          .send({ error: `triggerValue max ${TRIGGER_VALUE_MAX} chars` });
        return;
      }
      update.triggerValue = body.triggerValue as string;
    }
    // Validate regex against the resulting (post-patch) state so a
    // type-only or value-only change still gets checked.
    const finalType = (update.triggerType ??
      existing.triggerType) as BehaviorTriggerType;
    const finalValue = (update.triggerValue ?? existing.triggerValue) as string;
    if (finalType === "regex" && !isValidRegex(finalValue)) {
      reply.code(400).send({ error: "triggerValue is not a valid regex" });
      return;
    }
    if (body.forwardType !== undefined) {
      if (
        typeof body.forwardType !== "string" ||
        !FORWARD_TYPES.includes(body.forwardType as BehaviorForwardType)
      ) {
        reply.code(400).send({
          error: `forwardType must be one of ${FORWARD_TYPES.join("|")}`,
        });
        return;
      }
      update.forwardType = body.forwardType as BehaviorForwardType;
    }
    if (body.webhookUrl !== undefined) {
      // URL is required on the row, so no "clear" semantics —
      // only "set to a new value". Empty string is rejected;
      // omit the field to leave it untouched.
      if (
        typeof body.webhookUrl !== "string" ||
        body.webhookUrl.length === 0 ||
        body.webhookUrl.length > WEBHOOK_URL_MAX ||
        !isValidWebhookUrl(body.webhookUrl)
      ) {
        reply
          .code(400)
          .send({ error: "webhookUrl must be a valid http/https URL" });
        return;
      }
      update.webhookUrl = encryptSecret(body.webhookUrl);
    }
    if (body.webhookSecret !== undefined) {
      // null OR empty string = clear the secret (disable signing).
      // Non-empty string = encrypt + set. Field omitted = no change.
      if (body.webhookSecret === null || body.webhookSecret === "") {
        update.webhookSecret = null;
      } else if (
        typeof body.webhookSecret === "string" &&
        body.webhookSecret.length <= WEBHOOK_SECRET_MAX
      ) {
        update.webhookSecret = encryptSecret(body.webhookSecret);
      } else {
        reply
          .code(400)
          .send({ error: `webhookSecret max ${WEBHOOK_SECRET_MAX} chars` });
        return;
      }
    }
    if (body.stopOnMatch !== undefined) {
      update.stopOnMatch = !!body.stopOnMatch;
    }
    if (body.enabled !== undefined) {
      update.enabled = !!body.enabled;
    }
    if (body.targetId !== undefined) {
      const newTargetId = Number(body.targetId);
      if (!Number.isInteger(newTargetId) || newTargetId <= 0) {
        reply.code(400).send({ error: "invalid targetId" });
        return;
      }
      const newTarget = await findBehaviorTargetById(newTargetId);
      if (!newTarget) {
        reply.code(404).send({ error: "new target not found" });
        return;
      }
      // Moving a behavior requires permission on BOTH the source
      // (already checked above against existing.targetId) AND the
      // destination — otherwise a scoped user could push behaviors
      // out of their lane into one they don't manage.
      if (
        newTargetId !== existing.targetId &&
        !requireBehaviorTarget(request, reply, newTargetId)
      ) {
        return;
      }
      update.targetId = newTargetId;
    }

    // Type / plugin switch. Allowed on PATCH because the UX pattern
    // is "edit type in the card, save". When switching:
    //   webhook → plugin: clear webhookSecret, replace webhookUrl
    //                     with the placeholder, set pluginId / key
    //   plugin → webhook: clear pluginId / pluginBehaviorKey, require
    //                     a real webhookUrl (use update.webhookUrl
    //                     above), webhookSecret optional
    // We do this LAST so all other field updates above are already
    // accumulated in `update`.
    if (body.type !== undefined) {
      const nextType: "webhook" | "plugin" =
        body.type === "plugin" ? "plugin" : "webhook";
      if (nextType === "plugin") {
        const pid = Number(body.pluginId);
        if (!Number.isInteger(pid) || pid <= 0) {
          reply.code(400).send({ error: "pluginId required for type=plugin" });
          return;
        }
        const bk = body.pluginBehaviorKey;
        if (typeof bk !== "string" || bk.length === 0 || bk.length > 80) {
          reply
            .code(400)
            .send({ error: "pluginBehaviorKey required for type=plugin" });
          return;
        }
        const plugin = await findPluginById(pid);
        if (!plugin) {
          reply.code(404).send({ error: `plugin id=${pid} not found` });
          return;
        }
        let manifest: PluginManifest | null = null;
        try {
          manifest = JSON.parse(plugin.manifestJson) as PluginManifest;
        } catch {
          /* manifest parse fail → behavior_key check below fails */
        }
        if (!manifest?.dm_behaviors?.some((b) => b.key === bk)) {
          reply.code(400).send({
            error: `plugin '${plugin.pluginKey}' does not declare dm_behavior key='${bk}'`,
          });
          return;
        }
        // Reject the dead combo type=plugin × triggerType=slash_command
        // BEFORE persisting the type switch. Both `update.triggerType`
        // (already validated above) and `existing.triggerType` are
        // candidates depending on whether the same patch changed
        // trigger; check both. (Same combo blocked on POST/createBehavior.)
        const effectiveTrigger = update.triggerType ?? existing.triggerType;
        if (effectiveTrigger === "slash_command") {
          reply.code(400).send({
            error:
              "type='plugin' cannot use triggerType='slash_command'; declare slash commands in the plugin's manifest.commands instead",
          });
          return;
        }
        update.type = "plugin";
        update.pluginId = pid;
        update.pluginBehaviorKey = bk;
        // Replace webhookUrl with a placeholder; a real URL on a
        // plugin row is dead weight and could mislead future
        // operators. webhookSecret cleared because the plugin path
        // uses KARYL_PLUGIN_SECRET, not a per-behavior secret.
        update.webhookUrl = encryptSecret(`plugin://${plugin.pluginKey}/${bk}`);
        update.webhookSecret = null;
      } else {
        // webhook: caller must supply webhookUrl (already validated
        // above if they passed body.webhookUrl). If the existing row
        // is a plugin row and they didn't pass a URL, refuse — we'd
        // be left with a "plugin://" placeholder masquerading as a
        // real webhook URL.
        if (
          existing.type === "plugin" &&
          update.webhookUrl === undefined &&
          body.webhookUrl === undefined
        ) {
          reply.code(400).send({
            error: "switching from plugin to webhook requires a webhookUrl",
          });
          return;
        }
        update.type = "webhook";
        update.pluginId = null;
        update.pluginBehaviorKey = null;
      }
    }

    const updated = await updateBehavior(behaviorId, update);
    // Editing webhookUrl / webhookSecret / target / trigger /
    // forwardType mid-stream invalidates any active continuous
    // session bound to this behavior — drop the session so the
    // user re-enters via the new flow rather than continuing to
    // feed messages into stale config (or, in the case of
    // webhookSecret, signing with a key the server no longer
    // recognises).
    if (
      update.webhookUrl !== undefined ||
      update.webhookSecret !== undefined ||
      update.targetId !== undefined ||
      update.triggerType !== undefined ||
      update.triggerValue !== undefined ||
      update.forwardType !== undefined ||
      update.enabled === false
    ) {
      await endSessionsForBehavior(behaviorId);
    }
    await recordAudit(
      request.authUserId ?? "unknown",
      "behavior.update",
      String(behaviorId),
      {
        fields: Object.keys(update),
      },
    );
    return { behavior: updated ? decryptedView(updated) : null };
  });

  server.delete<{ Params: { behaviorId: string } }>(
    "/api/behaviors/behaviors/:behaviorId",
    async (request, reply) => {
      const behaviorId = Number(request.params.behaviorId);
      if (!Number.isInteger(behaviorId) || behaviorId <= 0) {
        reply.code(400).send({ error: "invalid behavior id" });
        return;
      }
      const existing = await findBehaviorById(behaviorId);
      if (!existing) {
        reply.code(404).send({ error: "behavior not found" });
        return;
      }
      if (!requireBehaviorTarget(request, reply, existing.targetId)) return;
      if (existing.type === "system") {
        reply.code(400).send({
          error: "system behaviors cannot be deleted",
        });
        return;
      }
      await deleteBehavior(behaviorId);
      // CASCADE on behavior_sessions takes care of session cleanup,
      // but log it explicitly for the audit trail.
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.delete",
        String(behaviorId),
        {
          targetId: existing.targetId,
        },
      );
      return { ok: true };
    },
  );

  server.patch<{ Params: { id: string }; Body: { orderedIds?: unknown } }>(
    "/api/behaviors/targets/:id/behaviors/reorder",
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      if (!requireBehaviorTarget(request, reply, id)) return;
      const target = await findBehaviorTargetById(id);
      if (!target) {
        reply.code(404).send({ error: "target not found" });
        return;
      }
      const orderedIds = request.body?.orderedIds;
      if (
        !Array.isArray(orderedIds) ||
        !orderedIds.every((n) => Number.isInteger(n) && (n as number) > 0)
      ) {
        reply
          .code(400)
          .send({ error: "orderedIds must be an array of positive integers" });
        return;
      }
      // Validate that the supplied set matches the target's current
      // behavior set exactly — protects against stale UI state
      // resequencing the wrong rows. System behaviors are excluded
      // from reorder (they pin to a fixed sortOrder=-1000 above
      // user rows).
      const current = (await findBehaviorsByTarget(id)).filter(
        (b) => b.type !== "system",
      );
      const currentIds = new Set(current.map((b) => b.id));
      const submittedIds = new Set(orderedIds as number[]);
      if (
        currentIds.size !== submittedIds.size ||
        [...currentIds].some((cid) => !submittedIds.has(cid))
      ) {
        reply.code(409).send({
          error:
            "orderedIds does not match the current behavior set; refresh and retry",
        });
        return;
      }
      await reorderBehaviors(id, orderedIds as number[]);
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.reorder",
        String(id),
        {
          count: orderedIds.length,
        },
      );
      return { ok: true };
    },
  );
}
