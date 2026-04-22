export const CAPABILITIES = {
    'todo.manage': 'Manage todo-list channels',
    'picture-only.manage': 'Manage picture-only channels',
    'rcon.configure': 'Configure RCON forward channels',
    'rcon.execute': 'Trigger RCON commands in watched channels',
    'role-emoji.manage': 'Manage role-emoji mappings'
} as const;

export type Capability = keyof typeof CAPABILITIES;

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as Capability[];

export function isCapability(value: string): value is Capability {
    return (CAPABILITY_KEYS as string[]).includes(value);
}

// Fallback applied ONLY when no grants exist for a capability in this guild.
// All capabilities default to allow because the first-level filter is
// Discord's defaultMemberPermissions on each SlashGroup (e.g. MANAGE_CHANNELS
// for channel-watch commands) and, for rcon.execute, the channel post
// permission. Our capability system exists so admins can tighten further
// by adding grants — as soon as any grant exists for a capability, the
// evaluator flips to whitelist mode.
export const EVERYONE_DEFAULTS: Record<Capability, boolean> = {
    'todo.manage': true,
    'picture-only.manage': true,
    'rcon.configure': true,
    'role-emoji.manage': true,
    'rcon.execute': true
};
