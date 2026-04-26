import { FAILED_COLOR, SUCCEEDED_COLOR } from './../utils/constant.js';
import { CommandInteraction, ApplicationCommandOptionType, Role } from 'discord.js';
import { Discord, Slash, SlashGroup, SlashOption } from 'discordx';
import {
    addRoleEmoji,
    removeRoleEmoji,
    findRoleEmojiInGroup,
    findAllRoleEmojisInGroup
} from '../models/role-emoji.model.js';
import {
    findRoleReceiveMessage,
    upsertRoleReceiveMessage,
    removeRoleReceiveMessage
} from '../models/role-receive-message.model.js';
import {
    addRoleEmojiGroup,
    findAllRoleEmojiGroups,
    findRoleEmojiGroupByName,
    removeRoleEmojiGroup
} from '../models/role-emoji-group.model.js';
import { requireCapability } from '../permission/permission-check.js';

const EMOJI_REGEX = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])|^<(a?:[^:>]+:)([^>]+)>$/;

@Discord()
@SlashGroup({ description: 'Manage role-emoji', name: 'role-emoji', defaultMemberPermissions: '268435456' })
@SlashGroup({ description: 'Manage emoji groups', name: 'group', root: 'role-emoji' })
export class RoleEmojiCommands {
    // ── group ────────────────────────────────────────────────────────────

    @Slash({ name: 'add', description: 'Create a new emoji group' })
    @SlashGroup('group', 'role-emoji')
    async groupAdd(
        @SlashOption({
            description: 'group name',
            name: 'name',
            required: true,
            type: ApplicationCommandOptionType.String
        }) name: string,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        const trimmed = name.trim();
        if (!trimmed) {
            await command.reply({ content: 'Group name cannot be empty.', flags: 'Ephemeral' });
            return;
        }
        const guildId = command.guildId as string;
        try {
            const existing = await findRoleEmojiGroupByName(guildId, trimmed);
            if (existing) {
                await command.reply({
                    embeds: [{ color: FAILED_COLOR, title: 'Failed', description: `Group \`\`${trimmed}\`\` already exists.` }],
                    flags: 'Ephemeral'
                });
                return;
            }
            await addRoleEmojiGroup(guildId, trimmed);
            await command.reply({
                embeds: [{ color: SUCCEEDED_COLOR, title: 'Succeeded', description: `Group \`\`${trimmed}\`\` created.` }],
                flags: 'Ephemeral'
            });
        } catch (ex) {
            console.error(ex);
        }
    }

    @Slash({ name: 'remove', description: 'Delete an emoji group (and its mappings)' })
    @SlashGroup('group', 'role-emoji')
    async groupRemove(
        @SlashOption({
            description: 'group name',
            name: 'name',
            required: true,
            type: ApplicationCommandOptionType.String
        }) name: string,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        const guildId = command.guildId as string;
        try {
            const existing = await findRoleEmojiGroupByName(guildId, name.trim());
            if (!existing) {
                await command.reply({
                    embeds: [{ color: FAILED_COLOR, title: 'Failed', description: `Group \`\`${name}\`\` does not exist.` }],
                    flags: 'Ephemeral'
                });
                return;
            }
            await removeRoleEmojiGroup(guildId, existing.getDataValue('id') as number);
            await command.reply({
                embeds: [{ color: SUCCEEDED_COLOR, title: 'Succeeded', description: `Group \`\`${name}\`\` deleted.` }],
                flags: 'Ephemeral'
            });
        } catch (ex) {
            console.error(ex);
        }
    }

    @Slash({ name: 'list', description: 'List emoji groups and their mappings' })
    @SlashGroup('group', 'role-emoji')
    async groupList(command: CommandInteraction): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        const guildId = command.guildId as string;
        try {
            const groups = await findAllRoleEmojiGroups(guildId);
            if (groups.length === 0) {
                await command.reply({
                    embeds: [{ color: SUCCEEDED_COLOR, description: 'No groups defined.' }],
                    flags: 'Ephemeral'
                });
                return;
            }
            const fields = await Promise.all(groups.map(async g => {
                const groupId = g.getDataValue('id') as number;
                const groupName = g.getDataValue('name') as string;
                const mappings = await findAllRoleEmojisInGroup(groupId);
                const lines = mappings.map(m => {
                    const emojiChar = m.getDataValue('emojiChar') as string;
                    const emojiId = m.getDataValue('emojiId') as string;
                    const emojiName = m.getDataValue('emojiName') as string;
                    const role = command.guild?.roles.cache.find(r => r.id === m.getDataValue('roleId'));
                    const display = emojiChar ? emojiChar : `<${emojiName}${emojiId}>`;
                    return `${display} → \`${role?.name ?? m.getDataValue('roleId')}\``;
                });
                return {
                    name: groupName,
                    value: lines.length ? lines.join('\n') : '_no mappings_'
                };
            }));
            await command.reply({
                embeds: [{ color: SUCCEEDED_COLOR, fields }],
                flags: 'Ephemeral'
            });
        } catch (ex) {
            console.error(ex);
        }
    }

    // ── mappings (top-level) ─────────────────────────────────────────────

    @Slash({ name: 'add', description: 'Add an emoji→role mapping into a group' })
    @SlashGroup('role-emoji')
    async mappingAdd(
        @SlashOption({
            description: 'group name',
            name: 'group',
            required: true,
            type: ApplicationCommandOptionType.String
        }) groupName: string,
        @SlashOption({
            description: 'emoji',
            name: 'emoji',
            required: true,
            type: ApplicationCommandOptionType.String
        }) emoji: string,
        @SlashOption({
            description: 'role',
            name: 'role',
            required: true,
            type: ApplicationCommandOptionType.Role
        }) role: Role,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        const guildId = command.guildId as string;
        try {
            const group = await findRoleEmojiGroupByName(guildId, groupName.trim());
            if (!group) {
                await command.reply({
                    embeds: [{ color: FAILED_COLOR, title: 'Failed', description: `Group \`\`${groupName}\`\` does not exist.` }],
                    flags: 'Ephemeral'
                });
                return;
            }
            const groupId = group.getDataValue('id') as number;
            const emojiMatch = EMOJI_REGEX.exec(emoji);
            if (!emojiMatch) {
                await command.reply({ content: `\`\`${emoji}\`\` is not an emoji.`, flags: 'Ephemeral' });
                return;
            }
            const emojiChar = emojiMatch[1] ?? '';
            const emojiName = emojiMatch[2] ?? '';
            const emojiId = emojiMatch[3] ?? '';
            const recorded = await findRoleEmojiInGroup(groupId, emojiChar, emojiId);
            if (recorded) {
                const mappedRole = command.guild?.roles.cache.find(x => x.id === recorded.getDataValue('roleId'));
                await command.reply({
                    embeds: [{
                        color: FAILED_COLOR,
                        title: 'Failed',
                        description: `${emoji} is already mapped to \`\`${mappedRole?.name ?? recorded.getDataValue('roleId')}\`\` in this group.`
                    }],
                    flags: 'Ephemeral'
                });
                return;
            }
            await addRoleEmoji(groupId, role.id, emojiChar, emojiName, emojiId);
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    title: 'Succeeded',
                    description: `${emoji} = \`\`${role.name}\`\` (group: \`${groupName}\`)`
                }],
                flags: 'Ephemeral'
            });
        } catch (ex) {
            console.error(ex);
        }
    }

    @Slash({ name: 'remove', description: 'Remove an emoji→role mapping from a group' })
    @SlashGroup('role-emoji')
    async mappingRemove(
        @SlashOption({
            description: 'group name',
            name: 'group',
            required: true,
            type: ApplicationCommandOptionType.String
        }) groupName: string,
        @SlashOption({
            description: 'emoji',
            name: 'emoji',
            required: true,
            type: ApplicationCommandOptionType.String
        }) emoji: string,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        const guildId = command.guildId as string;
        try {
            const group = await findRoleEmojiGroupByName(guildId, groupName.trim());
            if (!group) {
                await command.reply({
                    embeds: [{ color: FAILED_COLOR, title: 'Failed', description: `Group \`\`${groupName}\`\` does not exist.` }],
                    flags: 'Ephemeral'
                });
                return;
            }
            const groupId = group.getDataValue('id') as number;
            const emojiMatch = EMOJI_REGEX.exec(emoji);
            if (!emojiMatch) {
                await command.reply({ content: `\`\`${emoji}\`\` is not an emoji.`, flags: 'Ephemeral' });
                return;
            }
            const emojiChar = emojiMatch[1] ?? '';
            const emojiId = emojiMatch[3] ?? '';
            const recorded = await findRoleEmojiInGroup(groupId, emojiChar, emojiId);
            if (!recorded) {
                await command.reply({
                    embeds: [{ color: FAILED_COLOR, title: 'Failed', description: `No mapping found for ${emoji} in \`${groupName}\`.` }],
                    flags: 'Ephemeral'
                });
                return;
            }
            await removeRoleEmoji(groupId, emojiChar, emojiId);
            await command.reply({
                embeds: [{ color: SUCCEEDED_COLOR, title: 'Succeeded', description: `${emoji} removed from \`${groupName}\`.` }],
                flags: 'Ephemeral'
            });
        } catch (ex) {
            console.error(ex);
        }
    }

    // ── watch ────────────────────────────────────────────────────────────

    @Slash({ name: 'watch', description: 'Watch a message and apply a group\'s emoji→role mappings to it' })
    @SlashGroup('role-emoji')
    async watch(
        @SlashOption({
            description: 'Message ID',
            name: 'message-id',
            required: true,
            type: ApplicationCommandOptionType.String
        }) messageId: string,
        @SlashOption({
            description: 'group name to apply',
            name: 'group',
            required: true,
            type: ApplicationCommandOptionType.String
        }) groupName: string,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        // Reacting with N emoji is N REST round-trips and easily blows
        // past Discord's 3-second interaction window — defer up front so
        // the user sees a "thinking…" spinner instead of "interaction
        // failed" while the bot grinds through reactions.
        await command.deferReply({ flags: 'Ephemeral' }).catch(() => { /* already replied */ });
        const guildId = command.guildId as string;
        try {
            const group = await findRoleEmojiGroupByName(guildId, groupName.trim());
            if (!group) {
                await command.editReply({
                    embeds: [{ color: FAILED_COLOR, title: 'Failed', description: `Group \`\`${groupName}\`\` does not exist.` }]
                });
                return;
            }
            const groupId = group.getDataValue('id') as number;

            const message = await command.channel?.messages.fetch({ message: messageId }).catch(() => null);
            if (!message) {
                await command.editReply({
                    embeds: [{
                        color: FAILED_COLOR,
                        title: 'Failed',
                        description: `Message \`\`${messageId}\`\` does not exist or isn't accessible in this channel.`
                    }]
                });
                return;
            }

            const previouslyWatched = await findRoleReceiveMessage(guildId, command.channelId, messageId);
            // Upsert binds (or rebinds) the message to the chosen group
            // — single-group-per-watch is enforced at the schema level.
            await upsertRoleReceiveMessage(guildId, command.channelId, messageId, groupId);

            const mappings = await findAllRoleEmojisInGroup(groupId);
            // Each react can fail independently (custom emoji from another
            // guild that the bot can't access, deleted custom emoji,
            // missing AddReactions perms on the channel, …) — collect
            // failures so the user sees what worked and what didn't,
            // instead of one broken row killing the whole watch.
            const failed: string[] = [];
            for (const re of mappings) {
                const emojiChar = re.getDataValue('emojiChar') as string;
                const emojiId = re.getDataValue('emojiId') as string;
                const emojiName = re.getDataValue('emojiName') as string;
                const resolvable = resolveReactable(command, emojiChar, emojiId, emojiName);
                if (!resolvable) {
                    failed.push(emojiChar || emojiId);
                    continue;
                }
                // discord.js keys reactions by emoji id (custom) or the
                // unicode char itself; skip when the bot already reacted
                // so re-watching an existing message doesn't surface a
                // bogus failure for a reaction that's actually present.
                if (message.reactions.cache.get(emojiId || emojiChar)?.me) continue;
                try {
                    await message.react(resolvable);
                } catch (err) {
                    console.error(`role-emoji watch: react failed for ${String(resolvable)}:`, err);
                    failed.push(emojiChar || emojiId);
                }
            }

            const baseDesc = previouslyWatched
                ? `Message \`\`${messageId}\`\` is now bound to group \`${groupName}\`.`
                : `Message \`\`${messageId}\`\` is being watched with group \`${groupName}\`.`;
            const failedSuffix = failed.length
                ? `\n\nCould not react with: ${failed.map(f => `\`${f}\``).join(', ')}`
                : '';
            await command.editReply({
                embeds: [{
                    color: failed.length ? FAILED_COLOR : SUCCEEDED_COLOR,
                    title: failed.length ? 'Partial' : 'Succeeded',
                    description: baseDesc + failedSuffix
                }]
            });
        } catch (ex) {
            console.error(ex);
            await command.editReply({
                embeds: [{
                    color: FAILED_COLOR,
                    title: 'Failed',
                    description: ex instanceof Error ? ex.message : String(ex)
                }]
            }).catch(() => { /* the reply may have failed mid-flight */ });
        }
    }

    @Slash({ name: 'stop-watch', description: 'Stop watching a message\'s reactions' })
    @SlashGroup('role-emoji')
    async stopWatch(
        @SlashOption({
            description: 'Message ID',
            name: 'message-id',
            required: true,
            type: ApplicationCommandOptionType.String
        }) messageId: string,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        await command.deferReply({ flags: 'Ephemeral' }).catch(() => { /* already replied */ });
        const guildId = command.guildId as string;
        try {
            const recorded = await findRoleReceiveMessage(guildId, command.channelId, messageId);
            if (recorded) {
                await removeRoleReceiveMessage(guildId, command.channelId, messageId);
                await command.editReply({
                    embeds: [{
                        color: SUCCEEDED_COLOR,
                        title: 'Succeeded',
                        description: `Message \`\`${messageId}\`\` is no longer being watched.`
                    }]
                });
            } else {
                await command.editReply({
                    embeds: [{
                        color: SUCCEEDED_COLOR,
                        title: 'No action',
                        description: `Message \`\`${messageId}\`\` is not being watched.`
                    }]
                });
            }
        } catch (ex) {
            console.error(ex);
            await command.editReply({
                embeds: [{
                    color: FAILED_COLOR,
                    title: 'Failed',
                    description: ex instanceof Error ? ex.message : String(ex)
                }]
            }).catch(() => { /* noop */ });
        }
    }
}

/**
 * Build something `message.react()` accepts from a stored role-emoji
 * row. Returns null when the row's emoji can't be turned into anything
 * valid (e.g., a custom emoji whose id we have but whose `name` we
 * never recorded — Discord requires `name:id` for non-cached customs).
 */
function resolveReactable(
    command: CommandInteraction,
    emojiChar: string,
    emojiId: string,
    emojiName: string
): string | null {
    if (emojiChar) return emojiChar;
    if (!emojiId) return null;
    // Prefer the live GuildEmoji object — discord.js can resolve every
    // detail it needs (animated flag, current name) from the cache.
    const cached = command.guild?.emojis.resolve(emojiId);
    if (cached) return cached.toString();
    // Off-guild / deleted custom emoji — fall back to the `name:id`
    // string that Discord's REST endpoint accepts. emojiName is stored
    // with surrounding colons (and an optional leading `a` for animated)
    // — strip them and rebuild the canonical form.
    const nameOnly = (emojiName ?? '').replace(/^a?:/, '').replace(/:$/, '');
    const animated = (emojiName ?? '').startsWith('a:');
    if (!nameOnly) return null;
    return `${animated ? 'a:' : ''}${nameOnly}:${emojiId}`;
}
