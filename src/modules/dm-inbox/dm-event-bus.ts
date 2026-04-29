import { EventEmitter } from "events";
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

export class DmEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: DmEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: DmEventListener): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

export const dmEventBus = new DmEventBus();
