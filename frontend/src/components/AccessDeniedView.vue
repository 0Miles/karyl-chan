<script setup lang="ts">
// Tiny shared "you don't have permission" panel. Pages render it when
// their last API call returned 403 (see composables/use-api-error.ts).
// Kept as a component instead of an inline block so the wording, i18n
// keys, and styling stay aligned across every admin surface.
</script>

<template>
    <div class="access-denied">
        <h2>{{ $t('admin.accessDenied.title') }}</h2>
        <p class="muted">{{ $t('admin.accessDenied.body') }}</p>
    </div>
</template>

<style scoped>
.access-denied {
    text-align: center;
    padding: 3rem 1rem;
}
.access-denied h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
}
.muted {
    color: var(--text-muted);
}
</style>
