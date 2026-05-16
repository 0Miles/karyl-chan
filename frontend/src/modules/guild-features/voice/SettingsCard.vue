<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { GuildDetail } from "../../../api/guilds";

defineProps<{ detail: GuildDetail }>();
const { t } = useI18n();
</script>

<template>
    <section class="card">
        <header class="card-head">
            <h3>{{ t('voice.title') }}</h3>
        </header>
        <p class="card-body">
            {{ t('voice.description') }}
            <br /><br />
            <strong>{{ t('voice.builtinCommands') }}</strong>
        </p>
        <ul class="card-body">
            <li><code>/voice join</code> — {{ t('voice.cmdJoin') }}</li>
            <li><code>/voice play &lt;url&gt;</code> — {{ t('voice.cmdPlay') }}</li>
            <li><code>/voice stop</code> — {{ t('voice.cmdStop') }}</li>
            <li><code>/voice leave</code> — {{ t('voice.cmdLeave') }}</li>
            <li><code>/voice status</code> — {{ t('voice.cmdStatus') }}</li>
        </ul>
    </section>
</template>

<style scoped src="../_shared/card.css"></style>

<style scoped>
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
