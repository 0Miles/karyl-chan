/**
 * Admin capability tokens recognized by the backend. Keep this list in
 * sync with `src/permission/admin-capabilities.ts` on the server when
 * adding new tokens — the server is the authority for validation, this
 * file exists so the UI can render the catalog without a round-trip for
 * data that never changes at runtime.
 *
 * Descriptions resolve through i18n under `admin.capabilityDesc.<key>`
 * so the UI matches the active locale instead of a hard-coded string.
 */
export const ADMIN_CAPABILITY_KEYS = ['admin'] as const;

export type AdminCapabilityKey = typeof ADMIN_CAPABILITY_KEYS[number];
