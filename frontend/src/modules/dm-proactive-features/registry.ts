import type { DmProactiveFeature } from './types';
import { adminLoginFeature } from './admin-login';

/**
 * Single source of truth for installed DM proactive features. Order
 * here is the order they appear in the composer's popover menu.
 *
 * Adding a new feature: drop a folder under
 * `modules/dm-proactive-features/<name>/`, export a
 * `DmProactiveFeature` from its `index.ts`, append it here, and add
 * a backend handler under
 * `/api/dm/channels/:channelId/proactive/:action` for the matching
 * action name.
 */
export const dmProactiveFeatures: DmProactiveFeature[] = [
    adminLoginFeature
];

export type { DmProactiveFeature } from './types';
