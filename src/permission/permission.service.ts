import { Guild, GuildMember, PermissionsBitField } from 'discord.js';
import { CapabilityGrant } from '../models/capability-grant.model.js';
import { Capability, EVERYONE_DEFAULTS } from './capabilities.js';

export function isOwnerOrAdmin(guild: Guild, member: GuildMember): boolean {
    if (member.id === guild.ownerId) return true;
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

export interface CapabilityCheckInput {
    capability: Capability;
    memberRoleIds: string[];
    guildId: string;
    isOwnerOrAdmin: boolean;
    grantedRoleIds: Set<string>;
}

// Pure evaluator — safe to unit-test without touching Discord or the DB.
export function evaluateCapability(input: CapabilityCheckInput): boolean {
    if (input.isOwnerOrAdmin) return true;
    if (input.grantedRoleIds.has(input.guildId)) return true;
    for (const roleId of input.memberRoleIds) {
        if (input.grantedRoleIds.has(roleId)) return true;
    }
    return EVERYONE_DEFAULTS[input.capability];
}

export async function hasCapability(guild: Guild, member: GuildMember, capability: Capability): Promise<boolean> {
    const grants = await CapabilityGrant.findAll({
        where: { guildId: guild.id, capability }
    });
    const grantedRoleIds = new Set(grants.map(g => g.getDataValue('roleId') as string));
    return evaluateCapability({
        capability,
        memberRoleIds: [...member.roles.cache.keys()],
        guildId: guild.id,
        isOwnerOrAdmin: isOwnerOrAdmin(guild, member),
        grantedRoleIds
    });
}

export async function grantCapability(guildId: string, capability: Capability, roleId: string): Promise<void> {
    await CapabilityGrant.findOrCreate({
        where: { guildId, capability, roleId },
        defaults: { guildId, capability, roleId }
    });
}

export async function revokeCapability(guildId: string, capability: Capability, roleId: string): Promise<void> {
    await CapabilityGrant.destroy({
        where: { guildId, capability, roleId }
    });
}

export interface Grant {
    capability: Capability;
    roleId: string;
}

export async function listGrants(guildId: string): Promise<Grant[]> {
    const grants = await CapabilityGrant.findAll({ where: { guildId } });
    return grants.map(g => ({
        capability: g.getDataValue('capability') as Capability,
        roleId: g.getDataValue('roleId') as string
    }));
}
