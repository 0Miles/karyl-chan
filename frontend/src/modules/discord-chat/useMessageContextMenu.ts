import { computed, ref, type Ref } from 'vue';
import type { ContextMenuAction } from '../../libs/messages/MessageContextMenu.vue';
import type { Message } from '../../libs/messages/types';
import { useUnreadStore } from './stores/unreadStore';
import { useI18n } from 'vue-i18n';

type EmitFn = {
    (e: 'reply', message: Message): void;
    (e: 'forward', message: Message): void;
    (e: 'request-edit', message: Message): void;
    (e: 'delete', message: Message): void;
    (e: 'pin', message: Message): void;
    (e: 'unpin', message: Message): void;
    (e: 'mod-delete', message: Message): void;
    (e: 'bulk-delete', message: Message): void;
};

const LONG_PRESS_MS = 500;

export function useMessageContextMenu(opts: {
    messages: Ref<Message[]>;
    botUserId: Ref<string | null>;
    canForward: Ref<boolean | undefined>;
    canModerate: Ref<boolean | undefined>;
    channelId: Ref<string | null>;
    emit: EmitFn;
    onShowSource: (message: Message) => void;
    onStartReact: (message: Message, btn: HTMLButtonElement | null) => void;
    onCopyLink: (message: Message) => void;
}) {
    const { messages, botUserId, canForward, canModerate, channelId, emit, onShowSource, onStartReact, onCopyLink } = opts;
    const { t: $t } = useI18n();
    const unreadStore = useUnreadStore();

    const ctxMenu = ref<{ x: number; y: number; messageId: string } | null>(null);
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    function isOwn(message: Message): boolean {
        return !!botUserId.value && message.author.id === botUserId.value;
    }

    function openContextMenu(event: MouseEvent | TouchEvent, message: Message) {
        const point = 'touches' in event && event.touches.length > 0
            ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
            : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
        ctxMenu.value = { x: point.x, y: point.y, messageId: message.id };
    }

    function onMessageContextMenu(event: MouseEvent, message: Message) {
        // Allow the OS native menu when the user is right-clicking inside
        // an editor (compose / edit textbox) so they can paste / spell-check.
        const target = event.target as HTMLElement | null;
        if (target?.closest('[contenteditable="true"], textarea, input')) return;
        event.preventDefault();
        openContextMenu(event, message);
    }

    function onMessageTouchStart(event: TouchEvent, message: Message) {
        if (event.touches.length !== 1) return;
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            openContextMenu(event, message);
        }, LONG_PRESS_MS);
    }

    function onMessageTouchEnd() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    const ctxActions = computed<ContextMenuAction[]>(() => {
        if (!ctxMenu.value) return [];
        const message = messages.value.find(m => m.id === ctxMenu.value!.messageId);
        if (!message) return [];
        const actions: ContextMenuAction[] = [
            { key: 'react', label: $t('messages.react'), icon: 'material-symbols:add-reaction-outline-rounded' },
            { key: 'reply', label: $t('messages.reply'), icon: 'material-symbols:reply-rounded' }
        ];
        if (isOwn(message)) {
            actions.push({ key: 'edit', label: $t('messages.edit'), icon: 'material-symbols:edit-rounded' });
        }
        if (canForward.value) {
            actions.push({ key: 'forward', label: $t('messages.forward'), icon: 'material-symbols:forward-rounded' });
        }
        actions.push({ key: 'copy-text', label: $t('messages.copyText'), icon: 'material-symbols:content-copy-outline-rounded' });
        actions.push({ key: 'copy-link', label: $t('messages.copyLink'), icon: 'material-symbols:link-rounded' });
        actions.push({ key: 'copy-id', label: $t('messages.copyId'), icon: 'material-symbols:fingerprint-rounded' });
        actions.push({ key: 'view-source', label: $t('messages.viewSource'), icon: 'material-symbols:code-rounded' });
        actions.push({ key: 'mark-unread', label: $t('messages.markUnread'), icon: 'material-symbols:mark-as-unread-outline-rounded' });
        if (canModerate.value) {
            actions.push({
                key: message.pinned ? 'unpin' : 'pin',
                label: $t(message.pinned ? 'messageMgmt.unpin' : 'messageMgmt.pin'),
                icon: 'material-symbols:keep-outline-rounded'
            });
            actions.push({ key: 'bulk-delete', label: $t('messageMgmt.bulkDelete'), icon: 'material-symbols:delete-sweep-outline-rounded', danger: true });
        }
        if (isOwn(message)) {
            actions.push({ key: 'delete', label: $t('messages.delete'), icon: 'material-symbols:delete-rounded', danger: true });
        } else if (canModerate.value) {
            actions.push({ key: 'mod-delete', label: $t('messageMgmt.deleteAny'), icon: 'material-symbols:delete-rounded', danger: true });
        }
        return actions;
    });

    async function copyToClipboard(text: string) {
        try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    }

    function messageUrl(message: Message): string {
        // `@me` stands in for null guildId in Discord's own permalink scheme.
        return `https://discord.com/channels/${message.guildId ?? '@me'}/${message.channelId}/${message.id}`;
    }

    function onContextPick(actionKey: string) {
        const ctx = ctxMenu.value;
        if (!ctx) return;
        const message = messages.value.find(m => m.id === ctx.messageId);
        if (!message) return;
        switch (actionKey) {
            case 'react': {
                // Anchor the picker on the row the user right-clicked so it
                // doesn't drift to wherever the inline action button last
                // landed. The DOM lookup runs inside the same tick the menu
                // closes, so the row is still mounted.
                const row = document.querySelector<HTMLButtonElement>(`[data-message-id="${CSS.escape(message.id)}"]`);
                onStartReact(message, row ?? null);
                break;
            }
            case 'reply': emit('reply', message); break;
            case 'copy-text': void copyToClipboard(message.content ?? ''); break;
            case 'copy-link': onCopyLink(message); break;
            case 'copy-id': void copyToClipboard(message.id); break;
            case 'forward': emit('forward', message); break;
            case 'view-source':
                onShowSource(message);
                break;
            case 'mark-unread': {
                // Anchor lastSeen at the message immediately before this one
                // so the target message becomes the first unread.
                const idx = messages.value.findIndex(m => m.id === message.id);
                const predecessor = idx > 0 ? messages.value[idx - 1].id : null;
                if (channelId.value) unreadStore.markUnreadFrom(channelId.value, predecessor);
                break;
            }
            case 'edit': emit('request-edit', message); break;
            case 'delete': emit('delete', message); break;
            case 'pin': emit('pin', message); break;
            case 'unpin': emit('unpin', message); break;
            case 'mod-delete': emit('mod-delete', message); break;
            case 'bulk-delete': emit('bulk-delete', message); break;
        }
    }

    return { ctxMenu, ctxActions, onMessageContextMenu, onMessageTouchStart, onMessageTouchEnd, onContextPick };
}
