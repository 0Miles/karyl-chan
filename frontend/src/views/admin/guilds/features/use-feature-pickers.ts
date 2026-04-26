import { computed, ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
    listGuildRoles,
    listGuildTextChannels,
    type GuildChannelCategory,
    type GuildRoleSummary
} from '../../../../api/guilds';
import type { SelectOption } from '../../../../components/AppSelectField.vue';

export function useChannelPicker(guildId: string) {
    const { t } = useI18n();
    const textCategories = ref<GuildChannelCategory[]>([]);

    onMounted(async () => {
        try {
            textCategories.value = await listGuildTextChannels(guildId);
        } catch {
            // Cosmetic data — silently empty if it fails. The form still
            // works using raw IDs the user types in.
        }
    });

    const channelPickerOptions = computed<SelectOption<string>[]>(() => {
        const out: SelectOption<string>[] = [
            { value: '', label: t('guilds.feature.channelPlaceholder') }
        ];
        for (const cat of textCategories.value) {
            const groupLabel = cat.name ?? null;
            for (const ch of cat.channels) {
                out.push({ value: ch.id, label: '#' + ch.name, group: groupLabel ?? undefined });
            }
        }
        return out;
    });

    return { channelPickerOptions };
}

export function useRolePicker(guildId: string) {
    const { t } = useI18n();
    const roles = ref<GuildRoleSummary[]>([]);

    onMounted(async () => {
        try {
            roles.value = await listGuildRoles(guildId);
        } catch {
            // Cosmetic data — silently empty if it fails.
        }
    });

    const rolePickerOptions = computed<SelectOption<string>[]>(() => [
        { value: '', label: t('guilds.feature.rolePlaceholder') },
        ...roles.value.map(r => ({ value: r.id, label: '@' + r.name }))
    ]);

    return { rolePickerOptions };
}
