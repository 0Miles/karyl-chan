<script setup lang="ts">
import type { GuildDetail } from "../../../api/guilds";

defineProps<{ detail: GuildDetail }>();
</script>

<template>
    <section class="card">
        <header class="card-head">
            <h3>語音播放</h3>
        </header>
        <p class="card-body">
            開啟後,公會成員可在語音頻道中使用 bot 的語音功能(如 <code>/voice</code>
            指令或外部 plugin 的播放控制)。
            <br /><br />
            <strong>內建指令:</strong>
        </p>
        <ul class="card-body">
            <li><code>/voice join</code> — 讓 bot 加入你目前所在的語音頻道</li>
            <li><code>/voice play &lt;url&gt;</code> — 播放音訊 URL(http/https)</li>
            <li><code>/voice stop</code> — 停止當前播放</li>
            <li><code>/voice leave</code> — 離開語音頻道</li>
            <li><code>/voice status</code> — 查看 bot 語音狀態</li>
        </ul>
    </section>
</template>

<style scoped>
@import "../_shared/card.css";

.card-body {
    padding: 0.5rem 1rem 1rem;
    line-height: 1.6;
}

.card-body li {
    margin: 0.25rem 0;
}

code {
    background: var(--surface-2, rgba(0, 0, 0, 0.05));
    padding: 0.1em 0.4em;
    border-radius: 0.25em;
}
</style>
