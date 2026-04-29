import type { GuildFeature } from "./types";
import { todoFeature } from "./todo";
import { pictureOnlyFeature } from "./picture-only";
import { rconFeature } from "./rcon";
import { roleEmojiFeature } from "./role-emoji";
import { voiceFeature } from "./voice";

/**
 * Single source of truth for installed guild features. Order here is
 * the order they appear in the features sub-tab + the overview tile
 * grid.
 *
 * Adding a new feature: drop a folder under
 * `modules/guild-features/<name>/`, export a `GuildFeature` from its
 * `index.ts`, and append it here.
 */
export const guildFeatures: GuildFeature[] = [
  todoFeature,
  pictureOnlyFeature,
  rconFeature,
  roleEmojiFeature,
  voiceFeature,
];

export type { GuildFeature } from "./types";
