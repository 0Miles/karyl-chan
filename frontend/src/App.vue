<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import { isAuthenticated } from './auth';
import { logout } from './api/client';
import { provideAppShell } from './composables/use-app-shell';
import { useBreakpoint } from './composables/use-breakpoint';
import { useDrawer } from './composables/use-drawer';
import { useCurrentUserStore } from './stores/currentUserStore';
import { useDmStore } from './modules/discord-chat/stores/dmStore';
import { useGuildChannelStore } from './modules/discord-chat/stores/guildChannelStore';
import { useUnreadStore } from './modules/discord-chat/stores/unreadStore';
import { useMuteStore } from './modules/discord-chat/stores/muteStore';
import Draggable from './components/Draggable.vue';
import AppMenu from './components/AppMenu.vue';
import AppMenuItem from './components/AppMenuItem.vue';
import QuickSwitcher from './components/QuickSwitcher.vue';

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const { overlayOpen, openOverlay, closeOverlay, flushMain, hasExtras, overlayView, toggleOverlayView } = provideAppShell();
const { isMobile } = useBreakpoint();
const currentUser = useCurrentUserStore();
const dmStore = useDmStore();
const guildStore = useGuildChannelStore();
const unreadStore = useUnreadStore();
const muteStore = useMuteStore();

// Subscribe to both SSE streams whenever we're authenticated so the nav
// unread dot tracks new messages even when the user is not on the
// messages page. `startSSE` is idempotent.
function ensureUnreadSSE() {
    if (!isAuthenticated.value) return;
    dmStore.startSSE();
    guildStore.startSSE();
}

// Keep the nav avatar in sync with the session: reload on login, clear on
// logout, refresh once on cold mount if we already hold tokens.
watch(() => isAuthenticated.value, (authed) => {
    if (authed) {
        void currentUser.refresh();
        ensureUnreadSSE();
    } else {
        currentUser.clear();
    }
});

const displayName = computed(() =>
    currentUser.user?.profile?.globalName
    ?? currentUser.user?.profile?.username
    ?? t('admin.users.unknownProfile')
);
// Hide the "Admin access" nav entry for users whose capability set
// doesn't include admin — the page itself renders a 403 anyway, but
// pointing at a door you can't open is bad UX.
const canOpenAdminPanel = computed(() => currentUser.user?.capabilities.includes('admin') ?? false);
const avatarUrl = computed(() => currentUser.user?.profile?.avatarUrl ?? null);
const avatarInitial = computed(() => {
    const name = currentUser.user?.profile?.globalName
        ?? currentUser.user?.profile?.username
        ?? currentUser.user?.userId
        ?? '';
    return name.trim().charAt(0).toUpperCase() || '?';
});

async function goProfile() {
    await router.push({ name: 'profile' });
    closeOverlay();
}

// Public routes (meta.publicPage) render standalone — no brand header, no
// mobile nav drawer, no FAB. Admin routes render the full shell.
const showShell = computed(() => !route.meta.publicPage);
const drawerOpen = computed(() => showShell.value && isMobile.value && overlayOpen.value);
const { placement, backdropClass, panelClass, backdropTransition, panelTransition } = useDrawer({
    visible: drawerOpen,
    placement: 'left',
    onClose: closeOverlay
});

const dragBounds = ref<HTMLElement | null>(null);
onMounted(() => {
    dragBounds.value = document.documentElement;
    if (isAuthenticated.value && !currentUser.user) void currentUser.refresh();
    ensureUnreadSSE();
    window.addEventListener('keydown', onGlobalKeydown);
});

onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown));

// Cmd/Ctrl+K opens the quick switcher. Bound at window level so the
// shortcut works from any page; ignored when the user is typing into
// a text input or the contenteditable composer (the OS native "find"
// dialog isn't a thing here, so the lack of override is fine).
const quickSwitcherOpen = ref(false);
function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
function onGlobalKeydown(event: KeyboardEvent) {
    if (!isAuthenticated.value) return;
    if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        // Even when focus is inside an input, override — Discord's
        // Cmd+K is universal, and the user expects it to win over the
        // text field. Browser default for Cmd+K is "open URL bar with
        // search" which we don't want either.
        event.preventDefault();
        quickSwitcherOpen.value = true;
    }
}
// Pull `void` to silence "isEditableTarget unused" until we extend
// the handler to honour text-edit-only shortcuts in future tasks.
void isEditableTarget;

async function signOut() {
    closeOverlay();
    // Tear down live streams BEFORE the auth token is revoked so the server
    // sees a clean disconnect rather than a 401-on-next-event. Resetting
    // also clears cached channel/guild data so a re-login starts fresh.
    dmStore.reset();
    guildStore.reset();
    await logout();
    unreadStore.clear();
    muteStore.clear();
    router.replace({ name: 'auth' });
}

function navigate() {
    closeOverlay();
}
</script>

<template>
    <div class="app-shell" :class="{ 'app-shell--public': !showShell }">
        <header v-if="showShell" class="app-header">
            <div class="brand">{{ $t('app.brand') }}</div>
            <nav class="desktop-nav">
                <template v-if="isAuthenticated">
                    <RouterLink to="/admin">{{ $t('app.nav.dashboard') }}</RouterLink>
                    <RouterLink to="/admin/messages" class="nav-with-dot">
                        {{ $t('app.nav.messages') }}
                        <span v-if="unreadStore.hasAttention" class="nav-dot" aria-hidden="true"></span>
                    </RouterLink>
                    <RouterLink to="/admin/guilds">{{ $t('app.nav.guilds') }}</RouterLink>
                    <RouterLink v-if="canOpenAdminPanel" to="/admin/users">{{ $t('app.nav.admin') }}</RouterLink>
                    <AppMenu placement="bottom-end" :offset="[0, 10]">
                        <template #trigger>
                            <button
                                type="button"
                                class="avatar-button"
                                :aria-label="$t('app.nav.accountMenu')"
                                :title="displayName"
                            >
                                <img v-if="avatarUrl" :src="avatarUrl" alt="" class="avatar-img" />
                                <span v-else class="avatar-img avatar-fallback">{{ avatarInitial }}</span>
                            </button>
                        </template>
                        <AppMenuItem @click="goProfile">
                            <Icon icon="material-symbols:person-rounded" width="18" height="18" />
                            {{ $t('app.nav.profile') }}
                        </AppMenuItem>
                        <AppMenuItem danger @click="signOut">
                            <Icon icon="material-symbols:logout-rounded" width="18" height="18" />
                            {{ $t('app.nav.signOut') }}
                        </AppMenuItem>
                    </AppMenu>
                </template>
            </nav>
        </header>
        <main class="app-main" :class="{ 'app-main--flush': flushMain }">
            <RouterView />
        </main>

        <Draggable
            v-show="showShell && isAuthenticated && isMobile && !overlayOpen"
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
                        <RouterLink to="/admin" @click="navigate">{{ $t('app.nav.dashboard') }}</RouterLink>
                        <RouterLink to="/admin/messages" class="nav-with-dot" @click="navigate">
                            {{ $t('app.nav.messages') }}
                            <span v-if="unreadStore.hasAttention" class="nav-dot" aria-hidden="true"></span>
                        </RouterLink>
                        <RouterLink to="/admin/guilds" @click="navigate">{{ $t('app.nav.guilds') }}</RouterLink>
                        <RouterLink v-if="canOpenAdminPanel" to="/admin/users" @click="navigate">{{ $t('app.nav.admin') }}</RouterLink>
                        <RouterLink to="/admin/profile" @click="navigate">{{ $t('app.nav.profile') }}</RouterLink>
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
        <QuickSwitcher :visible="quickSwitcherOpen" @close="quickSwitcherOpen = false" />
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
.nav-with-dot {
    position: relative;
    display: inline-flex;
    align-items: center;
}
.nav-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--unread-accent, #f23f43);
    margin-left: 0.35rem;
    flex-shrink: 0;
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
.avatar-button {
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid transparent;
    background: none;
    cursor: pointer;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.avatar-button:hover { border-color: var(--text-on-header); }
.avatar-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}
.avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
    display: block;
}
.avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: 0.85rem;
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
