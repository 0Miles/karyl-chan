import { EventEmitter } from 'events';
import type { Message } from './message-types.js';

export type GuildChannelEvent =
    | { type: 'guild-message-created'; guildId: string; channelId: string; message: Message }
    | { type: 'guild-message-updated'; guildId: string; channelId: string; message: Message }
    | { type: 'guild-message-deleted'; guildId: string; channelId: string; messageId: string };

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
