import { defineStore } from "pinia";
import { ref } from "vue";
import { listGuilds, type GuildSummary } from "../api/guilds";

export const useGuildListStore = defineStore("guild-list", () => {
  const guilds = ref<GuildSummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let inflightPromise: Promise<GuildSummary[]> | null = null;

  async function ensure(): Promise<GuildSummary[]> {
    if (guilds.value.length > 0) return guilds.value;
    return refresh();
  }

  async function refresh(): Promise<GuildSummary[]> {
    if (inflightPromise) return inflightPromise;
    loading.value = true;
    error.value = null;
    inflightPromise = listGuilds()
      .then((result) => {
        guilds.value = result;
        return result;
      })
      .catch((err) => {
        error.value =
          err instanceof Error ? err.message : "Failed to load guilds";
        throw err;
      })
      .finally(() => {
        loading.value = false;
        inflightPromise = null;
      });
    return inflightPromise;
  }

  return { guilds, loading, error, ensure, refresh };
});
