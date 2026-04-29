import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { PictureOnlyChannel } from "../models/picture-only-channel.model.js";
import { resolveBuiltinFeatureEnabled } from "../models/bot-feature-state.model.js";
import { botEventLog } from "../web/bot-event-log.js";
import { shouldRecord } from "../web/bot-event-dedup.js";

@Discord()
export class PictureOnlyChannelEvents {
  @On()
  async messageCreate(
    [message]: ArgsOf<"messageCreate">,
    client: Client,
  ): Promise<void> {
    try {
      // Honor the operator's per-guild + default toggle. Disabled →
      // skip; the configuration row stays in place so re-enabling
      // restores previous setup without losing data.
      if (
        !(await resolveBuiltinFeatureEnabled("picture-only", message.guildId))
      ) {
        return;
      }
      const existingRecord = await PictureOnlyChannel.findOne({
        where: {
          channelId: message.channelId,
          guildId: message.guildId,
        },
      });

      if (existingRecord && message.attachments.size === 0) {
        await message.delete();
        if (shouldRecord(`picture-only:${message.channelId}`)) {
          botEventLog.record(
            "info",
            "feature",
            "Picture-only channel auto-delete",
            {
              guildId: message.guildId,
              channelId: message.channelId,
              authorId: message.author.id,
              messageId: message.id,
            },
          );
        }
      }
    } catch (ex) {
      console.error(ex);
      botEventLog.record(
        "error",
        "feature",
        `Picture-only delete failed: ${(ex as Error).message}`,
        {
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
        },
      );
    }
  }
}
