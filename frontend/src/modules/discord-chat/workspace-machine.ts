import { setup, assign, raise, type ActorRefFrom } from 'xstate';

/**
 * Workspace lifecycle machine — single source of truth for "which
 * channel am I on, am I waiting to scroll somewhere, is the channel
 * list stable?" across DM and guild surfaces.
 *
 * Modelled with two parallel regions so channel selection and scroll
 * restoration evolve independently. Side effects (saving localStorage,
 * pre-fetching channel members, writing `?channel=`, scrolling the
 * DOM) are delegated to the caller through action overrides injected
 * via `.provide({ actions: ... })`.
 *
 *   Selection region
 *     • resolving  — no valid selection; pickFallback action runs when
 *                    the channel list has content so the caller can
 *                    choose localStorage-last or first-available.
 *     • committed  — selectedChannelId is valid; commitChannel action
 *                    fires side effects. Invalidates back to resolving
 *                    when the current id is no longer in the list.
 *
 *   Scroll region
 *     • idle       — nothing pending.
 *     • pending    — caller has asked us to scroll to a message id;
 *                    each MESSAGES_CHANGED tick runs tryScroll, and
 *                    SCROLL_RESOLVED (from the caller on success) or
 *                    the retry-limit guard brings us back to idle.
 */

const MAX_SCROLL_ATTEMPTS = 20;

export interface WorkspaceContext {
    guildId: string | null;
    selectedChannelId: string | null;
    availableChannelIds: string[];
    pendingScrollTo: string | null;
    scrollAttempts: number;
}

export type WorkspaceEvent =
    | { type: 'GUILD_CHANGED'; guildId: string | null }
    | { type: 'CHANNELS_UPDATED'; channelIds: string[] }
    | { type: 'SELECT_CHANNEL'; channelId: string | null }
    | { type: 'REQUEST_SCROLL'; messageId: string | null }
    | { type: 'MESSAGES_CHANGED' }
    | { type: 'SCROLL_RESOLVED' }
    | { type: 'INVALIDATE' };

function sameList(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export const workspaceMachine = setup({
    types: {
        input: {} as { guildId: string | null },
        context: {} as WorkspaceContext,
        events: {} as WorkspaceEvent
    },
    actions: {
        // Placeholder implementations replaced per-instance via
        // `workspaceMachine.provide({ actions: ... })`.
        commitChannel: (_args, _params: { guildId: string | null; channelId: string }) => {},
        pickFallback: (_args, _params: { guildId: string | null; availableIds: string[] }) => {},
        tryScroll: (_args, _params: { messageId: string }) => {},
        finishScroll: (_args, _params: { messageId: string; found: boolean }) => {}
    },
    guards: {
        guildIsNew: ({ event, context }) =>
            event.type === 'GUILD_CHANGED' && event.guildId !== context.guildId,
        channelsChanged: ({ event, context }) =>
            event.type === 'CHANNELS_UPDATED' && !sameList(event.channelIds, context.availableChannelIds),
        selectionLandsInList: ({ event, context }) => {
            if (event.type !== 'SELECT_CHANNEL' || event.channelId === null) return false;
            // Empty list: trust the caller (URL seed arrives before channels load).
            if (context.availableChannelIds.length === 0) return true;
            return context.availableChannelIds.includes(event.channelId);
        },
        isSameChannel: ({ event, context }) =>
            event.type === 'SELECT_CHANNEL' && event.channelId === context.selectedChannelId,
        isClearing: ({ event }) =>
            event.type === 'SELECT_CHANNEL' && event.channelId === null,
        hasAvailableChannels: ({ context }) => context.availableChannelIds.length > 0,
        committedSelectionInvalid: ({ context }) =>
            context.selectedChannelId === null
            || (context.availableChannelIds.length > 0
                && !context.availableChannelIds.includes(context.selectedChannelId)),
        scrollLimitReached: ({ context }) => context.scrollAttempts >= MAX_SCROLL_ATTEMPTS,
        requestCarriesTarget: ({ event }) =>
            event.type === 'REQUEST_SCROLL' && event.messageId !== null
    }
}).createMachine({
    id: 'workspace',
    type: 'parallel',
    context: ({ input }) => ({
        guildId: input.guildId,
        selectedChannelId: null,
        availableChannelIds: [],
        pendingScrollTo: null,
        scrollAttempts: 0
    }),
    // Root-level handlers update context + raise INVALIDATE so both
    // parallel regions can react cohesively.
    on: {
        GUILD_CHANGED: {
            guard: 'guildIsNew',
            actions: [
                assign({
                    guildId: ({ event }) => event.guildId,
                    selectedChannelId: null,
                    availableChannelIds: [],
                    pendingScrollTo: null,
                    scrollAttempts: 0
                }),
                raise({ type: 'INVALIDATE' })
            ]
        },
        CHANNELS_UPDATED: {
            guard: 'channelsChanged',
            actions: [
                assign({ availableChannelIds: ({ event }) => event.channelIds }),
                raise({ type: 'INVALIDATE' })
            ]
        }
    },
    states: {
        selection: {
            initial: 'resolving',
            states: {
                resolving: {
                    // First entry: nudge the caller to pick a fallback
                    // using whatever list is currently cached. It's a
                    // no-op when the list is empty.
                    entry: [
                        {
                            type: 'pickFallback',
                            params: ({ context }) => ({
                                guildId: context.guildId,
                                availableIds: context.availableChannelIds
                            })
                        }
                    ],
                    on: {
                        SELECT_CHANNEL: [
                            {
                                guard: 'isClearing',
                                actions: assign({ selectedChannelId: null })
                            },
                            {
                                guard: 'selectionLandsInList',
                                actions: assign({
                                    selectedChannelId: ({ event }) => event.channelId
                                }),
                                target: 'committed'
                            }
                            // Otherwise: ignore; stale/invalid selections
                            // don't move us off resolving.
                        ],
                        INVALIDATE: {
                            // Re-nudge pickFallback whenever the channel
                            // list (or guild) changes underneath us while
                            // still resolving.
                            guard: 'hasAvailableChannels',
                            actions: [
                                {
                                    type: 'pickFallback',
                                    params: ({ context }) => ({
                                        guildId: context.guildId,
                                        availableIds: context.availableChannelIds
                                    })
                                }
                            ]
                        }
                    }
                },
                committed: {
                    entry: [
                        {
                            type: 'commitChannel',
                            params: ({ context }) => ({
                                guildId: context.guildId,
                                channelId: context.selectedChannelId as string
                            })
                        }
                    ],
                    on: {
                        SELECT_CHANNEL: [
                            {
                                guard: 'isClearing',
                                actions: assign({
                                    selectedChannelId: null,
                                    pendingScrollTo: null,
                                    scrollAttempts: 0
                                }),
                                target: 'resolving'
                            },
                            {
                                guard: 'isSameChannel',
                                // Noop — keeps commitChannel from re-firing.
                                actions: []
                            },
                            {
                                guard: 'selectionLandsInList',
                                actions: assign({
                                    selectedChannelId: ({ event }) => event.channelId
                                }),
                                target: 'committed',
                                reenter: true
                            }
                        ],
                        INVALIDATE: {
                            guard: 'committedSelectionInvalid',
                            actions: assign({
                                selectedChannelId: null,
                                pendingScrollTo: null,
                                scrollAttempts: 0
                            }),
                            target: 'resolving'
                        }
                    }
                }
            }
        },
        scroll: {
            initial: 'idle',
            states: {
                idle: {
                    on: {
                        REQUEST_SCROLL: {
                            guard: 'requestCarriesTarget',
                            actions: assign({
                                pendingScrollTo: ({ event }) => event.messageId,
                                scrollAttempts: 0
                            }),
                            target: 'pending'
                        }
                    }
                },
                pending: {
                    // Kick off an immediate attempt — sometimes the DOM
                    // already has the target row (same channel, scroll
                    // only). Subsequent attempts come from MESSAGES_CHANGED.
                    entry: [
                        {
                            type: 'tryScroll',
                            params: ({ context }) => ({
                                messageId: context.pendingScrollTo as string
                            })
                        }
                    ],
                    always: {
                        guard: 'scrollLimitReached',
                        actions: [
                            {
                                type: 'finishScroll',
                                params: ({ context }) => ({
                                    messageId: context.pendingScrollTo as string,
                                    found: false
                                })
                            },
                            assign({ pendingScrollTo: null, scrollAttempts: 0 })
                        ],
                        target: 'idle'
                    },
                    on: {
                        MESSAGES_CHANGED: {
                            actions: [
                                assign({
                                    scrollAttempts: ({ context }) => context.scrollAttempts + 1
                                }),
                                {
                                    type: 'tryScroll',
                                    params: ({ context }) => ({
                                        messageId: context.pendingScrollTo as string
                                    })
                                }
                            ]
                        },
                        SCROLL_RESOLVED: {
                            actions: [
                                {
                                    type: 'finishScroll',
                                    params: ({ context }) => ({
                                        messageId: context.pendingScrollTo as string,
                                        found: true
                                    })
                                },
                                assign({ pendingScrollTo: null, scrollAttempts: 0 })
                            ],
                            target: 'idle'
                        },
                        REQUEST_SCROLL: [
                            {
                                // New target supersedes — reset retry count.
                                guard: 'requestCarriesTarget',
                                actions: assign({
                                    pendingScrollTo: ({ event }) => event.messageId,
                                    scrollAttempts: 0
                                }),
                                target: 'pending',
                                reenter: true
                            },
                            {
                                // null = cancel.
                                actions: [
                                    {
                                        type: 'finishScroll',
                                        params: ({ context }) => ({
                                            messageId: context.pendingScrollTo as string,
                                            found: false
                                        })
                                    },
                                    assign({ pendingScrollTo: null, scrollAttempts: 0 })
                                ],
                                target: 'idle'
                            }
                        ]
                    }
                }
            }
        }
    }
});

export type WorkspaceActor = ActorRefFrom<typeof workspaceMachine>;
