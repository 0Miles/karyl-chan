import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { PictureOnlyChannel } from "./picture-only-channel.model.js";
import { registerInProcessCommand } from "../in-process-command-registry.service.js";
import { SUCCEEDED_COLOR } from "../../../utils/constant.js";

/**
 * `/picture-only-channel <watch|stop-watch>`
 *
 * Replaces the discordx-decorated PictureOnlyChannelCommands class.
 * Configuration is per-channel; the decision to enforce picture-only
 * lives in events/picture-only-channel.events.ts, gated by the
 * guild-level `picture-only` built-in feature toggle.
 */

async function watchChannel(
  command: ChatInputCommandInteraction,
): Promise<void> {
  const existingRecord = await PictureOnlyChannel.findOne({
    where: {
      channelId: command.channelId,
      guildId: command.guildId,
    },
  });
  if (!existingRecord) {
    await PictureOnlyChannel.create({
      channelId: command.channelId,
      guildId: command.guildId,
    });
    await command.reply({
      embeds: [
        {
          color: SUCCEEDED_COLOR,
          title: "Succeeded",
          description: "The current channel is being watched.",
        },
      ],
      flags: "Ephemeral",
    });
  } else {
    await command.reply({
      embeds: [
        {
          color: SUCCEEDED_COLOR,
          title: "No action",
          description: "Current channel is already in the watch list.",
        },
      ],
      flags: "Ephemeral",
    });
  }
}

async function stopWatchChannel(
  command: ChatInputCommandInteraction,
): Promise<void> {
  const existingRecord = await PictureOnlyChannel.findOne({
    where: {
      channelId: command.channelId,
      guildId: command.guildId,
    },
  });
  if (existingRecord) {
    await existingRecord.destroy();
    await command.reply({
      embeds: [
        {
          color: SUCCEEDED_COLOR,
          title: "Succeeded",
          description: "Current channel is no longer being watched.",
        },
      ],
      flags: "Ephemeral",
    });
  } else {
    await command.reply({
      embeds: [
        {
          color: SUCCEEDED_COLOR,
          title: "No action",
          description: "Current channel is not being watched.",
        },
      ],
      flags: "Ephemeral",
    });
  }
}

export function registerPictureOnlyChannelCommands(): void {
  registerInProcessCommand({
    data: {
      type: ApplicationCommandType.ChatInput,
      name: "picture-only-channel",
      description: "Manage picture only channel",
      defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "watch",
          description: "Watch this channel as a rcon forward channel",
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "stop-watch",
          description: "Stop watching this channel as a rcon forward channel",
        },
      ],
    },
    scope: "guild",
    handler: async (interaction) => {
      const sub = interaction.options.getSubcommand();
      if (sub === "watch") {
        await watchChannel(interaction);
        return;
      }
      if (sub === "stop-watch") {
        await stopWatchChannel(interaction);
        return;
      }
      await interaction.reply({
        content: `⚠ unknown subcommand '${sub}'`,
        flags: "Ephemeral",
      });
    },
  });
}
