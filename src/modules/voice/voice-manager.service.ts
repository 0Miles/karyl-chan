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
import { PassThrough, pipeline } from "stream";
import prism from "prism-media";
import { config } from "../../config.js";
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
  /** True when the player is user-paused (Paused — not AutoPaused, which
   *  just means nobody's listening). `playing` stays true while paused. */
  paused: boolean;
  playingUrl: string | null;
  /** Reflects @discordjs/voice's connection status string. */
  connectionStatus: string | null;
  /** Reflects @discordjs/voice's player status string. */
  playerStatus: string | null;
  /**
   * Non-bot members currently in the bot's voice channel. Filled in by the
   * `voice.status` RPC (it has the discord.js client; this service doesn't)
   * — `undefined` when not connected or the channel can't be inspected.
   * `0` means the bot is alone — a plugin can use this to auto-leave.
   */
  listeners?: number;
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
  //
  // -rw_timeout (microseconds) bounds a single input I/O wait: if the
  // source socket goes silent for ~10 s ffmpeg errors out instead of
  // hanging forever on a dead connection — and -reconnect then retries
  // from where it left off. Short network jitter (sub-2 s) is absorbed
  // by the PassThrough buffer below, so this only trips on real stalls.
  //
  // -protocol_whitelist locks ffmpeg's *input* side to the HTTP stack
  // (+ pipe/fd for prism's stdout output, + crypto for AES-HLS segments)
  // — so a crafted playlist/manifest can't pivot to file:/concat:/
  // subfile:/data:/gopher: and read local files or reach other
  // protocols. Combined with the SSRF host-policy check in voice-rpc.ts,
  // this keeps `/radio play <url>` from being a foothold.
  const ffmpeg = new prism.FFmpeg({
    args: [
      "-protocol_whitelist",
      "http,https,tls,tcp,crypto,pipe,fd",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-rw_timeout",
      "10000000",
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
  // prism.FFmpeg exposes the underlying child process via .process;
  // tap stderr so we capture exec-level errors too (the pipeline()
  // callback below only fires for transformer-/stream-level failures).
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
  // A ~2 s PCM jitter buffer between ffmpeg and the audio player. ffmpeg
  // races ahead to keep it full (back-pressured once it is), so when the
  // source CDN hiccups the player drains the buffer instead of starving
  // — no stutter / speed-up artefact for sub-2 s blips. 192 kB/s is the
  // 48 kHz·stereo·s16le rate. pipeline() ties their lifecycles together:
  // an ffmpeg error/EOF tears down the buffer, and the buffer being
  // destroyed (the player swapping in the next track) kills the ffmpeg
  // child — so a skip never leaks a zombie ffmpeg.
  const PCM_BYTES_PER_SECOND = 48_000 * 2 * 2;
  const buffered = new PassThrough({ highWaterMark: PCM_BYTES_PER_SECOND * 2 });
  pipeline(ffmpeg, buffered, (err) => {
    // ERR_STREAM_PREMATURE_CLOSE just means the player swapped this track
    // out (skip / stop / leave) and destroyed the buffer — expected.
    if (err && (err as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE") {
      log.warn({ err, url, guildId }, "ffmpeg → playback buffer error");
    }
  });
  const resource = createAudioResource(buffered, {
    inputType: StreamType.Raw,
  });
  log.info(
    {
      url,
      guildId,
      channelId: state.channelId,
      ffmpegPath: config.voice.ffmpegPath,
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
  //
  // Both listeners are removed on Idle. The error handler used to be
  // registered without cleanup; every playUrl call added a fresh
  // `error` listener and the AudioPlayer eventually crossed Node's
  // 10-listener warning threshold, after which Node logs a leak
  // warning on every play.
  const onStateChange = (
    oldState: { status: string },
    newState: { status: string },
  ): void => {
    log.info(
      { url, guildId, from: oldState.status, to: newState.status },
      "audio player state change",
    );
  };
  const onError = (err: Error): void => {
    log.error({ err, url, guildId }, "audio player error");
  };
  state.player.on("stateChange", onStateChange);
  state.player.on("error", onError);
  state.player.once(AudioPlayerStatus.Idle, () => {
    if (state.playingUrl === url) {
      state.playingUrl = null;
    }
    state.player.off("stateChange", onStateChange);
    state.player.off("error", onError);
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

/**
 * Pause / resume the current track. `paused` undefined → toggle. No-op
 * (returns the current status) if not joined or nothing is playing.
 * Pausing keeps the ffmpeg pipe alive — fine for library files and most
 * progressive streams, but a live radio stream resumed after a long
 * pause may have buffered/stalled; callers that care should treat pause
 * as a short-lived control.
 */
export function pausePlayback(
  guildId: string,
  paused?: boolean,
): VoiceStatus {
  const state = states.get(guildId);
  if (!state) return getStatus(guildId);
  const isPaused = state.player.state.status === AudioPlayerStatus.Paused;
  const want = paused ?? !isPaused;
  if (want) state.player.pause(true);
  else state.player.unpause();
  return getStatus(guildId);
}

export function getStatus(guildId: string): VoiceStatus {
  const state = states.get(guildId);
  if (!state) {
    return {
      connected: false,
      channelId: null,
      playing: false,
      paused: false,
      playingUrl: null,
      connectionStatus: null,
      playerStatus: null,
    };
  }
  return {
    connected: state.connection.state.status === VoiceConnectionStatus.Ready,
    channelId: state.channelId,
    paused: state.player.state.status === AudioPlayerStatus.Paused,
    // "playing" = the player currently holds an audio resource — i.e. any
    // state that isn't Idle (Playing, but also Buffering during a freshly
    // started track, AutoPaused, Paused). Reporting only `=== Playing`
    // here made callers (the radio plugin's advance loop) think nothing
    // was playing during the 1–3 s ffmpeg startup of a just-started
    // track and "advance" past it — desyncing the WebUI / cutting tracks.
    playing: state.player.state.status !== AudioPlayerStatus.Idle,
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
