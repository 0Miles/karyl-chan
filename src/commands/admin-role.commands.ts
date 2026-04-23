import { ApplicationCommandOptionType, CommandInteraction } from 'discord.js';
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from 'discordx';
import { FAILED_COLOR, SUCCEEDED_COLOR } from '../utils/constant.js';
import {
    ADMIN_CAPABILITIES,
    ADMIN_CAPABILITY_KEYS,
    createAdminRole,
    deleteAdminRole,
    grantRoleCapability,
    listAdminRoles,
    revokeRoleCapability,
    type AdminCapability
} from '../web/authorized-user.service.js';

const CAPABILITY_CHOICES = ADMIN_CAPABILITY_KEYS.map(name => ({ name, value: name }));

async function ensureBotOwner(command: CommandInteraction): Promise<boolean> {
    const ownerId = process.env.BOT_OWNER_ID?.trim();
    if (ownerId && command.user.id === ownerId) return true;
    await command.reply({
        embeds: [{
            color: FAILED_COLOR,
            title: 'Permission Denied',
            description: '僅 bot owner 可管理身分組。'
        }],
        flags: 'Ephemeral'
    }).catch(() => {});
    return false;
}

@Discord()
@SlashGroup({ description: 'Manage admin-panel role definitions', name: 'admin-role', defaultMemberPermissions: '8' })
@SlashGroup('admin-role')
export class AdminRoleCommands {
    @Slash({ name: 'create', description: 'Create or update a role' })
    async create(
        @SlashOption({
            description: 'role name',
            name: 'name',
            required: true,
            type: ApplicationCommandOptionType.String
        }) name: string,
        @SlashOption({
            description: 'optional description',
            name: 'description',
            required: false,
            type: ApplicationCommandOptionType.String
        }) description: string | undefined,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await ensureBotOwner(command))) return;
        const record = await createAdminRole(name, description ?? null);
        await command.reply({
            embeds: [{
                color: SUCCEEDED_COLOR,
                title: 'Role ready',
                description: `\`${record.name}\` saved${record.description ? `\n_${record.description}_` : ''}`
            }],
            flags: 'Ephemeral'
        });
    }

    @Slash({ name: 'delete', description: 'Delete a role (users still referencing it lose access)' })
    async delete(
        @SlashOption({
            description: 'role name',
            name: 'name',
            required: true,
            type: ApplicationCommandOptionType.String
        }) name: string,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await ensureBotOwner(command))) return;
        const removed = await deleteAdminRole(name);
        await command.reply({
            embeds: [{
                color: removed ? SUCCEEDED_COLOR : FAILED_COLOR,
                title: removed ? 'Role deleted' : 'No such role',
                description: `\`${name}\``
            }],
            flags: 'Ephemeral'
        });
    }

    @Slash({ name: 'grant-cap', description: 'Add a capability token to a role' })
    async grantCap(
        @SlashOption({
            description: 'role name',
            name: 'role',
            required: true,
            type: ApplicationCommandOptionType.String
        }) role: string,
        @SlashChoice(...CAPABILITY_CHOICES)
        @SlashOption({
            description: 'capability token',
            name: 'capability',
            required: true,
            type: ApplicationCommandOptionType.String
        }) capability: AdminCapability,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await ensureBotOwner(command))) return;
        const roles = await listAdminRoles();
        if (!roles.some(r => r.name === role)) {
            await command.reply({
                embeds: [{
                    color: FAILED_COLOR,
                    title: 'Unknown role',
                    description: `Role \`${role}\` does not exist. Create it first with \`/admin-role create\`.`
                }],
                flags: 'Ephemeral'
            });
            return;
        }
        await grantRoleCapability(role, capability);
        await command.reply({
            embeds: [{
                color: SUCCEEDED_COLOR,
                title: 'Capability granted',
                description: `\`${role}\` + \`${capability}\``
            }],
            flags: 'Ephemeral'
        });
    }

    @Slash({ name: 'revoke-cap', description: 'Remove a capability token from a role' })
    async revokeCap(
        @SlashOption({
            description: 'role name',
            name: 'role',
            required: true,
            type: ApplicationCommandOptionType.String
        }) role: string,
        @SlashChoice(...CAPABILITY_CHOICES)
        @SlashOption({
            description: 'capability token',
            name: 'capability',
            required: true,
            type: ApplicationCommandOptionType.String
        }) capability: AdminCapability,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await ensureBotOwner(command))) return;
        await revokeRoleCapability(role, capability);
        await command.reply({
            embeds: [{
                color: SUCCEEDED_COLOR,
                title: 'Capability revoked',
                description: `\`${role}\` − \`${capability}\``
            }],
            flags: 'Ephemeral'
        });
    }

    @Slash({ name: 'list', description: 'Show every role and the capabilities it grants' })
    async list(command: CommandInteraction): Promise<void> {
        if (!(await ensureBotOwner(command))) return;
        const roles = await listAdminRoles();
        if (roles.length === 0) {
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    title: 'Admin roles',
                    description: '_No roles defined._'
                }],
                flags: 'Ephemeral'
            });
            return;
        }
        const fields = roles.map(r => ({
            name: r.name,
            value: [
                r.description ? `_${r.description}_` : null,
                r.capabilities.length
                    ? '**capabilities:** ' + r.capabilities.map(c => `\`${c}\``).join(', ')
                    : '_no capabilities — treated as unauthorized_'
            ].filter(Boolean).join('\n')
        }));
        const knownCaps = Object.entries(ADMIN_CAPABILITIES)
            .map(([key, desc]) => `• \`${key}\` — ${desc}`).join('\n');
        await command.reply({
            embeds: [{
                color: SUCCEEDED_COLOR,
                title: 'Admin roles',
                fields,
                footer: { text: 'Known capability tokens' },
                description: knownCaps
            }],
            flags: 'Ephemeral'
        });
    }
}
