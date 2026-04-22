import { ApplicationCommandOptionType, CommandInteraction, GuildMember, Role } from 'discord.js';
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from 'discordx';
import { FAILED_COLOR, SUCCEEDED_COLOR } from '../utils/constant.js';
import { CAPABILITIES, CAPABILITY_KEYS, Capability, EVERYONE_DEFAULTS } from '../permission/capabilities.js';
import { grantCapability, isOwnerOrAdmin, listGrants, revokeCapability } from '../permission/permission.service.js';

const CAPABILITY_CHOICES = CAPABILITY_KEYS.map(name => ({ name, value: name }));

async function ensureAdmin(command: CommandInteraction): Promise<boolean> {
    const guild = command.guild;
    const member = command.member as GuildMember | null;
    if (!guild || !member) {
        await command.reply({ content: 'Guild only.', flags: 'Ephemeral' }).catch(() => {});
        return false;
    }
    if (!isOwnerOrAdmin(guild, member)) {
        await command.reply({
            embeds: [{
                color: FAILED_COLOR,
                title: 'Permission Denied',
                description: '僅 guild owner 與管理員可管理權限。'
            }],
            flags: 'Ephemeral'
        }).catch(() => {});
        return false;
    }
    return true;
}

@Discord()
@SlashGroup({ description: 'Manage capability grants', name: 'permission', defaultMemberPermissions: '8' })
@SlashGroup('permission')
export class PermissionCommands {
    @Slash({ name: 'grant', description: 'Grant a capability to a role (or @everyone)' })
    async grant(
        @SlashChoice(...CAPABILITY_CHOICES)
        @SlashOption({
            description: 'capability',
            name: 'capability',
            required: true,
            type: ApplicationCommandOptionType.String
        }) capability: Capability,
        @SlashOption({
            description: 'role',
            name: 'role',
            required: true,
            type: ApplicationCommandOptionType.Role
        }) role: Role,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await ensureAdmin(command))) return;
        await grantCapability(command.guildId as string, capability, role.id);
        await command.reply({
            embeds: [{
                color: SUCCEEDED_COLOR,
                title: 'Granted',
                description: `\`${capability}\` → ${role.toString()}`
            }],
            flags: 'Ephemeral'
        });
    }

    @Slash({ name: 'revoke', description: 'Revoke a capability from a role (or @everyone)' })
    async revoke(
        @SlashChoice(...CAPABILITY_CHOICES)
        @SlashOption({
            description: 'capability',
            name: 'capability',
            required: true,
            type: ApplicationCommandOptionType.String
        }) capability: Capability,
        @SlashOption({
            description: 'role',
            name: 'role',
            required: true,
            type: ApplicationCommandOptionType.Role
        }) role: Role,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await ensureAdmin(command))) return;
        await revokeCapability(command.guildId as string, capability, role.id);
        await command.reply({
            embeds: [{
                color: SUCCEEDED_COLOR,
                title: 'Revoked',
                description: `\`${capability}\` ✗ ${role.toString()}`
            }],
            flags: 'Ephemeral'
        });
    }

    @Slash({ name: 'list', description: 'List all capabilities and current grants' })
    async list(command: CommandInteraction): Promise<void> {
        if (!(await ensureAdmin(command))) return;
        const guildId = command.guildId as string;
        const guild = command.guild;
        const grants = await listGrants(guildId);

        const byCapability = new Map<Capability, string[]>();
        for (const c of CAPABILITY_KEYS) byCapability.set(c, []);
        for (const g of grants) {
            byCapability.get(g.capability)?.push(g.roleId);
        }

        const fields = CAPABILITY_KEYS.map(cap => {
            const roleIds = byCapability.get(cap) ?? [];
            const fallback = EVERYONE_DEFAULTS[cap] ? 'allow' : 'deny';
            const grantLabel = roleIds.length === 0
                ? `_no grants_ (fallback: ${fallback} for @everyone)`
                : roleIds.map(rid => {
                    if (rid === guildId) return '@everyone';
                    const role = guild?.roles.cache.get(rid);
                    return role ? role.toString() : `<unknown ${rid}>`;
                }).join(', ');
            return {
                name: cap,
                value: `${CAPABILITIES[cap]}\n${grantLabel}`
            };
        });

        await command.reply({
            embeds: [{
                color: SUCCEEDED_COLOR,
                title: 'Capability grants',
                fields
            }],
            flags: 'Ephemeral'
        });
    }
}
