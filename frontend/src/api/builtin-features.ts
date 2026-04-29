import { ApiError, authedFetch } from "./client";

/**
 * Admin API for the bot's in-process (built-in) features.
 *
 *   GET  /api/bot-features/state              → list every state row
 *   PUT  /api/bot-features/state/:featureKey  body: { guildId?: string|null, enabled }
 *
 * `guildId` null/undefined = operator default (used by every guild
 * that has no explicit override). Concrete guildId = per-guild
 * override.
 */

export type BuiltinFeatureKey = "todo" | "picture-only" | "role-emoji" | "rcon" | "voice";

export interface BuiltinFeatureState {
  featureKey: BuiltinFeatureKey;
  default: { enabled: boolean; updatedAt: string } | null;
  effectiveDefault: boolean;
  perGuild: Array<{ guildId: string; enabled: boolean; updatedAt: string }>;
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(
      response.status,
      body.error ?? `${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

export async function listBuiltinFeatureState(): Promise<
  BuiltinFeatureState[]
> {
  const r = await authedFetch("/api/bot-features/state");
  const body = await jsonOrThrow<{ features: BuiltinFeatureState[] }>(r);
  return body.features;
}

export async function setBuiltinFeatureState(
  featureKey: string,
  enabled: boolean,
  guildId: string | null = null,
): Promise<void> {
  const r = await authedFetch(`/api/bot-features/state/${featureKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, guildId }),
  });
  await jsonOrThrow<unknown>(r);
}
