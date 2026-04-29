import type { Client } from "discord.js";
import { registerDmInboxEvents } from "./events/dm-inbox.events.js";
import { registerGuildChannelEvents } from "./events/guild-channel.events.js";
import { registerPictureOnlyChannelEvents } from "./events/picture-only-channel.events.js";
import { registerRconForwardChannelEvents } from "./events/rcon-forward-channel.events.js";
import { registerRoleEmojiEvents } from "./events/role-emoji.events.js";
import { registerTodoChannelEvents } from "./events/todo-channel.events.js";
import { registerTypingStartEvents } from "./events/typing-start.events.js";
import { registerVoiceStateEvents } from "./events/voice-state.events.js";
import { registerWebhookBehaviorEvents } from "./events/webhook-behavior.events.js";

/**
 * Single explicit registration point for every Discord event handler
 * the bot ships. Replaces the `@discordx/importer` glob scan +
 * `@Discord/@On` decorator side-effects.
 *
 * Adding a new handler: write `registerXyzEvents(client)` in
 * src/events/xyz.events.ts (no decorators, plain `client.on(...)`),
 * import + invoke it here.
 */
export function bootstrapEventHandlers(client: Client): void {
  registerDmInboxEvents(client);
  registerGuildChannelEvents(client);
  registerPictureOnlyChannelEvents(client);
  registerRconForwardChannelEvents(client);
  registerRoleEmojiEvents(client);
  registerTodoChannelEvents(client);
  registerTypingStartEvents(client);
  registerVoiceStateEvents(client);
  registerWebhookBehaviorEvents(client);
}
