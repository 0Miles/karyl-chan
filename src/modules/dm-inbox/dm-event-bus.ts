import { EventEmitter } from "events";
import { config } from "../../config.js";
import type { Message } from "../web-core/message-types.js";
import type { DmChannelSummary } from "./dm-inbox.service.js";

export type DmEvent =
  | { type: "message-created"; channelId: string; message: Message }
  | { type: "message-updated"; channelId: string; message: Message }
  | { type: "message-deleted"; channelId: string; messageId: string }
  | { type: "channel-touched"; channel: DmChannelSummary }
  | {
      type: "typing-start";
      channelId: string;
      userId: string;
      userName: string;
      startedAt: number;
    };

export type DmEventListener = (event: DmEvent) => void;

export class EmitterLimitError extends Error {
  constructor(limit: number) {
    super(`SSE listener limit reached (max ${limit})`);
    this.name = "EmitterLimitError";
  }
}

export class DmEventBus {
  private emitter = new EventEmitter();
  private readonly maxListeners: number;

  constructor(maxListeners?: number) {
    this.maxListeners = maxListeners ?? config.dm.sseMaxListeners;
    this.emitter.setMaxListeners(this.maxListeners);
  }

  publish(event: DmEvent): void {
    this.emitter.emit("event", event);
  }

  isAtLimit(): boolean {
    return this.emitter.listenerCount("event") >= this.maxListeners;
  }

  subscribe(listener: DmEventListener): () => void {
    const current = this.emitter.listenerCount("event");
    if (current >= this.maxListeners) {
      throw new EmitterLimitError(this.maxListeners);
    }
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

export const dmEventBus = new DmEventBus();
