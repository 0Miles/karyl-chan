// Remembers the last channel the user viewed so switching guilds (or
// reopening the app) returns to context instead of dumping them at the
// top of the list. Per-guild for guild channels, a single slot for DMs,
// plus a "last surface" record that pinpoints which guild/DM the user
// was on last so `/admin/messages` with an empty URL can restore it.
// All calls swallow errors so disabled/full storage never breaks navigation.

const DM_KEY = 'karyl-last-dm-channel';
const GUILD_KEY = 'karyl-last-guild-channels';
const SURFACE_KEY = 'karyl-last-surface';

export function loadLastDmChannel(): string | null {
    try {
        return localStorage.getItem(DM_KEY);
    } catch {
        return null;
    }
}

export function saveLastDmChannel(channelId: string): void {
    try {
        localStorage.setItem(DM_KEY, channelId);
    } catch {
        /* storage unavailable */
    }
}

function loadGuildMap(): Record<string, string> {
    try {
        const raw = localStorage.getItem(GUILD_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
    } catch {
        return {};
    }
}

export function loadLastGuildChannel(guildId: string): string | null {
    return loadGuildMap()[guildId] ?? null;
}

export function saveLastGuildChannel(guildId: string, channelId: string): void {
    try {
        const map = loadGuildMap();
        map[guildId] = channelId;
        localStorage.setItem(GUILD_KEY, JSON.stringify(map));
    } catch {
        /* storage unavailable */
    }
}

/**
 * The surface-level record: remembers not just "which channel in guild A"
 * but also whether the user was last in a guild (and which) or in DM.
 * Used by MessagesPage to restore context when the URL arrives empty.
 */
export interface LastSurface {
    /** Either `'dm'` or a guild id. */
    mode: string;
    channelId: string;
}

export function loadLastSurface(): LastSurface | null {
    try {
        const raw = localStorage.getItem(SURFACE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
            parsed
            && typeof parsed === 'object'
            && typeof parsed.mode === 'string' && parsed.mode.length > 0
            && typeof parsed.channelId === 'string' && parsed.channelId.length > 0
        ) {
            return parsed as LastSurface;
        }
        return null;
    } catch {
        return null;
    }
}

export function saveLastSurface(surface: LastSurface): void {
    try {
        localStorage.setItem(SURFACE_KEY, JSON.stringify(surface));
    } catch {
        /* storage unavailable */
    }
}
