<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
    addCapabilityGrant,
    addPictureOnlyChannel,
    addRoleEmoji,
    addRoleReceiveMessage,
    addTodoChannel,
    getGuildDetail,
    listGuildRoles,
    listGuildTextChannels,
    removeCapabilityGrant,
    removePictureOnlyChannel,
    removeRconForward,
    removeRoleEmoji,
    removeRoleReceiveMessage,
    removeTodoChannel,
    upsertRconForward,
    type GuildChannelCategory,
    type GuildDetail,
    type GuildRoleSummary
} from '../../../../api/guilds';
import { useApiError } from '../../../../composables/use-api-error';
import AppSelectField, { type SelectOption } from '../../../../components/AppSelectField.vue';

const props = defineProps<{
    detail: GuildDetail;
}>();

const emit = defineEmits<{
    (e: 'changed'): void;
}>();

const { t } = useI18n();
const { handle: handleApiError } = useApiError();

const detailLocal = ref<GuildDetail>(props.detail);
const textCategories = ref<GuildChannelCategory[]>([]);
const roles = ref<GuildRoleSummary[]>([]);
const error = ref<string | null>(null);

async function loadAux() {
    try {
        const [tx, rl] = await Promise.all([
            listGuildTextChannels(detailLocal.value.guild.id),
            listGuildRoles(detailLocal.value.guild.id)
        ]);
        textCategories.value = tx;
        roles.value = rl;
    } catch {
        // Cosmetic data — silently empty if it fails. The actions still
        // work using raw IDs the user types in.
    }
}
loadAux();

async function refreshDetail() {
    try {
        detailLocal.value = await getGuildDetail(detailLocal.value.guild.id);
        emit('changed');
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
    }
}

function customEmojiUrl(id: string): string {
    return `https://cdn.discordapp.com/emojis/${id}.webp?size=32&quality=lossless`;
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

// ── Add-form state per feature card ────────────────────────────────
const todoChannel = ref<string>('');
const pictureChannel = ref<string>('');
const rconChannel = ref<string>('');
const rconHost = ref<string>('');
const rconPort = ref<string>('');
const rconPassword = ref<string>('');
const rconCmdPrefix = ref<string>('!');
const rconTriggerPrefix = ref<string>('');
const roleEmojiRoleId = ref<string>('');
const roleEmojiInput = ref<string>('');
const roleReceiveChannel = ref<string>('');
const roleReceiveMessage = ref<string>('');
const capabilityName = ref<string>('');
const capabilityRoleId = ref<string>('');

const allTextChannels = computed(() => textCategories.value.flatMap(cat => cat.channels));

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

const rolePickerOptions = computed<SelectOption<string>[]>(() => [
    { value: '', label: t('guilds.feature.rolePlaceholder') },
    ...roles.value.map(r => ({ value: r.id, label: '@' + r.name }))
]);

async function addTodo() {
    if (!todoChannel.value) return;
    if (await action('add-todo', () => addTodoChannel(detailLocal.value.guild.id, todoChannel.value)) !== undefined) {
        todoChannel.value = '';
    }
}
async function rmTodo(channelId: string) {
    await action('rm-todo', () => removeTodoChannel(detailLocal.value.guild.id, channelId));
}
async function addPicture() {
    if (!pictureChannel.value) return;
    if (await action('add-picture', () => addPictureOnlyChannel(detailLocal.value.guild.id, pictureChannel.value)) !== undefined) {
        pictureChannel.value = '';
    }
}
async function rmPicture(channelId: string) {
    await action('rm-picture', () => removePictureOnlyChannel(detailLocal.value.guild.id, channelId));
}
async function saveRcon() {
    if (!rconChannel.value) return;
    const port = Number(rconPort.value);
    const ok = await action('save-rcon', () => upsertRconForward(detailLocal.value.guild.id, {
        channelId: rconChannel.value,
        host: rconHost.value || null,
        port: Number.isFinite(port) && port > 0 ? port : null,
        password: rconPassword.value || null,
        commandPrefix: rconCmdPrefix.value || null,
        triggerPrefix: rconTriggerPrefix.value || null
    }));
    if (ok !== undefined) {
        rconChannel.value = '';
        rconHost.value = '';
        rconPort.value = '';
        rconPassword.value = '';
        rconCmdPrefix.value = '!';
        rconTriggerPrefix.value = '';
    }
}
async function rmRcon(channelId: string) {
    await action('rm-rcon', () => removeRconForward(detailLocal.value.guild.id, channelId));
}
async function addRE() {
    if (!roleEmojiRoleId.value || !roleEmojiInput.value) return;
    if (await action('add-role-emoji', () => addRoleEmoji(detailLocal.value.guild.id, roleEmojiRoleId.value, roleEmojiInput.value)) !== undefined) {
        roleEmojiInput.value = '';
        roleEmojiRoleId.value = '';
    }
}
async function rmRE(emojiChar: string, emojiId: string) {
    await action('rm-role-emoji', () => removeRoleEmoji(detailLocal.value.guild.id, { emojiChar, emojiId }));
}
async function addRRM() {
    if (!roleReceiveChannel.value || !roleReceiveMessage.value) return;
    if (await action('add-rrm', () => addRoleReceiveMessage(detailLocal.value.guild.id, roleReceiveChannel.value, roleReceiveMessage.value)) !== undefined) {
        roleReceiveChannel.value = '';
        roleReceiveMessage.value = '';
    }
}
async function rmRRM(channelId: string, messageId: string) {
    await action('rm-rrm', () => removeRoleReceiveMessage(detailLocal.value.guild.id, channelId, messageId));
}
async function addCap() {
    if (!capabilityName.value.trim() || !capabilityRoleId.value) return;
    if (await action('add-cap', () => addCapabilityGrant(detailLocal.value.guild.id, capabilityName.value.trim(), capabilityRoleId.value)) !== undefined) {
        capabilityName.value = '';
        capabilityRoleId.value = '';
    }
}
async function rmCap(capability: string, roleId: string) {
    await action('rm-cap', () => removeCapabilityGrant(detailLocal.value.guild.id, capability, roleId));
}
</script>

<template>
    <div class="bot-config">
        <p v-if="error" class="error">{{ error }}</p>

        <!-- Todo ─────────────────────────────────────────── -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.todoTitle') }}
                    <span class="count-pill">{{ detailLocal.todoChannels.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.todoHint') }}</p>
            <ul v-if="detailLocal.todoChannels.length" class="bare">
                <li v-for="c in detailLocal.todoChannels" :key="c.channelId" class="row">
                    <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                    <button type="button" class="ghost danger small" @click="rmTodo(c.channelId)">{{ $t('guilds.feature.removeBtn') }}</button>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
            <div class="form-row">
                <AppSelectField
                    v-model="todoChannel"
                    :options="channelPickerOptions"
                    :placeholder="$t('guilds.feature.channelPlaceholder')"
                    :drawer-title="$t('guilds.feature.todoTitle')"
                />
                <button type="button" class="primary" :disabled="!todoChannel" @click="addTodo">{{ $t('guilds.feature.addBtn') }}</button>
            </div>
        </section>

        <!-- Picture-only ────────────────────────────────── -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.pictureTitle') }}
                    <span class="count-pill">{{ detailLocal.pictureOnlyChannels.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.pictureHint') }}</p>
            <ul v-if="detailLocal.pictureOnlyChannels.length" class="bare">
                <li v-for="c in detailLocal.pictureOnlyChannels" :key="c.channelId" class="row">
                    <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                    <button type="button" class="ghost danger small" @click="rmPicture(c.channelId)">{{ $t('guilds.feature.removeBtn') }}</button>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
            <div class="form-row">
                <AppSelectField
                    v-model="pictureChannel"
                    :options="channelPickerOptions"
                    :placeholder="$t('guilds.feature.channelPlaceholder')"
                    :drawer-title="$t('guilds.feature.pictureTitle')"
                />
                <button type="button" class="primary" :disabled="!pictureChannel" @click="addPicture">{{ $t('guilds.feature.addBtn') }}</button>
            </div>
        </section>

        <!-- RCON ────────────────────────────────────────── -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.rconTitle') }}
                    <span class="count-pill">{{ detailLocal.rconForwardChannels.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.rconHint') }}</p>
            <ul v-if="detailLocal.rconForwardChannels.length" class="bare">
                <li v-for="c in detailLocal.rconForwardChannels" :key="c.channelId" class="row">
                    <div class="row-meta">
                        <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                        <span class="muted small"> {{ $t('guilds.rconTarget', { host: c.host ?? '—', port: c.port ?? '—', cmd: c.commandPrefix, trigger: c.triggerPrefix }) }}</span>
                    </div>
                    <button type="button" class="ghost danger small" @click="rmRcon(c.channelId)">{{ $t('guilds.feature.removeBtn') }}</button>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
            <div class="form-grid">
                <div class="span-2">
                    <AppSelectField
                        v-model="rconChannel"
                        :options="channelPickerOptions"
                        :placeholder="$t('guilds.feature.channelPlaceholder')"
                        :drawer-title="$t('guilds.feature.rconTitle')"
                    />
                </div>
                <input v-model="rconHost" type="text" :placeholder="$t('guilds.feature.host')" />
                <input v-model="rconPort" type="number" :placeholder="$t('guilds.feature.port')" />
                <input v-model="rconPassword" type="password" :placeholder="$t('guilds.feature.password')" />
                <input v-model="rconCmdPrefix" type="text" :placeholder="$t('guilds.feature.commandPrefix')" />
                <input v-model="rconTriggerPrefix" type="text" :placeholder="$t('guilds.feature.triggerPrefix')" />
                <button type="button" class="primary span-2" :disabled="!rconChannel" @click="saveRcon">{{ $t('guilds.feature.saveBtn') }}</button>
            </div>
        </section>

        <!-- Role-emoji ──────────────────────────────────── -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.roleEmojiTitle') }}
                    <span class="count-pill">{{ detailLocal.roleEmojis.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.roleEmojiHint') }}</p>
            <ul v-if="detailLocal.roleEmojis.length" class="bare">
                <li v-for="(r, idx) in detailLocal.roleEmojis" :key="idx" class="row">
                    <div class="row-meta">
                        <img v-if="r.emojiId" :src="customEmojiUrl(r.emojiId)" :alt="r.emojiName" class="emoji" />
                        <span v-else class="emoji-fallback">{{ r.emojiChar }}</span>
                        <span> → @{{ r.roleName ?? r.roleId }}</span>
                    </div>
                    <button type="button" class="ghost danger small" @click="rmRE(r.emojiChar, r.emojiId)">{{ $t('guilds.feature.removeBtn') }}</button>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
            <div class="form-grid">
                <AppSelectField
                    v-model="roleEmojiRoleId"
                    :options="rolePickerOptions"
                    :placeholder="$t('guilds.feature.rolePlaceholder')"
                    :drawer-title="$t('guilds.feature.pickRole')"
                />
                <input v-model="roleEmojiInput" type="text" :placeholder="$t('guilds.feature.emoji')" />
                <small class="hint span-2">{{ $t('guilds.feature.emojiHint') }}</small>
                <button type="button" class="primary span-2" :disabled="!roleEmojiRoleId || !roleEmojiInput" @click="addRE">{{ $t('guilds.feature.addBtn') }}</button>
            </div>
        </section>

        <!-- Role-receive ────────────────────────────────── -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.roleReceiveTitle') }}
                    <span class="count-pill">{{ detailLocal.roleReceiveMessages.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.roleReceiveHint') }}</p>
            <ul v-if="detailLocal.roleReceiveMessages.length" class="bare">
                <li v-for="(m, idx) in detailLocal.roleReceiveMessages" :key="idx" class="row">
                    <div class="row-meta">
                        <span class="channel">#{{ m.channelName ?? m.channelId }}</span>
                        <span class="muted small"> {{ $t('guilds.roleReactionMessage', { id: m.messageId }) }}</span>
                    </div>
                    <button type="button" class="ghost danger small" @click="rmRRM(m.channelId, m.messageId)">{{ $t('guilds.feature.removeBtn') }}</button>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
            <div class="form-grid">
                <AppSelectField
                    v-model="roleReceiveChannel"
                    :options="channelPickerOptions"
                    :placeholder="$t('guilds.feature.channelPlaceholder')"
                    :drawer-title="$t('guilds.feature.roleReceiveTitle')"
                />
                <input v-model="roleReceiveMessage" type="text" inputmode="numeric" :placeholder="$t('guilds.feature.messageId')" />
                <button type="button" class="primary span-2" :disabled="!roleReceiveChannel || !roleReceiveMessage" @click="addRRM">{{ $t('guilds.feature.addBtn') }}</button>
            </div>
        </section>

        <!-- Capability grants ──────────────────────────── -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.capabilityTitle') }}
                    <span class="count-pill">{{ detailLocal.capabilityGrants.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.capabilityHint') }}</p>
            <ul v-if="detailLocal.capabilityGrants.length" class="bare">
                <li v-for="(g, idx) in detailLocal.capabilityGrants" :key="idx" class="row">
                    <div class="row-meta">
                        <span class="capability">{{ g.capability }}</span>
                        <span class="muted">·</span>
                        <span :style="g.roleColor ? { color: g.roleColor } : undefined">@{{ g.roleName ?? g.roleId }}</span>
                    </div>
                    <button type="button" class="ghost danger small" @click="rmCap(g.capability, g.roleId)">{{ $t('guilds.feature.removeBtn') }}</button>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
            <div class="form-grid">
                <input v-model="capabilityName" type="text" list="cap-suggest" :placeholder="$t('guilds.feature.capabilityPlaceholder')" />
                <datalist id="cap-suggest">
                    <option value="todo.manage" />
                    <option value="picture-only.manage" />
                    <option value="rcon.configure" />
                    <option value="role-emoji.manage" />
                </datalist>
                <AppSelectField
                    v-model="capabilityRoleId"
                    :options="rolePickerOptions"
                    :placeholder="$t('guilds.feature.rolePlaceholder')"
                    :drawer-title="$t('guilds.feature.pickRole')"
                />
                <button type="button" class="primary span-2" :disabled="!capabilityName.trim() || !capabilityRoleId" @click="addCap">{{ $t('guilds.feature.addBtn') }}</button>
            </div>
        </section>

        <!-- Channel reference for the "all text channels" computed; the UI
             doesn't actually use it directly but keeping the hook lets a
             follow-up patch surface a "validate channel id" indicator. -->
        <span v-if="false">{{ allTextChannels.length }}</span>
    </div>
</template>

<style scoped>
.bot-config {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 0.7rem;
}
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.card-head h3 {
    margin: 0;
    font-size: 0.92rem;
    color: var(--text-strong);
    display: flex;
    align-items: center;
    gap: 0.45rem;
}
.count-pill {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.78rem;
    font-weight: 500;
}
.hint { margin: 0; color: var(--text-muted); font-size: 0.78rem; }
.bare {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
}
.row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    justify-content: space-between;
    padding: 0.25rem 0;
    border-bottom: 1px dashed var(--border);
}
.row:last-child { border-bottom: none; }
.row-meta { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; min-width: 0; }
.channel { font-weight: 500; color: var(--text); }
.capability {
    font-family: ui-monospace, SFMono-Regular, monospace;
    background: var(--bg-surface-2);
    padding: 0 0.35rem;
    border-radius: 3px;
    font-size: 0.78rem;
}
.emoji { width: 18px; height: 18px; object-fit: contain; }
.emoji-fallback { font-size: 1.05rem; line-height: 1; }
.muted { color: var(--text-muted); }
.small { font-size: 0.78rem; }
.form-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.3rem;
}
.form-row select { flex: 1; }
.form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
    margin-top: 0.3rem;
}
.span-2 { grid-column: 1 / -1; }
input,
select {
    padding: 0.35rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    min-width: 0;
}
.ghost,
.primary {
    border-radius: 4px;
    padding: 0.3rem 0.7rem;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    border: 1px solid var(--border);
}
.ghost { background: none; color: var(--text); }
.ghost:hover { background: var(--bg-surface-hover); }
.ghost.danger { color: var(--danger); border-color: rgba(239, 68, 68, 0.45); }
.ghost.danger:hover { background: rgba(239, 68, 68, 0.1); }
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border-color: var(--accent);
}
.primary:disabled { opacity: 0.5; cursor: default; }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 4px;
    padding: 0.4rem 0.55rem;
    font-size: 0.82rem;
    margin: 0;
    grid-column: 1 / -1;
}
</style>
