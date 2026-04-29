import { EventEmitter } from 'events';
import type { Message } from '../web-core/message-types.js';

export interface VoiceMember {
    id: string;
    username: string;
    globalName: string | null;
    nickname: string | null;
    avatarUrl: string | null;
}

export type GuildChannelEvent =
    | { type: 'guild-message-created'; guildId: string; channelId: string; message: Message }
    | { type: 'guild-message-updated'; guildId: string; channelId: string; message: Message }
    | { type: 'guild-message-deleted'; guildId: string; channelId: string; messageId: string }
    | { type: 'guild-typing-start'; guildId: string; channelId: string; userId: string; userName: string; startedAt: number }
    /** Fires when any participant joins, leaves, or moves between voice/stage
     *  channels in the guild. `channels` lists every affected channel's
     *  current participant set so clients can patch in place without
     *  refetching the channel tree. */
    | { type: 'guild-voice-state-updated'; guildId: string; channels: Array<{ channelId: string; members: VoiceMember[] }> };

export type GuildChannelEventListener = (event: GuildChannelEvent) => void;

export class GuildChannelEventBus {
    private emitter = new EventEmitter();

    constructor() {
        this.emitter.setMaxListeners(0);
    }

    publish(event: GuildChannelEvent): void {
        this.emitter.emit('event', event);
    }

    subscribe(listener: GuildChannelEventListener): () => void {
        this.emitter.on('event', listener);
        return () => this.emitter.off('event', listener);
    }
}

export const guildChannelEventBus = new GuildChannelEventBus();
