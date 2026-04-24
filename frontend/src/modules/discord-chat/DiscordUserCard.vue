<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { ApiError } from '../../api/client';
import { startChannel as startDmChannel } from '../../api/dm';
import { useUserProfileStore, type DiscordUserView } from './stores/userProfileStore';

const props = defineProps<{
    userId: string;
    guildId?: string | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
}>();

const router = useRouter();
const { t } = useI18n();
const store = useUserProfileStore();

// Seed synchronously from cache so reopening a recently-viewed card
// flashes content immediately instead of a loading spinner.
const data = ref<DiscordUserView | null>(
    store.readCached(props.userId, props.guildId ?? null)
);
const loading = ref(!data.value);
const error = ref<string | null>(null);

async function load() {
    loading.value = !data.value;
    error.value = null;
    try {
        data.value = await store.fetchUser(props.userId, props.guildId ?? null);
    } catch (err) {
        error.value = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Failed to load');
    } finally {
        loading.value = false;
    }
}

onMounted(load);
// Re-fetch if the card is reused for a different user (popover instance
// persists even as `target.userId` changes).
watch(() => [props.userId, props.guildId] as const, load);

const displayName = computed(() =>
    data.value?.user.globalName ?? data.value?.user.username ?? props.userId
);
const initial = computed(() => (displayName.value || props.userId).trim().charAt(0).toUpperCase() || '?');

const bannerStyle = computed(() => {
    const url = data.value?.user.bannerUrl;
    if (url) return { backgroundImage: `url(${url})` };
    const accent = data.value?.user.accentColor;
    if (typeof accent === 'number') {
        return { backgroundColor: `#${accent.toString(16).padStart(6, '0')}` };
    }
    return { backgroundColor: 'var(--accent)' };
});

// ── Send DM ────────────────────────────────────────────────────────
//
// Creates (or fetches) the DM channel with this user and navigates to
// the messages page with `?channel=<id>` so DmWorkspace can open it
// directly. We close the card before navigating so it doesn't linger
// over the route transition.

const startingDm = ref(false);
async function sendDm() {
    if (startingDm.value || !data.value) return;
    startingDm.value = true;
    try {
        const channel = await startDmChannel(props.userId);
        emit('close');
        await router.push({ name: 'messages', query: { channel: channel.id } });
    } catch (err) {
        error.value = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Failed to open DM');
    } finally {
        startingDm.value = false;
    }
}
</script>

<template>
    <div class="user-card">
        <div class="banner" :style="bannerStyle"></div>
        <div class="avatar-wrap">
            <img
                v-if="data?.user.avatarUrl"
                :src="data.user.avatarUrl"
                alt=""
                class="avatar"
            />
            <div v-else class="avatar avatar-fallback">{{ initial }}</div>
        </div>

        <div class="body">
            <p v-if="loading && !data" class="muted">{{ $t('common.loading') }}</p>
            <p v-else-if="error" class="error">{{ error }}</p>

            <template v-if="data">
                <div class="headline">
                    <span class="display-name">{{ displayName }}</span>
                    <span v-if="data.user.bot" class="bot-tag">BOT</span>
                </div>
                <div v-if="data.member?.nickname" class="nickname">{{ data.member.nickname }}</div>
                <div class="tagline">
                    <span class="tag">@{{ data.user.username }}<span v-if="data.user.discriminator">#{{ data.user.discriminator }}</span></span>
                </div>
                <dl class="facts">
                    <dt>{{ $t('userCard.id') }}</dt>
                    <dd><code>{{ data.user.id }}</code></dd>
                    <template v-if="data.member">
                        <dt>{{ $t('userCard.roles') }}</dt>
                        <dd class="roles">
                            <span v-if="data.member.roles.length === 0" class="muted">—</span>
                            <span
                                v-for="role in data.member.roles"
                                :key="role.id"
                                class="role-chip"
                                :style="role.color ? { borderColor: role.color, color: role.color } : undefined"
                            >{{ role.name }}</span>
                        </dd>
                    </template>
                </dl>
                <button
                    type="button"
                    class="dm-button"
                    :disabled="startingDm"
                    @click="sendDm"
                >
                    <Icon icon="material-symbols:mail-outline-rounded" width="16" height="16" />
                    {{ $t('userCard.sendDm') }}
                </button>
            </template>
        </div>
    </div>
</template>

<style scoped>
.user-card {
    width: 300px;
    max-width: 90vw;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
    overflow: hidden;
}
.banner {
    height: 72px;
    background-size: cover;
    background-position: center;
    background-color: var(--accent);
}
.avatar-wrap {
    position: relative;
    margin-top: -32px;
    margin-left: 14px;
    width: 72px;
    height: 72px;
}
.avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    border: 4px solid var(--bg-surface);
    object-fit: cover;
    background: var(--bg-surface-2);
    display: block;
}
.avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: 1.8rem;
}
.body {
    padding: 0.2rem 0.9rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}
.headline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
}
.display-name {
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--text-strong);
    overflow-wrap: anywhere;
}
.bot-tag {
    background: var(--accent);
    color: var(--text-on-accent);
    font-size: 0.65rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    line-height: 1.2;
}
.nickname {
    color: var(--text);
    font-size: 0.9rem;
    margin-top: -0.2rem;
}
.tagline {
    color: var(--text-muted);
    font-size: 0.85rem;
}
.tag {
    overflow-wrap: anywhere;
}
.facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 0.6rem;
    margin: 0.3rem 0 0;
    font-size: 0.82rem;
}
.facts dt {
    color: var(--text-muted);
    align-self: baseline;
}
.facts dd {
    margin: 0;
    min-width: 0;
}
.facts code {
    font-size: 0.78rem;
    word-break: break-all;
    background: var(--code-bg);
    padding: 0 0.3rem;
    border-radius: 3px;
}
.roles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
}
.role-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.05rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.72rem;
    color: var(--text);
    background: var(--bg-surface-2);
}
.dm-button {
    margin-top: 0.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.45rem 0.9rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-weight: 500;
    font-size: 0.88rem;
}
.dm-button:hover:not(:disabled) {
    filter: brightness(1.08);
}
.dm-button:disabled {
    opacity: 0.5;
    cursor: default;
}
.muted {
    color: var(--text-muted);
    margin: 0.5rem 0;
    font-size: 0.9rem;
}
.error {
    color: var(--danger);
    margin: 0.5rem 0;
    font-size: 0.85rem;
}
</style>
