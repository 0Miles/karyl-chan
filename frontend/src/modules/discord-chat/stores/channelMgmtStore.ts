import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CreatableChannelKind, GuildTextChannel } from '../../../api/guilds';

export type ChannelMgmtMode = 'create' | 'edit';

export interface ChannelCreateContext {
    mode: 'create';
    guildId: string;
    /** Pre-selected category. Null targets the "no category" bucket so
     *  the user only has to confirm name + type. */
    parentId: string | null;
    /** Default channel kind in the form — usually `text`, but a category
     *  right-click on a voice section could pre-select `voice`. */
    defaultType?: CreatableChannelKind;
}

export interface ChannelEditContext {
    mode: 'edit';
    guildId: string;
    /** The channel row from the unified categories list — used to seed
     *  the form's initial values. Forum/voice/category channels share
     *  the same shape as text. Threads use isThread = true. */
    channel: GuildTextChannel;
    isThread?: boolean;
    threadParentName?: string;
    /** Current thread flags so the form can show archive/lock toggles
     *  in their right state. */
    threadArchived?: boolean;
    threadLocked?: boolean;
    threadAutoArchiveDuration?: 60 | 1440 | 4320 | 10080;
}

export type ChannelMgmtTarget = ChannelCreateContext | ChannelEditContext;

export const useChannelMgmtStore = defineStore('discord-channel-mgmt', () => {
    const target = ref<ChannelMgmtTarget | null>(null);

    function open(t: ChannelMgmtTarget): void {
        target.value = t;
    }
    function close(): void {
        target.value = null;
    }
    return { target, open, close };
});
