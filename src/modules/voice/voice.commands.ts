import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import { registerInProcessCommand } from "../builtin-features/in-process-command-registry.service.js";
import {
  joinVoice,
  leaveVoice,
  playUrl,
  stopPlayback,
  getStatus,
} from "./voice-manager.service.js";
import { FAILED_COLOR, SUCCEEDED_COLOR } from "../../utils/constant.js";

function ephemeralReplyError(
  command: ChatInputCommandInteraction,
  msg: string,
): Promise<unknown> {
  return command.reply({
    embeds: [{ description: msg, color: FAILED_COLOR }],
    flags: "Ephemeral",
  });
}

function ephemeralReplyOk(
  command: ChatInputCommandInteraction,
  msg: string,
): Promise<unknown> {
  return command.reply({
    embeds: [{ description: msg, color: SUCCEEDED_COLOR }],
    flags: "Ephemeral",
  });
}

async function handleJoin(
  command: ChatInputCommandInteraction,
): Promise<void> {
  if (!command.guildId || !command.guild) {
    await ephemeralReplyError(command, "此指令僅能在公會中使用");
    return;
  }
  const member = command.member as GuildMember | null;
  const voiceChannelId = member?.voice.channelId ?? null;
  if (!voiceChannelId) {
    await ephemeralReplyError(command, "請先加入一個語音頻道再呼叫此指令");
    return;
  }
  await command.deferReply({ flags: "Ephemeral" });
  const status = await joinVoice({
    guildId: command.guildId,
    channelId: voiceChannelId,
    adapterCreator: command.guild.voiceAdapterCreator,
  });
  await command.editReply({
    embeds: [
      {
        description: status.connected
          ? `✓ 已加入語音頻道 <#${voiceChannelId}>`
          : `⚠ 連線狀態:${status.connectionStatus ?? "未知"}`,
        color: status.connected ? SUCCEEDED_COLOR : FAILED_COLOR,
      },
    ],
  });
}

async function handleLeave(
  command: ChatInputCommandInteraction,
): Promise<void> {
  if (!command.guildId) {
    await ephemeralReplyError(command, "此指令僅能在公會中使用");
    return;
  }
  leaveVoice(command.guildId);
  await ephemeralReplyOk(command, "✓ 已離開語音頻道");
}

async function handlePlay(
  command: ChatInputCommandInteraction,
): Promise<void> {
  if (!command.guildId) {
    await ephemeralReplyError(command, "此指令僅能在公會中使用");
    return;
  }
  const url = command.options.getString("url", true).trim();
  // Reject anything that doesn't parse as http(s); ffmpeg accepts a
  // wider range (file://, rtmp://, etc.) but those are footguns from
  // a slash command. Plugins that want richer formats can use the
  // RPC path with their own validation.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    await ephemeralReplyError(command, "URL 格式不正確");
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    await ephemeralReplyError(command, "僅接受 http(s) URL");
    return;
  }
  try {
    const status = playUrl(command.guildId, url);
    await ephemeralReplyOk(
      command,
      `✓ 開始播放 \`${url}\`（player:${status.playerStatus}）`,
    );
  } catch (err) {
    if (err instanceof Error && err.message === "not_joined") {
      await ephemeralReplyError(command, "尚未加入語音頻道,請先 `/voice join`");
      return;
    }
    if (err instanceof Error && err.message === "ffmpeg_not_available") {
      await ephemeralReplyError(command, "ffmpeg 不可用,語音播放停用");
      return;
    }
    throw err;
  }
}

async function handleStop(
  command: ChatInputCommandInteraction,
): Promise<void> {
  if (!command.guildId) {
    await ephemeralReplyError(command, "此指令僅能在公會中使用");
    return;
  }
  stopPlayback(command.guildId);
  await ephemeralReplyOk(command, "✓ 已停止播放");
}

async function handleStatus(
  command: ChatInputCommandInteraction,
): Promise<void> {
  if (!command.guildId) {
    await ephemeralReplyError(command, "此指令僅能在公會中使用");
    return;
  }
  const status = getStatus(command.guildId);
  const lines = [
    `**已連線:** ${status.connected ? "✓" : "✗"}`,
    `**頻道:** ${status.channelId ? `<#${status.channelId}>` : "(無)"}`,
    `**播放中:** ${status.playing ? "✓" : "✗"}`,
    status.playingUrl ? `**URL:** \`${status.playingUrl}\`` : null,
    `**connection:** ${status.connectionStatus ?? "(無)"}`,
    `**player:** ${status.playerStatus ?? "(無)"}`,
  ].filter(Boolean);
  await command.reply({
    embeds: [{ description: lines.join("\n"), color: SUCCEEDED_COLOR }],
    flags: "Ephemeral",
  });
}

export function registerVoiceCommands(): void {
  registerInProcessCommand({
    data: {
      type: ApplicationCommandType.ChatInput,
      name: "voice",
      description: "Bot 語音控制",
      defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "join",
          description: "讓 bot 加入你目前所在的語音頻道",
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "leave",
          description: "讓 bot 離開語音頻道",
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "play",
          description: "播放音訊 URL(直連 mp3 / opus / HLS 等 ffmpeg 可解的格式)",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "url",
              description: "音訊 URL(http/https)",
              required: true,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "stop",
          description: "停止當前播放",
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "status",
          description: "查看 bot 語音狀態",
        },
      ],
    },
    scope: "guild",
    handler: async (interaction) => {
      const sub = interaction.options.getSubcommand();
      if (sub === "join") return handleJoin(interaction);
      if (sub === "leave") return handleLeave(interaction);
      if (sub === "play") return handlePlay(interaction);
      if (sub === "stop") return handleStop(interaction);
      if (sub === "status") return handleStatus(interaction);
      await interaction.reply({
        content: `⚠ unknown subcommand '${sub}'`,
        flags: "Ephemeral",
      });
    },
  });
}
