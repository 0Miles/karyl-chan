import { MessageReaction, PartialMessageReaction, Role } from 'discord.js';
import type { ArgsOf, Client } from 'discordx';
import { Discord, On } from 'discordx';
import { findRoleReceiveMessage } from '../models/role-receive-message.model.js';
import { findRoleEmojiInGroups } from '../models/role-emoji.model.js';
import { findAllRoleEmojiGroups } from '../models/role-emoji-group.model.js';
import { findMessageGroupIds } from '../models/role-receive-message-group.model.js';

/**
 * Hydrate a partial reaction (and its parent message) before we read
 * `guildId` / `emoji.name` / etc. off of it.
 *
 * After a bot restart, reactions on uncached messages arrive as
 * partials — discord.js fills in only what the gateway packet carried,
 * which omits `guildId` on the partial Message in practice. Earlier
 * versions of this handler bailed on `if (!guildId) return;`, which
 * looked exactly like "watch doesn't work after a restart." `fetch()`
 * round-trips to Discord and rebuilds a full Reaction + Message so the
 * downstream lookups have what they need.
 */
async function hydrateReaction(messageReaction: MessageReaction | PartialMessageReaction): Promise<MessageReaction | null> {
    if (messageReaction.partial) {
        try {
            await messageReaction.fetch();
        } catch (err) {
            console.error('role-emoji: failed to fetch partial reaction:', err);
            return null;
        }
    }
    if (messageReaction.message.partial) {
        try {
            await messageReaction.message.fetch();
        } catch (err) {
            console.error('role-emoji: failed to fetch partial message:', err);
            return null;
        }
    }
    return messageReaction as MessageReaction;
}

/**
 * Look up the role mapped to the emoji on a watched message. Returns
 * null when the message isn't being watched, the emoji isn't mapped,
 * or the mapped role has been deleted from the guild.
 *
 * Group resolution: a message can be pinned to a subset of the guild's
 * emoji groups. When no pin exists, every group in the guild is
 * eligible — keeping the legacy "one bag of mappings" behaviour for
 * setups that don't need scoping.
 */
async function getRoleForReaction(messageReaction: MessageReaction): Promise<Role | null> {
    const guildId = messageReaction.message.guildId;
    if (!guildId) return null;
    const channelId = messageReaction.message.channelId;
    const messageId = messageReaction.message.id;
    const watched = await findRoleReceiveMessage(guildId, channelId, messageId);
    if (!watched) return null;

    let groupIds = await findMessageGroupIds(guildId, channelId, messageId);
    if (groupIds.length === 0) {
        const allGroups = await findAllRoleEmojiGroups(guildId);
        groupIds = allGroups.map(g => g.getDataValue('id') as number);
    }
    if (groupIds.length === 0) return null;

    const emojiId = messageReaction.emoji.id ?? '';
    const emojiChar = emojiId ? '' : (messageReaction.emoji.name ?? '');
    const roleEmoji = await findRoleEmojiInGroups(groupIds, emojiChar, emojiId);
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
            const hydrated = await hydrateReaction(messageReaction);
            if (!hydrated) return;
            const role = await getRoleForReaction(hydrated);
            if (!role) return;
            // Members aren't pre-fetched at startup — `cache.find` would
            // miss anyone whose presence the bot hasn't observed yet.
            // `members.fetch(id)` returns the cached entry on a hit and
            // round-trips to Discord on a miss, so it works either way.
            const member = await hydrated.message.guild?.members.fetch(user.id).catch(() => null);
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
            const hydrated = await hydrateReaction(messageReaction);
            if (!hydrated) return;
            const role = await getRoleForReaction(hydrated);
            if (!role) return;
            const member = await hydrated.message.guild?.members.fetch(user.id).catch(() => null);
            if (!member) return;
            await member.roles.remove(role);
        } catch (ex) {
            console.error('role-emoji messageReactionRemove failed:', ex);
        }
    }
}
