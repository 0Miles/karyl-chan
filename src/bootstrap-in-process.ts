import { registerPictureOnlyChannelCommands } from "./modules/builtin-features/picture-only/picture-only-channel.commands.js";
import { registerRconForwardChannelCommands } from "./modules/builtin-features/rcon-forward/rcon-forward-channel.commands.js";
import { registerRoleEmojiCommands } from "./modules/builtin-features/role-emoji/role-emoji.commands.js";
import { registerTodoChannelCommands } from "./modules/builtin-features/todo-channel/todo-channel.commands.js";
import { registerVoiceCommands } from "./modules/voice/voice.commands.js";

/**
 * Single explicit registration point for every in-process slash
 * command and modal handler the bot ships. Replaces the
 * `@discordx/importer` glob scan + decorator side-effects.
 *
 * Call once at bot startup BEFORE the registry's
 * syncInProcessCommandsToDiscord runs (which happens in main.ts'
 * ready handler).
 *
 * Adding a new built-in command:
 *   1) Write a `registerXyzCommands()` exporter in src/commands/xyz.ts
 *      that calls registerInProcessCommand(...) — no decorators.
 *   2) Import + invoke it here.
 */
export function bootstrapInProcessFeatures(): void {
  registerPictureOnlyChannelCommands();
  registerTodoChannelCommands();
  registerRoleEmojiCommands();
  registerRconForwardChannelCommands();
  registerVoiceCommands();
}
