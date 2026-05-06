import type { Client } from "discord.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import { requireCapability } from "../web-core/route-guards.js";
import {
  accessibleBehaviorTargetIds,
  hasBehaviorCapability,
  type AdminCapability,
} from "../admin/admin-capabilities.js";
import { avatarUrlFor } from "../web-core/message-mapper.js";
import { decryptSecret } from "../../utils/crypto.js";
import type { BehaviorRow } from "./models/behavior.model.js";
import {
  assertExternalTarget,
  HostPolicyError,
} from "../../utils/host-policy.js";

export interface BehaviorRoutesOptions {
  bot?: Client;
}

interface UserProfile {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
}

const PROFILE_TTL_MS = config.behavior.profileCacheTtlMs;
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

export async function isValidWebhookUrl(
  value: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return { ok: false, reason: "無效的 URL 格式" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Webhook URL 必須使用 http 或 https" };
  }
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  try {
    await assertExternalTarget(u.hostname, port);
  } catch (err) {
    const reason =
      err instanceof HostPolicyError ? err.message : "Webhook 目標不被允許";
    return { ok: false, reason };
  }
  return { ok: true };
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
 * @deprecated M1-A1 stub。M1-C 接管後重寫（基於 v2 CommandReconciler）。
 * 暫時 no-op，不呼叫 Discord API。
 */
export function createResyncSlash(_bot: Client | undefined): () => void {
  return (): void => {
    // M1-A1: dm-slash-rebind 暫時停用。M1-C 接管後重寫。
  };
}
