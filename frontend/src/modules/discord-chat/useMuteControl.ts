import { computed, type Ref } from 'vue';
import { useMuteStore } from './stores/muteStore';
import { useI18n } from 'vue-i18n';

export function useMuteControl(channelId: Ref<string | null>) {
    const { t: $t } = useI18n();
    const muteStore = useMuteStore();

    const muteLevel = computed(() => channelId.value ? muteStore.getLevel(channelId.value) : 'all');
    const isMuted = computed(() => muteLevel.value !== 'all');
    const muteIcon = computed(() => {
        switch (muteLevel.value) {
            case 'none': return 'material-symbols:notifications-off-outline-rounded';
            case 'mentions-only': return 'material-symbols:alternate-email-rounded';
            default: return 'material-symbols:notifications-outline-rounded';
        }
    });
    const muteTooltip = computed(() => {
        switch (muteLevel.value) {
            case 'none': return $t('messages.muteCycleHintFromNone');
            case 'mentions-only': return $t('messages.muteCycleHintFromMentions');
            default: return $t('messages.muteCycleHintFromAll');
        }
    });

    function toggleMute() {
        if (channelId.value) muteStore.cycle(channelId.value);
    }

    return { isMuted, muteIcon, muteTooltip, toggleMute };
}
