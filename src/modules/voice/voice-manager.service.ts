/**
 * Voice connection manager — one VoiceConnection per guild.
 *
 * @discordjs/voice handles the gateway voice handshake and the UDP
 * audio relay; we just track which guild has an active connection
 * and give a thin facade for join/leave/play/stop. Audio playback
 * uses ffmpeg (via prism-media's FFmpeg transformer) to decode any
 * format the underlying ffmpeg-static binary supports — works for
 * direct .mp3 / .ogg / .opus URLs, HLS streams, etc. YouTube
 * extraction is intentionally out of scope (license + maintenance
 * burden); plugins can add it themselves and feed us a direct URL.
 *
 * Plugin RPC fans out through this module — see voice-rpc.ts. Slash
 * commands fan out through voice.commands.ts. Both paths converge
 * here so the per-guild state stays consistent.
 */
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  type VoiceConnection,
  type AudioPlayer,
  type DiscordGatewayAdapterCreator,
} from "@discordjs/voice";
import { execSync } from "child_process";
import prism from "prism-media";
import { moduleLogger } from "../../logger.js";

const log = moduleLogger("voice-manager");

// prism-media 1.3.5 has hardcoded ffmpeg discovery: it tries
// require('ffmpeg-static') FIRST (ignoring FFMPEG_PATH env entirely),
// then falls back to PATH lookup. The ffmpeg-static binary segfaults
// on Debian Trixie, so we removed it from package.json — prism's
// require() now throws and it falls through to spawn('ffmpeg', ...)
// which finds the apt-installed binary on PATH.
//
// Side effect: dev mode (`npm run dev`) needs the operator to have
// ffmpeg on PATH. Document this in README.
{
  let resolved: string | null = null;
  try {
    const fromPath = execSync("command -v ffmpeg 2>/dev/null", {
      encoding: "utf8",
    }).trim();
    if (fromPath) resolved = fromPath;
  } catch {
    // No system ffmpeg — voice playback will throw at first /play.
  }
  log.info({ ffmpegPath: resolved }, "voice-manager: ffmpeg resolved");
}

interface GuildVoiceState {
  connection: VoiceConnection;
  player: AudioPlayer;
  channelId: string;
  /** The URL currently being played, if any. */
  playingUrl: string | null;
}

const states = new Map<string, GuildVoiceState>();

/** Information about the current voice state for a guild. */
export interface VoiceStatus {
  connected: boolean;
  channelId: string | null;
  playing: boolean;
  playingUrl: string | null;
  /** Reflects @discordjs/voice's connection status string. */
  connectionStatus: string | null;
  /** Reflects @discordjs/voice's player status string. */
  playerStatus: string | null;
}

export interface JoinOptions {
  guildId: string;
  channelId: string;
  adapterCreator: DiscordGatewayAdapterCreator;
  selfDeaf?: boolean;
  selfMute?: boolean;
}

/**
 * Join a guild voice channel. Idempotent: if already connected to
 * the same channel, returns the existing state. If connected to a
 * different channel in the same guild, transparently moves.
 */
export async function joinVoice(opts: JoinOptions): Promise<VoiceStatus> {
  const { guildId, channelId, adapterCreator, selfDeaf, selfMute } = opts;
  log.info({ guildId, channelId, selfDeaf, selfMute }, "joinVoice called");
  const existing = states.get(guildId);
  if (existing && existing.channelId === channelId) {
    return getStatus(guildId);
  }
  if (existing) {
    // Move to a different channel in the same guild — destroy old,
    // recreate. discord.js can rejoin with the same connection but
    // the simpler path is fresh state.
    existing.connection.destroy();
    existing.player.stop(true);
    states.delete(guildId);
  }
  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator,
    selfDeaf: selfDeaf ?? true,
    selfMute: selfMute ?? false,
  });
  const player = createAudioPlayer();
  connection.subscribe(player);

  // Disconnect handling — Discord can drop the connection (gateway
  // resume failure, channel deleted). Try one rejoin; if that fails,
  // tear down so the next join() starts clean.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      log.warn({ guildId, channelId }, "voice connection lost, destroying");
      connection.destroy();
      player.stop(true);
      states.delete(guildId);
    }
  });

  states.set(guildId, {
    connection,
    player,
    channelId,
    playingUrl: null,
  });

  // Wait up to 15s for the connection to be ready. If we time out we
  // still leave the state in the map so subsequent calls (e.g. /leave)
  // can clean up; we surface a logical "connected: false" via the
  // connection status string.
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (err) {
    log.error({ err, guildId, channelId }, "voice connection failed to ready");
  }
  return getStatus(guildId);
}

/**
 * Leave the guild voice channel. No-op if not connected.
 */
export function leaveVoice(guildId: string): VoiceStatus {
  const state = states.get(guildId);
  if (!state) return getStatus(guildId);
  state.player.stop(true);
  state.connection.destroy();
  states.delete(guildId);
  return getStatus(guildId);
}

/**
 * Stream-decode and play an audio URL. Returns immediately once the
 * player accepts the resource — playback continues in the background.
 *
 * Replaces any currently-playing track. Caller must already be joined
 * via joinVoice() — we don't auto-join (the channel choice is policy).
 */
export function playUrl(guildId: string, url: string): VoiceStatus {
  const state = states.get(guildId);
  if (!state) {
    throw new Error("not_joined");
  }
  // ffmpeg presence check is best-effort — prism-media will throw a
  // clearer error during spawn if there's no ffmpeg on PATH.
  // Spawn ffmpeg with a generic decode pipeline: input from URL,
  // resample to 48kHz stereo PCM (Discord's native sample rate), pipe
  // to stdout. prism-media handles the lifecycle.
  //
  // -reconnect 1 + -reconnect_streamed 1 keeps long radio streams
  // alive across transient network blips (without these the stream
  // stops at the first TCP RST).
  const ffmpeg = new prism.FFmpeg({
    args: [
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-loglevel",
      "error",
      "-i",
      url,
      "-analyzeduration",
      "0",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
    ],
  });
  // Surface ffmpeg stderr so playback failures aren't silent. The
  // 'error' loglevel above keeps the volume down; we only see real
  // problems (stream 404s, decode failures) here.
  ffmpeg.on("error", (err) => {
    log.error({ err, url, guildId }, "ffmpeg pipeline error");
  });
  // prism.FFmpeg exposes the underlying child process via .process;
  // tap stderr so we capture exec-level errors too (the 'error' event
  // above only fires for transformer-level failures).
  const child = (
    ffmpeg as unknown as {
      process?: {
        stderr?: { on: (e: string, cb: (b: Buffer) => void) => void };
      };
    }
  ).process;
  child?.stderr?.on("data", (b: Buffer) => {
    const text = b.toString("utf8").trim();
    if (text) log.warn({ url, guildId, ffmpeg: text }, "ffmpeg stderr");
  });
  const resource = createAudioResource(ffmpeg, {
    inputType: StreamType.Raw,
  });
  log.info(
    {
      url,
      guildId,
      channelId: state.channelId,
      ffmpegPath: process.env.FFMPEG_PATH,
    },
    "playUrl: spawning ffmpeg + queueing resource",
  );
  state.player.play(resource);
  state.playingUrl = url;

  // Player state observability — without these the only signal of a
  // failed stream is silence in the channel. We log every transition
  // (idle→buffering→playing→idle) so we can see how far the pipeline
  // got before giving up.
  // INFO level (not debug) so it surfaces in prod where the default
  // is LOG_LEVEL=info; this is intended audit data, not noisy debug.
  const onStateChange = (
    oldState: { status: string },
    newState: { status: string },
  ): void => {
    log.info(
      { url, guildId, from: oldState.status, to: newState.status },
      "audio player state change",
    );
  };
  state.player.on("stateChange", onStateChange);
  state.player.on("error", (err) => {
    log.error({ err, url, guildId }, "audio player error");
  });
  state.player.once(AudioPlayerStatus.Idle, () => {
    if (state.playingUrl === url) {
      state.playingUrl = null;
    }
    state.player.off("stateChange", onStateChange);
  });
  return getStatus(guildId);
}

export function stopPlayback(guildId: string): VoiceStatus {
  const state = states.get(guildId);
  if (!state) return getStatus(guildId);
  state.player.stop(true);
  state.playingUrl = null;
  return getStatus(guildId);
}

export function getStatus(guildId: string): VoiceStatus {
  const state = states.get(guildId);
  if (!state) {
    return {
      connected: false,
      channelId: null,
      playing: false,
      playingUrl: null,
      connectionStatus: null,
      playerStatus: null,
    };
  }
  return {
    connected: state.connection.state.status === VoiceConnectionStatus.Ready,
    channelId: state.channelId,
    playing: state.player.state.status === AudioPlayerStatus.Playing,
    playingUrl: state.playingUrl,
    connectionStatus: state.connection.state.status,
    playerStatus: state.player.state.status,
  };
}

/**
 * Tear down all active voice connections. Used by graceful shutdown
 * paths (and by tests).
 */
export function shutdownAllVoice(): void {
  for (const [guildId, state] of states.entries()) {
    try {
      state.player.stop(true);
      state.connection.destroy();
    } catch (err) {
      log.warn({ err, guildId }, "error during voice shutdown");
    }
  }
  states.clear();
}
