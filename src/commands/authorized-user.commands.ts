import { ApplicationCommandOptionType, CommandInteraction, User } from 'discord.js';
import { Discord, Slash, SlashGroup, SlashOption } from 'discordx';
import { FAILED_COLOR, SUCCEEDED_COLOR } from '../utils/constant.js';
import {
    addAuthorizedUser,
    listAuthorizedUsers,
    listAdminRoles,
    removeAuthorizedUser
} from '../web/authorized-user.service.js';

async function ensureBotOwner(command: CommandInteraction): Promise<boolean> {
    const ownerId = process.env.BOT_OWNER_ID?.trim();
    if (ownerId && command.user.id === ownerId) return true;
    await command.reply({
        embeds: [{
            color: FAILED_COLOR,
            title: 'Permission Denied',
            description: '僅 bot owner 可管理授權使用者。'
        }],
        flags: 'Ephemeral'
    }).catch(() => {});
    return false;
}

@Discord()
@SlashGroup({ description: 'Manage web-panel authorized users', name: 'admin-user', defaultMemberPermissions: '8' })
@SlashGroup('admin-user')
export class AuthorizedUserCommands {
    @Slash({ name: 'grant', description: 'Allow a Discord user to request a web login link' })
    async grant(
        @SlashOption({
            description: 'Discord user to grant access to',
            name: 'user',
            required: true,
            type: ApplicationCommandOptionType.User
        }) user: User,
        @SlashOption({
            description: 'admin role name (must already exist — see /admin-role list)',
            name: 'role',
            required: true,
            type: ApplicationCommandOptionType.String
        }) role: string,
        @SlashOption({
            description: 'optional note',
            name: 'note',
            required: false,
            type: ApplicationCommandOptionType.String
        }) note: string | undefined,
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
        await addAuthorizedUser(user.id, role, note ?? null);
        await command.reply({
            embeds: [{
                color: SUCCEEDED_COLOR,
                title: 'Authorized',
                description: `${user.toString()} → \`${role}\``
            }],
            flags: 'Ephemeral'
        });
    }

    @Slash({ name: 'revoke', description: 'Remove a user from the web-panel allow list' })
    async revoke(
        @SlashOption({
            description: 'Discord user to revoke',
            name: 'user',
            required: true,
            type: ApplicationCommandOptionType.User
        }) user: User,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await ensureBotOwner(command))) return;
        const removed = await removeAuthorizedUser(user.id);
        await command.reply({
            embeds: [{
                color: removed ? SUCCEEDED_COLOR : FAILED_COLOR,
                title: removed ? 'Revoked' : 'Not authorized',
                description: removed
                    ? `${user.toString()} removed from allow list`
                    : `${user.toString()} was not in the allow list`
            }],
            flags: 'Ephemeral'
        });
    }

    @Slash({ name: 'list', description: 'Show all users currently allowed to request a login link' })
    async list(command: CommandInteraction): Promise<void> {
        if (!(await ensureBotOwner(command))) return;
        const users = await listAuthorizedUsers();
        if (users.length === 0) {
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    title: 'Authorized users',
                    description: '_Only the bot owner is authorized._'
                }],
                flags: 'Ephemeral'
            });
            return;
        }
        const fields = users.map(u => ({
            name: `<@${u.userId}>`,
            value: `**role:** \`${u.role}\`${u.note ? `\n_${u.note}_` : ''}`
        }));
        await command.reply({
            embeds: [{
                color: SUCCEEDED_COLOR,
                title: 'Authorized users',
                fields
            }],
            flags: 'Ephemeral'
        });
    }
}
