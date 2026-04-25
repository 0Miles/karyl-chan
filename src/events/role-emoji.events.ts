import { findRoleEmoji } from './../models/role-emoji.model.js';
import { MessageReaction, PartialMessageReaction, Role } from 'discord.js';
import type { ArgsOf, Client } from 'discordx';
import { Discord, On } from 'discordx';
import { findRoleReceiveMessage } from '../models/role-receive-message.model.js';

/**
 * Look up the role mapped to the emoji on a watched message. Returns
 * null when the message isn't being watched, the emoji isn't mapped,
 * or the mapped role has been deleted from the guild.
 */
async function getRoleForReaction(messageReaction: MessageReaction | PartialMessageReaction): Promise<Role | null> {
    const guildId = messageReaction.message.guildId;
    if (!guildId) return null;
    const watched = await findRoleReceiveMessage(guildId, messageReaction.message.channelId, messageReaction.message.id);
    if (!watched) return null;
    const emojiId = messageReaction.emoji.id ?? '';
    const emojiChar = emojiId ? '' : (messageReaction.emoji.name ?? '');
    const roleEmoji = await findRoleEmoji(guildId, emojiChar, emojiId);
    if (!roleEmoji) return null;
    const roleId = roleEmoji.getDataValue('roleId') as string;
    return messageReaction.message.guild?.roles.cache.get(roleId) ?? null;
}

@Discord()
export class RoleEmojiEvents {
    @On()
    async messageReactionAdd([messageReaction, user]: ArgsOf<'messageReactionAdd'>, client: Client): Promise<void> {
        try {
            if (user.id === client.user?.id) return;
            const role = await getRoleForReaction(messageReaction);
            if (!role) return;
            // Members aren't pre-fetched at startup — `cache.find` would
            // miss anyone whose presence the bot hasn't observed yet.
            // `members.fetch(id)` returns the cached entry on a hit and
            // round-trips to Discord on a miss, so it works either way.
            const member = await messageReaction.message.guild?.members.fetch(user.id).catch(() => null);
            if (!member) return;
            await member.roles.add(role);
        } catch (ex) {
            console.error('role-emoji messageReactionAdd failed:', ex);
        }
    }

    @On()
    async messageReactionRemove([messageReaction, user]: ArgsOf<'messageReactionRemove'>, client: Client): Promise<void> {
        try {
            if (user.id === client.user?.id) return;
            const role = await getRoleForReaction(messageReaction);
            if (!role) return;
            const member = await messageReaction.message.guild?.members.fetch(user.id).catch(() => null);
            if (!member) return;
            await member.roles.remove(role);
        } catch (ex) {
            console.error('role-emoji messageReactionRemove failed:', ex);
        }
    }
}