import {
  ChannelType,
  type Client,
  type GuildMember,
  type VoiceBasedChannel,
} from "discord.js";
import {
  guildChannelEventBus,
  type VoiceMember,
} from "../../guild-management/guild-channel-event-bus.js";
import {
  avatarUrlFor,
  guildAvatarUrlFor,
} from "../../web-core/message-mapper.js";

function memberRow(guildId: string, m: GuildMember): VoiceMember {
  return {
    id: m.id,
    username: m.user.username,
    globalName: m.user.globalName ?? null,
    nickname: m.nickname ?? null,
    avatarUrl: m.avatar
      ? guildAvatarUrlFor(guildId, m.id, m.avatar, 64)
      : avatarUrlFor(m.id, m.user.avatar, 64),
  };
}

function channelMembers(channel: VoiceBasedChannel): {
  channelId: string;
  members: VoiceMember[];
} {
  return {
    channelId: channel.id,
    members: [...channel.members.values()].map((m) =>
      memberRow(channel.guildId, m),
    ),
  };
}

export function registerVoiceStateEvents(client: Client): void {
  client.on("voiceStateUpdate", (oldState, newState) => {
    // Only join / leave / move are relevant to the participant list —
    // mute / deafen / video toggles fire the same gateway event but
    // don't change membership, so we filter them out here.
    if (oldState.channelId === newState.channelId) return;

    const guildId = newState.guild.id;
    const affected: Array<{ channelId: string; members: VoiceMember[] }> = [];
    const seen = new Set<string>();

    for (const ch of [oldState.channel, newState.channel]) {
      if (!ch) continue;
      if (
        ch.type !== ChannelType.GuildVoice &&
        ch.type !== ChannelType.GuildStageVoice
      ) {
        continue;
      }
      if (seen.has(ch.id)) continue;
      seen.add(ch.id);
      affected.push(channelMembers(ch));
    }
    if (affected.length === 0) return;

    try {
      guildChannelEventBus.publish({
        type: "guild-voice-state-updated",
        guildId,
        channels: affected,
      });
    } catch (err) {
      console.error("voice-state publish failed:", err);
    }
  });
}
