import { EventEmitter } from "events";
import { config } from "../../config.js";
import type { Message } from "../web-core/message-types.js";

export interface VoiceMember {
  id: string;
  username: string;
  globalName: string | null;
  nickname: string | null;
  avatarUrl: string | null;
}

export type GuildChannelEvent =
  | {
      type: "guild-message-created";
      guildId: string;
      channelId: string;
      message: Message;
    }
  | {
      type: "guild-message-updated";
      guildId: string;
      channelId: string;
      message: Message;
    }
  | {
      type: "guild-message-deleted";
      guildId: string;
      channelId: string;
      messageId: string;
    }
  | {
      type: "guild-typing-start";
      guildId: string;
      channelId: string;
      userId: string;
      userName: string;
      startedAt: number;
    }
  /** Fires when any participant joins, leaves, or moves between voice/stage
   *  channels in the guild. `channels` lists every affected channel's
   *  current participant set so clients can patch in place without
   *  refetching the channel tree. */
  | {
      type: "guild-voice-state-updated";
      guildId: string;
      channels: Array<{ channelId: string; members: VoiceMember[] }>;
    };

export type GuildChannelEventListener = (event: GuildChannelEvent) => void;

export class EmitterLimitError extends Error {
  constructor(limit: number) {
    super(`SSE listener limit reached (max ${limit})`);
    this.name = "EmitterLimitError";
  }
}

export class GuildChannelEventBus {
  private emitter = new EventEmitter();
  private readonly maxListeners: number;

  constructor(maxListeners?: number) {
    this.maxListeners = maxListeners ?? config.dm.sseMaxListeners;
    this.emitter.setMaxListeners(this.maxListeners);
  }

  publish(event: GuildChannelEvent): void {
    this.emitter.emit("event", event);
  }

  isAtLimit(): boolean {
    return this.emitter.listenerCount("event") >= this.maxListeners;
  }

  subscribe(listener: GuildChannelEventListener): () => void {
    const current = this.emitter.listenerCount("event");
    if (current >= this.maxListeners) {
      throw new EmitterLimitError(this.maxListeners);
    }
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

export const guildChannelEventBus = new GuildChannelEventBus();
