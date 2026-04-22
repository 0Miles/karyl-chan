import { CommandInteraction, GuildMember } from 'discord.js';
import { FAILED_COLOR } from '../utils/constant.js';
import { Capability } from './capabilities.js';
import { hasCapability } from './permission.service.js';

export async function requireCapability(command: CommandInteraction, capability: Capability): Promise<boolean> {
    if (!command.guild || !command.member) {
        await command.reply({ content: 'Guild only.', flags: 'Ephemeral' }).catch(() => {});
        return false;
    }
    const allowed = await hasCapability(command.guild, command.member as GuildMember, capability);
    if (!allowed) {
        await command.reply({
            embeds: [{
                color: FAILED_COLOR,
                title: 'Permission Denied',
                description: `缺少權限：\`${capability}\``
            }],
            flags: 'Ephemeral'
        }).catch(() => {});
    }
    return allowed;
}
