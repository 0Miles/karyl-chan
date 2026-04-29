import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  type ChatInputCommandInteraction,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { RconForwardChannel } from "./rcon-forward-channel.model.js";
import {
  registerInProcessCommand,
  registerInProcessModal,
} from "../../../services/in-process-command-registry.service.js";
import { encryptSecret } from "../../../utils/crypto.js";
import { FAILED_COLOR, SUCCEEDED_COLOR } from "../../../utils/constant.js";

const MODAL_CUSTOM_ID = "NewRconForwardChannelForm";

/**
 * `/rcon-forward-channel <watch|stop-watch|status|edit>`
 *
 * Replaces the discordx-decorated RconForwardChannelCommands class.
 * `watch` and `edit` open a modal whose submit is routed via the
 * in-process modal registry (customId prefix = MODAL_CUSTOM_ID).
 */

function buildModal(prefill?: {
  host: string;
  port: string;
  triggerPrefix: string;
  commandPrefix: string;
  passwordOptional?: boolean;
}): ModalBuilder {
  const modal = new ModalBuilder()
    .setTitle("Rcon forward channel")
    .setCustomId(MODAL_CUSTOM_ID);
  const host = new TextInputBuilder()
    .setCustomId("fieldHost")
    .setLabel("Host")
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(300);
  if (prefill?.host) host.setValue(prefill.host);
  const password = new TextInputBuilder()
    .setCustomId("fieldPassword")
    .setLabel("Password")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(300);
  if (prefill?.passwordOptional) {
    password.setPlaceholder("留空以保持原密碼").setRequired(false);
  } else {
    password.setMinLength(1);
  }
  const port = new TextInputBuilder()
    .setCustomId("fieldPort")
    .setLabel("Port")
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(5)
    .setValue(prefill?.port ?? "25575");
  const triggerPrefix = new TextInputBuilder()
    .setCustomId("fieldTriggerPrefix")
    .setLabel("Trigger prefix")
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(10)
    .setValue(prefill?.triggerPrefix ?? "/");
  const commandPrefix = new TextInputBuilder()
    .setCustomId("fieldCommandPrefix")
    .setLabel("Command prefix")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10)
    .setRequired(false)
    .setValue(prefill?.commandPrefix ?? "/");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(host),
    new ActionRowBuilder<TextInputBuilder>().addComponents(password),
    new ActionRowBuilder<TextInputBuilder>().addComponents(port),
    new ActionRowBuilder<TextInputBuilder>().addComponents(triggerPrefix),
    new ActionRowBuilder<TextInputBuilder>().addComponents(commandPrefix),
  );
  return modal;
}

async function watchChannel(
  command: ChatInputCommandInteraction,
): Promise<void> {
  const existingRecord = await RconForwardChannel.findOne({
    where: { channelId: command.channelId, guildId: command.guildId },
  });
  if (!existingRecord) {
    await command.showModal(buildModal());
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
  const existingRecord = await RconForwardChannel.findOne({
    where: { channelId: command.channelId, guildId: command.guildId },
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

async function status(command: ChatInputCommandInteraction): Promise<void> {
  const existingRecord = await RconForwardChannel.findOne({
    where: { channelId: command.channelId, guildId: command.guildId },
  });
  if (existingRecord) {
    await replyStatus(
      command,
      existingRecord.getDataValue("triggerPrefix"),
      existingRecord.getDataValue("commandPrefix"),
      existingRecord.getDataValue("host"),
      existingRecord.getDataValue("port").toString(),
    );
  } else {
    await command.reply({
      embeds: [
        { color: FAILED_COLOR, title: "Current channel is not being watched." },
      ],
      flags: "Ephemeral",
    });
  }
}

async function edit(command: ChatInputCommandInteraction): Promise<void> {
  const existingRecord = await RconForwardChannel.findOne({
    where: { channelId: command.channelId, guildId: command.guildId },
  });
  if (existingRecord) {
    await command.showModal(
      buildModal({
        host: existingRecord.getDataValue("host"),
        port: existingRecord.getDataValue("port").toString(),
        triggerPrefix: existingRecord.getDataValue("triggerPrefix"),
        commandPrefix: existingRecord.getDataValue("commandPrefix"),
        passwordOptional: true,
      }),
    );
  } else {
    await command.reply({
      embeds: [
        { color: FAILED_COLOR, title: "Current channel is not being watched." },
      ],
      flags: "Ephemeral",
    });
  }
}

async function replyStatus(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  triggerPrefix: string,
  commandPrefix: string,
  host: string,
  port: string,
): Promise<void> {
  await interaction.reply({
    flags: "Ephemeral",
    embeds: [
      {
        color: SUCCEEDED_COLOR,
        fields: [
          { name: "Trigger prefix", value: triggerPrefix },
          { name: "Command prefix", value: commandPrefix },
          { name: "Host", value: host },
          { name: "Port", value: port },
          { name: "Password", value: "••••••••" },
        ],
      },
    ],
  });
}

async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    const [triggerPrefix, commandPrefix, host, portString, password] = [
      "fieldTriggerPrefix",
      "fieldCommandPrefix",
      "fieldHost",
      "fieldPort",
      "fieldPassword",
    ].map((id) => interaction.fields.getTextInputValue(id));

    const existingRecord = await RconForwardChannel.findOne({
      where: {
        channelId: interaction.channelId,
        guildId: interaction.guildId,
      },
    });

    if (!existingRecord) {
      await RconForwardChannel.create({
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        triggerPrefix,
        commandPrefix,
        host,
        password: encryptSecret(password),
        port: parseInt(portString),
      });
    } else {
      const updates: Record<string, unknown> = {
        triggerPrefix,
        commandPrefix,
        host,
        port: parseInt(portString),
      };
      if (password) {
        updates.password = encryptSecret(password);
      }
      await existingRecord.update(updates);
    }

    await replyStatus(
      interaction,
      triggerPrefix,
      commandPrefix,
      host,
      portString,
    );
  } catch (ex) {
    console.error(ex);
  }
}

export function registerRconForwardChannelCommands(): void {
  registerInProcessCommand({
    data: {
      type: ApplicationCommandType.ChatInput,
      name: "rcon-forward-channel",
      description: "Manage rcon forward channel",
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
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "status",
          description: "Check this channel status",
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "edit",
          description: "Edit rcon forward parameter",
        },
      ],
    },
    scope: "guild",
    handler: async (interaction) => {
      const sub = interaction.options.getSubcommand();
      if (sub === "watch") return watchChannel(interaction);
      if (sub === "stop-watch") return stopWatchChannel(interaction);
      if (sub === "status") return status(interaction);
      if (sub === "edit") return edit(interaction);
      await interaction.reply({
        content: `⚠ unknown subcommand '${sub}'`,
        flags: "Ephemeral",
      });
    },
  });
  registerInProcessModal({
    prefix: MODAL_CUSTOM_ID,
    handler: handleModalSubmit,
  });
}
