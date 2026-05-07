import type { Client } from "discord.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireCapability } from "../web-core/route-guards.js";
import { decryptSecret } from "../../utils/crypto.js";
import type { BehaviorRow } from "./models/behavior.model.js";
import {
  assertExternalTarget,
  HostPolicyError,
} from "../../utils/host-policy.js";

export interface BehaviorRoutesOptions {
  bot?: Client;
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

