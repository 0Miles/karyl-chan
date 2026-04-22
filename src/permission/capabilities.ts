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

// Fallback when no explicit grant exists for a member. Critical capabilities
// default to deny; other features still have Discord's defaultMemberPermissions
// as a first-level visual filter on the slash commands.
export const EVERYONE_DEFAULTS: Record<Capability, boolean> = {
    'todo.manage': true,
    'picture-only.manage': true,
    'rcon.configure': true,
    'role-emoji.manage': true,
    'rcon.execute': false
};
