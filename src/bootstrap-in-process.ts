import { registerPictureOnlyChannelCommands } from "./commands/picture-only-channel.commands.js";
import { registerRconForwardChannelCommands } from "./commands/rcon-forward-channel.commands.js";
import { registerRoleEmojiCommands } from "./commands/role-emoji.commands.js";
import { registerTodoChannelCommands } from "./commands/todo-channel.commands.js";

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
}
