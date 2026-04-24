import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { createActor, type Actor } from 'xstate';
import { workspaceMachine, type WorkspaceContext } from './workspace-machine';

/**
 * Reactive wrapper around the workspace lifecycle machine. Everything
 * that used to be scattered across ad-hoc `watch()` calls — auto-pick,
 * ensureMembers kick-off, scroll retry, cancellation on guild switch —
 * now lives inside `workspaceMachine`. This composable only bridges
 * Vue reactivity onto the machine: external refs become events, and
 * machine context gets mirrored back into refs for the UI.
 */

export interface UseWorkspaceOptions {
    /** `null` for DM surfaces, the guild id otherwise. Reactive. */
    guildId: Ref<string | null>;
    /** Channel ids currently available in this surface. Reactive. */
    availableChannelIds: Ref<string[]>;
    /** Look up the last-viewed channel id for a surface (localStorage). */
    readLastChannel: (guildId: string | null) => string | null;
    /** Fired on every successful channel commit (save localStorage, ensureMembers, write URL, …). */
    onChannelCommitted: (guildId: string | null, channelId: string) => void;
    /** Fired when a pending scroll either landed or gave up. Caller uses it to clear `?scrollTo=`. */
    onScrollFinished?: (messageId: string, found: boolean) => void;
    /**
     * Try to bring `messageId` into view. Return `true` when the target
     * is already in the DOM and has been scrolled to (machine moves to
     * `idle` via `SCROLL_RESOLVED`); return `false` when the target
     * isn't on screen — the machine stays pending and retries on the
     * next `MESSAGES_CHANGED`. The caller supplies this so the view
     * can use the virtual scroller's `scrollToItem` to nudge off-screen
     * items into render.
     */
    attemptScroll?: (messageId: string) => boolean;
}

export interface UseWorkspaceReturn {
    selectedChannelId: Ref<string | null>;
    pendingScrollTo: Ref<string | null>;
    select: (channelId: string | null) => void;
    requestScroll: (messageId: string | null) => void;
    /**
     * Tell the workspace that a new chat-messages batch has rendered
     * so any pending scroll target can retry. Called by the owning
     * composable whenever `chat.messages` changes — this event comes
     * in through a method instead of a watched prop so we don't need
     * `chat.messages` at construction time (which would create a
     * circular dep: chat wants a selectedChannelId ref that only
     * exists after the workspace is built).
     */
    notifyMessagesChanged: () => void;
}

export function useWorkspace(opts: UseWorkspaceOptions): UseWorkspaceReturn {
    // Mirrored from the machine context, read by the UI.
    const selectedChannelId = ref<string | null>(null);
    const pendingScrollTo = ref<string | null>(null);

    // `let` so the `.provide()` action closures can reach back into
    // the actor to dispatch follow-up events (pickFallback → SELECT_CHANNEL,
    // tryScroll on success → SCROLL_RESOLVED). The actions only run
    // after `createActor`, by which point `actor` is bound.
    let actor: Actor<typeof workspaceMachine> | null = null;
    const send: Actor<typeof workspaceMachine>['send'] = (event) => {
        actor?.send(event);
    };

    const configured = workspaceMachine.provide({
        actions: {
            commitChannel: (_args, params) => {
                opts.onChannelCommitted(params.guildId, params.channelId);
            },
            pickFallback: (_args, params) => {
                if (params.availableIds.length === 0) return;
                const remembered = opts.readLastChannel(params.guildId);
                const pick = remembered && params.availableIds.includes(remembered)
                    ? remembered
                    : params.availableIds[0];
                // Queue the event so the machine finishes settling into
                // `resolving` before we push a new selection at it.
                queueMicrotask(() => send({ type: 'SELECT_CHANNEL', channelId: pick }));
            },
            tryScroll: (_args, params) => {
                // Delegate to the caller's scroller-aware helper when
                // provided (DiscordConversation's `scrollToMessage`).
                // Fallback: plain DOM query for tests / scenarios
                // without a view attached.
                const attempt = opts.attemptScroll
                    ?? ((id: string) => {
                        const el = document.querySelector(`[data-message-id="${id}"]`);
                        if (!el) return false;
                        (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                        return true;
                    });
                if (attempt(params.messageId)) {
                    queueMicrotask(() => send({ type: 'SCROLL_RESOLVED' }));
                    return;
                }
                // Attempt returned false: either the target isn't in the
                // loaded batch (anchor fetch handled upstream) or it's
                // in the list but outside the virtual scroller's
                // rendered window (scrollToItem was nudged in). Either
                // way, a frame or two later we should retry — feed
                // MESSAGES_CHANGED so the retry counter ticks and the
                // machine hits its `scrollLimitReached` give-up guard.
                requestAnimationFrame(() => send({ type: 'MESSAGES_CHANGED' }));
            },
            finishScroll: (_args, params) => {
                opts.onScrollFinished?.(params.messageId, params.found);
            }
        }
    });

    actor = createActor(configured, { input: { guildId: opts.guildId.value } });

    const subscription = actor.subscribe(snapshot => {
        const ctx = snapshot.context as WorkspaceContext;
        if (selectedChannelId.value !== ctx.selectedChannelId) {
            selectedChannelId.value = ctx.selectedChannelId;
        }
        if (pendingScrollTo.value !== ctx.pendingScrollTo) {
            pendingScrollTo.value = ctx.pendingScrollTo;
        }
    });
    actor.start();

    // ── External reactivity → machine events ────────────────────────

    watch(opts.guildId, (id) => {
        send({ type: 'GUILD_CHANGED', guildId: id });
    });

    watch(opts.availableChannelIds, (ids) => {
        send({ type: 'CHANNELS_UPDATED', channelIds: [...ids] });
    }, { immediate: true, deep: true });

    onBeforeUnmount(() => {
        subscription.unsubscribe();
        actor?.stop();
        actor = null;
    });

    return {
        selectedChannelId,
        pendingScrollTo,
        select: (id) => send({ type: 'SELECT_CHANNEL', channelId: id }),
        requestScroll: (id) => send({ type: 'REQUEST_SCROLL', messageId: id }),
        notifyMessagesChanged: () => send({ type: 'MESSAGES_CHANGED' })
    };
}
