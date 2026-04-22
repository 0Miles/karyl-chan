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

// Fallback when no explicit grant exists for a member.
//
// Management capabilities (*.manage, rcon.configure) default to deny —
// only guild owner and Administrator can touch them until an admin
// explicitly grants the capability to a role.
//
// rcon.execute defaults to allow because the real gate is the channel's
// post permission: anyone trusted enough to post in a watched channel
// is trusted to trigger the forwarder. Admins wanting to restrict
// further should rely on channel permissions.
export const EVERYONE_DEFAULTS: Record<Capability, boolean> = {
    'todo.manage': false,
    'picture-only.manage': false,
    'rcon.configure': false,
    'role-emoji.manage': false,
    'rcon.execute': true
};
