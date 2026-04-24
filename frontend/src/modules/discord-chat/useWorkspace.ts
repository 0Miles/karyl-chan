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
                const el = document.querySelector(`[data-message-id="${params.messageId}"]`);
                if (!el) return;
                (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                queueMicrotask(() => send({ type: 'SCROLL_RESOLVED' }));
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
