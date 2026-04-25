import { defineStore } from 'pinia';
import { ref } from 'vue';

export type MemberMgmtMode = 'ban' | 'timeout' | 'nickname' | 'roles';

export interface MemberMgmtTarget {
    mode: MemberMgmtMode;
    guildId: string;
    userId: string;
    displayName: string;
    /** Member's current nickname when known — pre-fills the nickname
     *  modal so editing doesn't blank-out the previous value. */
    currentNickname?: string | null;
}

/**
 * Single-slot store driving the member-management modal. Mirrors the
 * other context-menu stores (user / channel) so the menu callsite
 * doesn't need to know the modal exists — it just calls `open()` and
 * the GuildMemberMgmtModal mounted in GuildWorkspace handles the rest.
 */
export const useMemberMgmtStore = defineStore('discord-member-mgmt', () => {
    const target = ref<MemberMgmtTarget | null>(null);

    function open(t: MemberMgmtTarget): void {
        target.value = t;
    }
    function close(): void {
        target.value = null;
    }
    return { target, open, close };
});
