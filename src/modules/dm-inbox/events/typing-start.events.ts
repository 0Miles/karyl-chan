import { ChannelType, type Client } from "discord.js";
import { dmEventBus } from "../dm-event-bus.js";
import { guildChannelEventBus } from "../../guild-management/guild-channel-event-bus.js";
import { moduleLogger } from "../../../logger.js";

const log = moduleLogger("typing-start");

/**
 * Bridges Discord's `typingStart` gateway event onto our SSE event
 * buses so the admin client can render "Alice is typing…" footers.
 *
 * Skips the bot's own typing — sending typing to itself wouldn't make
 * sense and would waste an SSE round-trip per keystroke. Per Discord's
 * contract, a typing indicator naturally expires after ~10 seconds with
 * no further events, so the frontend handles the timeout side; we just
 * relay the start.
 */
export function registerTypingStartEvents(client: Client): void {
  client.on("typingStart", (typing) => {
    try {
      if (typing.user?.bot) return;
      const userId = typing.user?.id;
      if (!userId) return;
      const userName =
        typing.user?.globalName ?? typing.user?.username ?? userId;
      const startedAt = typing.startedTimestamp ?? Date.now();

      const channel = typing.channel;
      if (!channel) return;
      if (channel.type === ChannelType.DM) {
        dmEventBus.publish({
          type: "typing-start",
          channelId: channel.id,
          userId,
          userName,
          startedAt,
        });
        return;
      }
      if ("guildId" in channel && channel.guildId) {
        guildChannelEventBus.publish({
          type: "guild-typing-start",
          guildId: channel.guildId,
          channelId: channel.id,
          userId,
          userName,
          startedAt,
        });
      }
    } catch (err) {
      log.error({ err }, "typingStart bridge failed");
    }
  });
}
