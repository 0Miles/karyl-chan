<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from '../../../components/AppModal.vue';
import AppSelectField, { type SelectOption } from '../../../components/AppSelectField.vue';
import {
    createGuildChannel,
    editGuildChannel,
    type CreatableChannelKind,
    type GuildChannelCategory
} from '../../../api/guilds';
import { useChannelMgmtStore } from '../../../modules/discord-chat/stores/channelMgmtStore';

const props = defineProps<{
    /** Pre-loaded guild categories — needed for the parent picker. */
    categories: GuildChannelCategory[];
}>();

const { t: $t } = useI18n();
const store = useChannelMgmtStore();
const target = computed(() => store.target);
const visible = computed(() => target.value !== null);

const TYPE_OPTIONS: Array<{ value: CreatableChannelKind; label: string }> = [
    { value: 'text', label: 'channelMgmt.typeText' },
    { value: 'voice', label: 'channelMgmt.typeVoice' },
    { value: 'category', label: 'channelMgmt.typeCategory' },
    { value: 'announcement', label: 'channelMgmt.typeAnnouncement' },
    { value: 'forum', label: 'channelMgmt.typeForum' }
];
const AUTO_ARCHIVE_OPTIONS = [60, 1440, 4320, 10080] as const;

// Form fields — kept on `ref` rather than computed-with-set so the user
// can freely edit without re-deriving from the target snapshot.
const name = ref('');
const type = ref<CreatableChannelKind>('text');
const parentId = ref<string | null>(null);
const topic = ref('');
const slowmode = ref(0);
const nsfw = ref(false);
const autoArchive = ref<60 | 1440 | 4320 | 10080>(1440);
const archived = ref(false);
const locked = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

watch(target, (t) => {
    error.value = null;
    submitting.value = false;
    if (!t) return;
    if (t.mode === 'create') {
        name.value = '';
        type.value = t.defaultType ?? 'text';
        parentId.value = t.parentId;
        topic.value = '';
        slowmode.value = 0;
        nsfw.value = false;
    } else {
        const ch = t.channel;
        name.value = ch.name;
        type.value = (ch.kind === 'stage' ? 'voice' : (ch.kind as CreatableChannelKind));
        parentId.value = null; // not editable here; we'd need parent info on the channel row
        topic.value = '';
        slowmode.value = 0;
        nsfw.value = false;
        if (t.isThread) {
            archived.value = !!t.threadArchived;
            locked.value = !!t.threadLocked;
            autoArchive.value = t.threadAutoArchiveDuration ?? 1440;
        }
    }
}, { immediate: true });

const categoryOptions = computed(() =>
    props.categories.filter(c => c.id !== null).map(c => ({ id: c.id as string, name: c.name ?? c.id! }))
);

const typeSelectOptions = computed<SelectOption<CreatableChannelKind>[]>(() =>
    TYPE_OPTIONS.map(o => ({ value: o.value, label: $t(o.label) }))
);
const parentSelectOptions = computed<SelectOption<string | null>[]>(() => [
    { value: null, label: $t('channelMgmt.fieldParentNone') },
    ...categoryOptions.value.map(c => ({ value: c.id, label: c.name }))
]);
const autoArchiveOptions = computed<SelectOption<number>[]>(() =>
    AUTO_ARCHIVE_OPTIONS.map(d => ({ value: d, label: $t('channelMgmt.autoArchive' + d) }))
);

function close() { store.close(); }

async function submit() {
    const t = target.value;
    if (!t || submitting.value) return;
    if (!name.value.trim()) {
        error.value = $t('channelMgmt.fieldName');
        return;
    }
    submitting.value = true;
    error.value = null;
    try {
        if (t.mode === 'create') {
            const opts: Parameters<typeof createGuildChannel>[1] = {
                name: name.value.trim(),
                type: type.value,
                parentId: parentId.value ?? undefined
            };
            // Only meaningful for text-like channels — server ignores
            // these fields on category/voice/forum, so passing them
            // unconditionally would only inflate the request.
            if (type.value === 'text' || type.value === 'announcement') {
                if (topic.value.trim()) opts.topic = topic.value.trim();
                if (slowmode.value > 0) opts.rateLimitPerUser = slowmode.value;
                if (nsfw.value) opts.nsfw = true;
            }
            await createGuildChannel(t.guildId, opts);
        } else {
            const edit: Parameters<typeof editGuildChannel>[2] = {};
            if (name.value.trim() !== t.channel.name) edit.name = name.value.trim();
            if (t.isThread) {
                edit.archived = archived.value;
                edit.locked = locked.value;
                edit.autoArchiveDuration = autoArchive.value;
            } else {
                if (topic.value.trim()) edit.topic = topic.value.trim();
                if (slowmode.value > 0) edit.rateLimitPerUser = slowmode.value;
                if (nsfw.value) edit.nsfw = nsfw.value;
            }
            await editGuildChannel(t.guildId, t.channel.id, edit);
        }
        close();
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Operation failed';
    } finally {
        submitting.value = false;
    }
}

const titleText = computed(() =>
    target.value?.mode === 'create' ? $t('channelMgmt.createTitle') : $t('channelMgmt.editTitle')
);
const submitText = computed(() =>
    target.value?.mode === 'create' ? $t('channelMgmt.create') : $t('channelMgmt.save')
);
const showTextChannelExtras = computed(() =>
    !target.value || target.value.mode === 'create'
        ? type.value === 'text' || type.value === 'announcement'
        : !target.value.isThread && (target.value.channel.kind === 'text')
);
</script>

<template>
    <AppModal :visible="visible" :title="titleText" width="min(440px, 92vw)" @close="close">
        <form class="body" @submit.prevent="submit">
            <label class="field">
                <span>{{ $t('channelMgmt.fieldName') }}</span>
                <input v-model="name" type="text" maxlength="100" autofocus required />
            </label>
            <label v-if="target?.mode === 'create'" class="field">
                <span>{{ $t('channelMgmt.fieldType') }}</span>
                <AppSelectField
                    v-model="type"
                    :options="typeSelectOptions"
                    :drawer-title="$t('channelMgmt.fieldType')"
                />
            </label>
            <label v-if="target?.mode === 'create' && type !== 'category'" class="field">
                <span>{{ $t('channelMgmt.fieldParent') }}</span>
                <AppSelectField
                    v-model="parentId"
                    :options="parentSelectOptions"
                    :drawer-title="$t('channelMgmt.fieldParent')"
                />
            </label>
            <template v-if="target?.mode === 'edit' && target.isThread">
                <label class="field">
                    <span>{{ $t('channelMgmt.fieldAutoArchive') }}</span>
                    <AppSelectField
                        v-model="autoArchive"
                        :options="autoArchiveOptions"
                        :drawer-title="$t('channelMgmt.fieldAutoArchive')"
                    />
                </label>
                <label class="check">
                    <input type="checkbox" v-model="archived" />
                    {{ $t('channelMenu.archiveThread') }}
                </label>
                <label class="check">
                    <input type="checkbox" v-model="locked" />
                    {{ $t('channelMenu.lockThread') }}
                </label>
            </template>
            <template v-if="showTextChannelExtras">
                <label class="field">
                    <span>{{ $t('channelMgmt.fieldTopic') }}</span>
                    <input v-model="topic" type="text" maxlength="1024" />
                </label>
                <label class="field">
                    <span>{{ $t('channelMgmt.fieldSlowmode') }}</span>
                    <input v-model.number="slowmode" type="number" min="0" max="21600" />
                </label>
                <label class="check">
                    <input type="checkbox" v-model="nsfw" />
                    {{ $t('channelMgmt.fieldNsfw') }}
                </label>
            </template>
            <p v-if="error" class="error">{{ error }}</p>
            <footer class="actions">
                <button type="button" class="btn-ghost" @click="close">{{ $t('common.cancel') }}</button>
                <button type="submit" class="primary" :disabled="submitting">{{ submitText }}</button>
            </footer>
        </form>
    </AppModal>
</template>

<style scoped>
.body {
    padding: 0.8rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
.field span { color: var(--text-muted); }
.field input,
.field select {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.88rem; }
.error { color: var(--danger); font-size: 0.85rem; }
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
.btn-ghost,
.primary {
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
}
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    cursor: pointer;
    font: inherit;
}
.primary:disabled { opacity: 0.55; cursor: default; }
</style>
