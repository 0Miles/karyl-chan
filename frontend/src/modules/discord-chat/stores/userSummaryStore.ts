import { defineStore } from "pinia";
import { ref } from "vue";
import {
  fetchUserSummaries,
  type DiscordUserSummary,
} from "../../../api/discord";

const TTL_MS = 5 * 60 * 1000;

/**
 * Cross-guild bulk user-name resolver. Pinia state is reliably reactive
 * (the previous ref(Map) implementation hit a reproducible-only-in-prod
 * reactivity stall — replacing summaries.value didn't propagate to the
 * AdminLoginCard until the component remounted from a route change).
 */
export const useUserSummaryStore = defineStore("user-summary", () => {
  // Plain Record keyed by userId. ref<Record> is deeply reactive and
  // assigning summaries.value = { ...next } reliably triggers updates
  // in template getters that read summaries.value[userId].
  const summaries = ref<Record<string, DiscordUserSummary | null>>({});
  const expiresAt = new Map<string, number>();
  const inflight = new Set<string>();

  async function resolve(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = Date.now();
    const missing = ids.filter((id) => {
      if (inflight.has(id)) return false;
      const exp = expiresAt.get(id);
      return !exp || exp <= now;
    });
    if (missing.length === 0) return;

    for (const id of missing) inflight.add(id);
    try {
      const CHUNK = 50;
      for (let i = 0; i < missing.length; i += CHUNK) {
        const chunk = missing.slice(i, i + CHUNK);
        const result = await fetchUserSummaries(chunk);
        const newExp = Date.now() + TTL_MS;
        const next = { ...summaries.value };
        for (const id of chunk) {
          next[id] = result[id] ?? null;
          expiresAt.set(id, newExp);
        }
        summaries.value = next;
      }
    } finally {
      for (const id of missing) inflight.delete(id);
    }
  }

  function getSummary(userId: string): DiscordUserSummary | null {
    return summaries.value[userId] ?? null;
  }

  /** Preferred display name: globalName → username → null. */
  function getDisplayName(userId: string): string | null {
    const s = summaries.value[userId];
    if (!s) return null;
    return s.globalName ?? s.username;
  }

  return { summaries, resolve, getDisplayName, getSummary };
});
