import type { Client } from "discord.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireCapability } from "../web-core/route-guards.js";
import {
  accessibleBehaviorTargetIds,
  hasBehaviorCapability,
  type AdminCapability,
} from "../admin/admin-capabilities.js";
import { avatarUrlFor } from "../web-core/message-mapper.js";
import { decryptSecret } from "../../utils/crypto.js";
import { rebindDmOnlyCommandsAsGlobal as rebindDmSlashService } from "./dm-slash-rebind.service.js";
import type { BehaviorRow } from "./models/behavior.model.js";

export interface BehaviorRoutesOptions {
  bot?: Client;
}

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

export async function fetchProfile(
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
export function decryptedView(row: BehaviorRow): BehaviorRow {
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
export function requireBehaviorTarget(
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
export function requireBehaviorAdmin(
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
export function visibleTargetFilter(
  request: FastifyRequest,
): (targetId: number) => boolean {
  const caps = request.authCapabilities as Set<AdminCapability> | undefined;
  if (!caps) return () => false;
  const access = accessibleBehaviorTargetIds(caps);
  if (access === "all") return () => true;
  return (targetId: number) => access.has(String(targetId));
}

export function isValidWebhookUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidRegex(value: string): boolean {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-sync DM-only globals after any CRUD that could change the
 * desired set. Cheap: the service walks system + all_dms behaviors
 * (small set) and calls Discord's application.commands API only
 * when a diff exists. Fire-and-forget — if it fails, the next
 * change or restart heals it.
 */
export function createResyncSlash(bot: Client | undefined): () => void {
  return (): void => {
    if (!bot) return;
    void rebindDmSlashService(bot).catch(() => {
      /* logged inside the service */
    });
  };
}
