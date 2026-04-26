import type { BotPlugin } from './types';
import { todoPlugin } from './todo';
import { pictureOnlyPlugin } from './picture-only';
import { rconPlugin } from './rcon';
import { roleEmojiPlugin } from './role-emoji';
import { permissionPlugin } from './permission';

/**
 * Single source of truth for installed bot plugins. Order here is the
 * order they appear in the features sub-tab + the overview tile grid.
 *
 * Adding a new plugin: drop a folder under `plugins/<name>/`, export a
 * `BotPlugin` from its `index.ts`, and append it here.
 */
export const plugins: BotPlugin[] = [
    todoPlugin,
    pictureOnlyPlugin,
    rconPlugin,
    roleEmojiPlugin,
    permissionPlugin
];

export type { BotPlugin } from './types';
