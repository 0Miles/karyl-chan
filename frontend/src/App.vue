<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { isAuthenticated } from './auth';
import { logout } from './api/client';
import { provideAppShell } from './composables/use-app-shell';
import { useBreakpoint } from './composables/use-breakpoint';
import Draggable from './components/Draggable.vue';

const router = useRouter();
const { overlayOpen, openOverlay, closeOverlay, flushMain, hasExtras, overlayView, toggleOverlayView } = provideAppShell();
const { isMobile } = useBreakpoint();

const dragBounds = ref<HTMLElement | null>(null);
onMounted(() => {
    dragBounds.value = document.documentElement;
});

async function signOut() {
    closeOverlay();
    await logout();
    router.replace({ name: 'auth' });
}

function navigate() {
    closeOverlay();
}
</script>

<template>
    <div class="app-shell">
        <header class="app-header">
            <div class="brand">Karyl Chan</div>
            <nav class="desktop-nav">
                <template v-if="isAuthenticated">
                    <RouterLink to="/">Dashboard</RouterLink>
                    <RouterLink to="/messages">Messages</RouterLink>
                    <RouterLink to="/guilds">Guilds</RouterLink>
                    <button type="button" class="link-button" @click="signOut">Sign out</button>
                </template>
            </nav>
        </header>
        <main class="app-main" :class="{ 'app-main--flush': flushMain }">
            <RouterView />
        </main>

        <Draggable
            v-show="isAuthenticated && isMobile && !overlayOpen"
            :bounds="dragBounds"
            :boundary-padding="8"
            class="mobile-fab-wrap"
        >
            <button
                type="button"
                class="mobile-fab"
                aria-label="Open menu"
                @click="openOverlay"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <line x1="4" y1="7" x2="20" y2="7" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="17" x2="20" y2="17" />
                </svg>
            </button>
        </Draggable>

        <div
            v-show="isMobile && overlayOpen"
            class="mobile-overlay"
            role="dialog"
            aria-modal="true"
        >
            <header class="mobile-overlay-header">
                <button type="button" class="overlay-back" @click="closeOverlay" aria-label="Close menu">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    <span>Back</span>
                </button>
                <button
                    v-if="hasExtras"
                    type="button"
                    class="overlay-toggle"
                    :aria-label="overlayView === 'nav' ? 'Show page features' : 'Show navigation'"
                    @click="toggleOverlayView"
                >
                    <!-- nav view → show "features" icon to indicate switching to extras -->
                    <svg v-if="overlayView === 'nav'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                    </svg>
                    <!-- extras view → show "menu" icon to indicate switching to nav -->
                    <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <line x1="4" y1="7" x2="20" y2="7" />
                        <line x1="4" y1="12" x2="20" y2="12" />
                        <line x1="4" y1="17" x2="20" y2="17" />
                    </svg>
                </button>
            </header>
            <nav v-show="overlayView === 'nav'" class="mobile-overlay-nav">
                <template v-if="isAuthenticated">
                    <RouterLink to="/" @click="navigate">Dashboard</RouterLink>
                    <RouterLink to="/messages" @click="navigate">Messages</RouterLink>
                    <RouterLink to="/guilds" @click="navigate">Guilds</RouterLink>
                    <button type="button" class="link-button" @click="signOut">Sign out</button>
                </template>
            </nav>
            <div
                id="mobile-nav-extras"
                class="mobile-overlay-extras"
                :style="{ display: overlayView === 'extras' ? 'flex' : 'none' }"
            ></div>
        </div>
    </div>
</template>

<style scoped>
.app-shell {
    height: 100%;
    display: flex;
    flex-direction: column;
}
.app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    background: var(--bg-header);
    color: var(--text-on-header);
    flex-shrink: 0;
}
.brand {
    font-weight: 600;
    letter-spacing: 0.05em;
}
.desktop-nav {
    display: flex;
    gap: 1rem;
}
.desktop-nav a {
    color: var(--text-on-header-muted);
    text-decoration: none;
}
.desktop-nav a.router-link-active {
    color: var(--text-on-header);
    font-weight: 500;
}
.link-button {
    background: none;
    border: none;
    color: var(--text-on-header-muted);
    cursor: pointer;
    font: inherit;
    padding: 0;
}
.link-button:hover {
    color: var(--text-on-header);
}
.app-main {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 1.5rem;
    background: var(--bg-page);
}

.mobile-fab-wrap {
    position: fixed;
    right: 1rem;
    top: 1rem;
    z-index: 40;
    display: none;
}
.mobile-fab {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    padding: 0;
}
.mobile-fab:active { transform: scale(0.96); }

.mobile-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-page);
    z-index: 50;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.mobile-overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
    flex-shrink: 0;
}
.overlay-back {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    padding: 0.3rem 0.4rem;
    border-radius: 4px;
}
.overlay-back:hover { background: var(--bg-surface-hover); }
.overlay-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    cursor: pointer;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    padding: 0;
    transition: background 0.15s;
}
.overlay-toggle:hover { background: var(--bg-surface-hover); }
.overlay-toggle:active { background: var(--bg-surface-active); }
.mobile-overlay-nav {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.mobile-overlay-nav a,
.mobile-overlay-nav .link-button {
    padding: 0.85rem 1.25rem;
    color: var(--text);
    text-decoration: none;
    font-size: 0.95rem;
    border-left: 3px solid transparent;
    text-align: left;
}
.mobile-overlay-nav a.router-link-active {
    color: var(--accent-text, var(--text-strong));
    border-left-color: var(--accent);
    background: var(--bg-surface-2);
    font-weight: 500;
}
.mobile-overlay-nav a:hover,
.mobile-overlay-nav .link-button:hover {
    background: var(--bg-surface-hover);
}
.mobile-overlay-extras {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

@media (max-width: 768px) {
    .app-header { display: none; }
    .mobile-fab-wrap { display: block; }
    .app-main { padding: 1rem; }
    .app-main.app-main--flush {
        padding: 0;
        overflow: hidden;
    }
}
</style>
