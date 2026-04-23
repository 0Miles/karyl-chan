<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { isAuthenticated } from './auth';
import { logout } from './api/client';
import { provideAppShell } from './composables/use-app-shell';
import { useBreakpoint } from './composables/use-breakpoint';
import { useDrawer } from './composables/use-drawer';
import Draggable from './components/Draggable.vue';

const router = useRouter();
const { overlayOpen, openOverlay, closeOverlay, flushMain, hasExtras, overlayView, toggleOverlayView } = provideAppShell();
const { isMobile } = useBreakpoint();

const drawerOpen = computed(() => isMobile.value && overlayOpen.value);
const { placement, backdropClass, panelClass, backdropTransition, panelTransition } = useDrawer({
    visible: drawerOpen,
    placement: 'left',
    onClose: closeOverlay
});

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
            <div class="brand">{{ $t('app.brand') }}</div>
            <nav class="desktop-nav">
                <template v-if="isAuthenticated">
                    <RouterLink to="/">{{ $t('app.nav.dashboard') }}</RouterLink>
                    <RouterLink to="/messages">{{ $t('app.nav.messages') }}</RouterLink>
                    <RouterLink to="/guilds">{{ $t('app.nav.guilds') }}</RouterLink>
                    <RouterLink to="/admin/users">{{ $t('app.nav.admin') }}</RouterLink>
                    <button type="button" class="link-button" @click="signOut">{{ $t('app.nav.signOut') }}</button>
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
                :aria-label="$t('app.mobile.openMenu')"
                @click="openOverlay"
            >
                <Icon icon="material-symbols:menu-rounded" width="24" height="24" />
            </button>
        </Draggable>

        <Transition :name="backdropTransition">
            <div
                v-if="drawerOpen"
                :class="backdropClass"
                @click="closeOverlay"
            />
        </Transition>
        <!-- Panel uses v-show so #mobile-nav-extras stays mounted as a teleport target. -->
        <Transition :name="panelTransition">
            <div
                v-show="drawerOpen"
                :class="[panelClass, 'mobile-overlay']"
                :data-placement="placement"
                role="dialog"
                aria-modal="true"
            >
                <header class="mobile-overlay-header">
                    <button type="button" class="overlay-back" @click="closeOverlay" :aria-label="$t('app.mobile.closeMenu')">
                        <Icon icon="material-symbols:chevron-left-rounded" width="20" height="20" />
                        <span>{{ $t('app.mobile.back') }}</span>
                    </button>
                    <button
                        v-if="hasExtras"
                        type="button"
                        class="overlay-toggle"
                        :aria-label="overlayView === 'nav' ? $t('app.mobile.showFeatures') : $t('app.mobile.showNav')"
                        @click="toggleOverlayView"
                    >
                        <Icon
                            :icon="overlayView === 'nav' ? 'material-symbols:view-sidebar-rounded' : 'material-symbols:menu-rounded'"
                            width="20"
                            height="20"
                        />
                    </button>
                </header>
                <nav v-show="overlayView === 'nav'" class="mobile-overlay-nav">
                    <template v-if="isAuthenticated">
                        <RouterLink to="/" @click="navigate">{{ $t('app.nav.dashboard') }}</RouterLink>
                        <RouterLink to="/messages" @click="navigate">{{ $t('app.nav.messages') }}</RouterLink>
                        <RouterLink to="/guilds" @click="navigate">{{ $t('app.nav.guilds') }}</RouterLink>
                        <RouterLink to="/admin/users" @click="navigate">{{ $t('app.nav.admin') }}</RouterLink>
                        <button type="button" class="link-button" @click="signOut">{{ $t('app.nav.signOut') }}</button>
                    </template>
                </nav>
                <div
                    id="mobile-nav-extras"
                    class="mobile-overlay-extras"
                    :style="{ display: overlayView === 'extras' ? 'flex' : 'none' }"
                ></div>
            </div>
        </Transition>
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
    left: 1rem;
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

/* Drawer base styles come from useDrawer; mobile-overlay adds size/chrome. */
.mobile-overlay {
    background: var(--bg-page);
    width: min(85vw, 360px);
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.18);
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
