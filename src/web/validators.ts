/**
 * Tiny, dependency-free validators used across the admin API. The
 * shapes Fastify hands us are `unknown`; these helpers narrow them
 * with a single boolean return so route handlers can branch with a
 * minimum of ceremony.
 *
 * Keep these strict — we'd rather 400 a borderline input than push
 * malformed data through to Discord (rejection there is loud and
 * confusing) or persist it to SQLite (silent corruption).
 */

/**
 * Discord's snowflake format: 17–20 digit decimal integer. Used for
 * user, channel, role, message, sticker, and guild IDs alike.
 */
const SNOWFLAKE_RE = /^\d{17,20}$/;

export function isSnowflake(value: unknown): value is string {
    return typeof value === 'string' && SNOWFLAKE_RE.test(value);
}

export function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * `true` if `value` is a string, after trim is non-empty, and its
 * total length (pre-trim) is within `maxLen`. The pre-trim check is
 * deliberate — we don't want a megabyte of whitespace getting saved.
 */
export function isBoundedString(value: unknown, maxLen: number): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen;
}

/**
 * Discord's hard limit on a regular bot user message content field.
 * Premium tiers can go higher but we don't try to detect that — sending
 * 2001+ would just 400 from Discord anyway.
 */
export const DISCORD_MESSAGE_MAX = 2000;

/** Max size we'll persist for an admin role description. */
export const ROLE_DESCRIPTION_MAX = 500;

/** Max size we'll persist for an admin user note. */
export const USER_NOTE_MAX = 500;
