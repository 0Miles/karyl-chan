import { onMounted, ref } from 'vue';
import {
    getGuildSettings,
    patchGuildSettings,
    type GuildSettings,
    type GuildSettingsPatch
} from '../../../../api/guilds';
import { useApiError } from '../../../../composables/use-api-error';

/**
 * Per-card settings state. Each card creates its own instance; both the
 * load and the save responses repopulate `settings`, which the card
 * watches to reseed its draft. Shared with sibling cards only via the
 * underlying API — no cross-card state.
 */
export function useGuildSettings(guildId: string) {
    const { handle: handleApiError } = useApiError();

    const settings = ref<GuildSettings | null>(null);
    const loading = ref(false);
    const loadError = ref<string | null>(null);
    const saving = ref(false);
    const error = ref<string | null>(null);
    const savedFlash = ref(false);

    async function load() {
        loading.value = true;
        loadError.value = null;
        try {
            settings.value = await getGuildSettings(guildId);
        } catch (err) {
            if (handleApiError(err) !== 'unhandled') return;
            loadError.value = err instanceof Error ? err.message : 'Failed to load settings';
        } finally {
            loading.value = false;
        }
    }

    function flashSaved() {
        savedFlash.value = true;
        window.setTimeout(() => { savedFlash.value = false; }, 1800);
    }

    async function applyPatch(patch: GuildSettingsPatch): Promise<boolean> {
        saving.value = true;
        error.value = null;
        try {
            settings.value = await patchGuildSettings(guildId, patch);
            flashSaved();
            return true;
        } catch (err) {
            if (handleApiError(err) !== 'unhandled') return false;
            error.value = err instanceof Error ? err.message : 'Save failed';
            return false;
        } finally {
            saving.value = false;
        }
    }

    onMounted(load);

    return { settings, loading, loadError, saving, error, savedFlash, load, applyPatch };
}
