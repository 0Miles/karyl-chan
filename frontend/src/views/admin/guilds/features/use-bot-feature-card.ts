import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getGuildDetail, type GuildDetail } from '../../../../api/guilds';
import { useApiError } from '../../../../composables/use-api-error';

export function useBotFeatureCard(initialDetail: GuildDetail, onChanged: () => void) {
    const { t } = useI18n();
    const { handle: handleApiError } = useApiError();

    const detailLocal = ref<GuildDetail>(initialDetail);
    const error = ref<string | null>(null);

    async function refreshDetail() {
        try {
            detailLocal.value = await getGuildDetail(detailLocal.value.guild.id);
            onChanged();
        } catch (err) {
            if (handleApiError(err) !== 'unhandled') return;
        }
    }

    async function action<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
        error.value = null;
        try {
            const result = await fn();
            await refreshDetail();
            return result;
        } catch (err) {
            if (handleApiError(err) !== 'unhandled') return undefined;
            error.value = t('guilds.feature.actionFailed', {
                message: err instanceof Error ? err.message : `${label} failed`
            });
            return undefined;
        }
    }

    return { detailLocal, error, refreshDetail, action };
}
