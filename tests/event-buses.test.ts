import { describe, it, expect, vi } from "vitest";
import {
  DmEventBus,
  EmitterLimitError,
  type DmEvent,
} from "../src/modules/dm-inbox/dm-event-bus.js";
import {
  GuildChannelEventBus,
  EmitterLimitError as GuildEmitterLimitError,
  type GuildChannelEvent,
} from "../src/modules/guild-management/guild-channel-event-bus.js";

describe("DmEventBus", () => {
  it("delivers a published event to every subscriber", () => {
    const bus = new DmEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    const event: DmEvent = {
      type: "typing-start",
      channelId: "c1",
      userId: "u1",
      userName: "alice",
      startedAt: 0,
    };
    bus.publish(event);
    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it("unsubscribe stops further deliveries to that listener", () => {
    const bus = new DmEventBus();
    const listener = vi.fn();
    const off = bus.subscribe(listener);
    bus.publish({ type: "channel-touched", channel: { id: "c1" } as never });
    off();
    bus.publish({ type: "channel-touched", channel: { id: "c2" } as never });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publish with no subscribers is a no-op (does not throw)", () => {
    const bus = new DmEventBus();
    expect(() =>
      bus.publish({
        type: "message-deleted",
        channelId: "c1",
        messageId: "m1",
      }),
    ).not.toThrow();
  });

  it("allows subscribing up to the listener limit", () => {
    const bus = new DmEventBus(3);
    expect(bus.isAtLimit()).toBe(false);
    bus.subscribe(vi.fn());
    bus.subscribe(vi.fn());
    bus.subscribe(vi.fn());
    expect(bus.isAtLimit()).toBe(true);
  });

  it("throws EmitterLimitError when the listener limit is exceeded", () => {
    const bus = new DmEventBus(2);
    bus.subscribe(vi.fn());
    bus.subscribe(vi.fn());
    expect(() => bus.subscribe(vi.fn())).toThrow(EmitterLimitError);
  });

  it("isAtLimit returns false after unsubscribe frees a slot", () => {
    const bus = new DmEventBus(1);
    const off = bus.subscribe(vi.fn());
    expect(bus.isAtLimit()).toBe(true);
    off();
    expect(bus.isAtLimit()).toBe(false);
    // Can subscribe again after freeing
    expect(() => bus.subscribe(vi.fn())).not.toThrow();
  });
});

describe("GuildChannelEventBus", () => {
  it("delivers to every subscriber and respects unsubscribe", () => {
    const bus = new GuildChannelEventBus();
    const listener = vi.fn();
    const off = bus.subscribe(listener);
    const event: GuildChannelEvent = {
      type: "guild-typing-start",
      guildId: "g1",
      channelId: "c1",
      userId: "u1",
      userName: "alice",
      startedAt: 0,
    };
    bus.publish(event);
    expect(listener).toHaveBeenCalledWith(event);
    off();
    bus.publish(event);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("allows subscribing up to the listener limit", () => {
    const bus = new GuildChannelEventBus(3);
    expect(bus.isAtLimit()).toBe(false);
    bus.subscribe(vi.fn());
    bus.subscribe(vi.fn());
    bus.subscribe(vi.fn());
    expect(bus.isAtLimit()).toBe(true);
  });

  it("throws EmitterLimitError when the listener limit is exceeded", () => {
    const bus = new GuildChannelEventBus(2);
    bus.subscribe(vi.fn());
    bus.subscribe(vi.fn());
    expect(() => bus.subscribe(vi.fn())).toThrow(GuildEmitterLimitError);
  });

  it("isAtLimit returns false after unsubscribe frees a slot", () => {
    const bus = new GuildChannelEventBus(1);
    const off = bus.subscribe(vi.fn());
    expect(bus.isAtLimit()).toBe(true);
    off();
    expect(bus.isAtLimit()).toBe(false);
    expect(() => bus.subscribe(vi.fn())).not.toThrow();
  });
});
