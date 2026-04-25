<script setup lang="ts">
import type { GuildDetail } from '../../../../api/guilds';

defineProps<{
    detail: GuildDetail;
}>();

function customEmojiUrl(id: string, char: string): string {
    if (id) return `https://cdn.discordapp.com/emojis/${id}.webp?size=32&quality=lossless`;
    return char;
}
</script>

<template>
    <div class="bot-config">
        <section class="card">
            <h3>{{ $t('guilds.todoChannels') }} <span class="count-pill">{{ detail.todoChannels.length }}</span></h3>
            <ul v-if="detail.todoChannels.length" class="bare">
                <li v-for="c in detail.todoChannels" :key="c.channelId">
                    <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('common.none') }}</p>
        </section>

        <section class="card">
            <h3>{{ $t('guilds.pictureOnly') }} <span class="count-pill">{{ detail.pictureOnlyChannels.length }}</span></h3>
            <ul v-if="detail.pictureOnlyChannels.length" class="bare">
                <li v-for="c in detail.pictureOnlyChannels" :key="c.channelId">
                    <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('common.none') }}</p>
        </section>

        <section class="card">
            <h3>{{ $t('guilds.rconForward') }} <span class="count-pill">{{ detail.rconForwardChannels.length }}</span></h3>
            <ul v-if="detail.rconForwardChannels.length" class="bare">
                <li v-for="c in detail.rconForwardChannels" :key="c.channelId">
                    <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                    <span class="muted small"> {{ $t('guilds.rconTarget', { host: c.host ?? '—', port: c.port ?? '—', cmd: c.commandPrefix, trigger: c.triggerPrefix }) }}</span>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('common.none') }}</p>
        </section>

        <section class="card">
            <h3>{{ $t('guilds.roleEmoji') }} <span class="count-pill">{{ detail.roleEmojis.length }}</span></h3>
            <ul v-if="detail.roleEmojis.length" class="bare">
                <li v-for="(r, idx) in detail.roleEmojis" :key="idx" class="row">
                    <img v-if="r.emojiId" :src="customEmojiUrl(r.emojiId, r.emojiChar)" :alt="r.emojiName" class="emoji" />
                    <span v-else class="emoji-fallback">{{ r.emojiChar }}</span>
                    <span> → @{{ r.roleName ?? r.roleId }}</span>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('common.none') }}</p>
        </section>

        <section class="card">
            <h3>{{ $t('guilds.roleReactions') }} <span class="count-pill">{{ detail.roleReceiveMessages.length }}</span></h3>
            <ul v-if="detail.roleReceiveMessages.length" class="bare">
                <li v-for="(m, idx) in detail.roleReceiveMessages" :key="idx">
                    <span class="channel">#{{ m.channelName ?? m.channelId }}</span>
                    <span class="muted small"> {{ $t('guilds.roleReactionMessage', { id: m.messageId }) }}</span>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('common.none') }}</p>
        </section>

        <section class="card">
            <h3>{{ $t('guilds.capabilityGrants') }} <span class="count-pill">{{ detail.capabilityGrants.length }}</span></h3>
            <ul v-if="detail.capabilityGrants.length" class="bare">
                <li v-for="(g, idx) in detail.capabilityGrants" :key="idx" class="row">
                    <span class="capability">{{ g.capability }}</span>
                    <span class="muted">·</span>
                    <span :style="g.roleColor ? { color: g.roleColor } : undefined">@{{ g.roleName ?? g.roleId }}</span>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('common.none') }}</p>
        </section>
    </div>
</template>

<style scoped>
.bot-config {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0.7rem;
}
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}
.card h3 {
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
.bare {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.85rem;
}
.row { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.channel { font-weight: 500; color: var(--text); }
.capability {
    font-family: ui-monospace, SFMono-Regular, monospace;
    background: var(--bg-surface-2);
    padding: 0 0.35rem;
    border-radius: 3px;
    font-size: 0.78rem;
}
.emoji {
    width: 18px;
    height: 18px;
    object-fit: contain;
}
.emoji-fallback { font-size: 1.05rem; line-height: 1; }
.small { font-size: 0.78rem; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
</style>
