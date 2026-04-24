// Remembers the last channel the user viewed so switching guilds (or
// reopening the app) returns to context instead of dumping them at the
// top of the list. Per-guild for guild channels, a single slot for DMs.
// All calls swallow errors so disabled/full storage never breaks navigation.

const DM_KEY = 'karyl-last-dm-channel';
const GUILD_KEY = 'karyl-last-guild-channels';

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
