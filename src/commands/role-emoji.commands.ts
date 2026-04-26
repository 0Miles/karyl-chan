import { FAILED_COLOR, SUCCEEDED_COLOR } from './../utils/constant.js';
import { CommandInteraction, ApplicationCommandOptionType, Role } from 'discord.js';
import { Discord, Slash, SlashGroup, SlashOption } from 'discordx';
import {
    addRoleEmoji,
    removeRoleEmoji,
    findRoleEmojiInGroup,
    findAllRoleEmojisInGroup,
    findAllRoleEmojisInGroups
} from '../models/role-emoji.model.js';
import { findRoleReceiveMessage, addRoleReceiveMessage, removeRoleReceiveMessage } from '../models/role-receive-message.model.js';
import {
    addRoleEmojiGroup,
    findAllRoleEmojiGroups,
    findRoleEmojiGroupByName,
    removeRoleEmojiGroup
} from '../models/role-emoji-group.model.js';
import {
    findMessageGroupIds,
    setMessageGroups,
    removeAllMessageGroups
} from '../models/role-receive-message-group.model.js';
import { requireCapability } from '../permission/permission-check.js';

const EMOJI_REGEX = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])|^<(a?:[^:>]+:)([^>]+)>$/;

/**
 * Resolve a comma-separated list of group names to their ids. Returns
 * `null` (and replies to the interaction) when any of the names can't
 * be matched, so the caller can bail without further side effects.
 *
 * An empty input string resolves to an empty array — callers that
 * treat "no groups" as "all groups" can rely on that without us
 * pre-expanding the wildcard here.
 */
async function resolveGroupNames(
    command: CommandInteraction,
    guildId: string,
    raw: string | undefined
): Promise<number[] | null> {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return [];
    const names = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    const ids: number[] = [];
    for (const name of names) {
        const group = await findRoleEmojiGroupByName(guildId, name);
        if (!group) {
            await command.editReply({
                embeds: [{
                    color: FAILED_COLOR,
                    title: 'Failed',
                    description: `Group \`\`${name}\`\` does not exist.`
                }]
            });
            return null;
        }
        ids.push(group.getDataValue('id') as number);
    }
    return ids;
}

@Discord()
@SlashGroup({ description: 'Manage role emoji', name: 'role-emoji', defaultMemberPermissions: '268435456' })
@SlashGroup({ description: 'Manage emoji groups', name: 'group', root: 'role-emoji' })
@SlashGroup({ description: 'Manage emoji-role mappings', name: 'mapping', root: 'role-emoji' })
@SlashGroup({ description: 'Manage watched messages', name: 'watch', root: 'role-emoji' })
export class RoleEmojiCommands {
    // ── group ────────────────────────────────────────────────────────────

    @Slash({ name: 'create', description: 'Create a new emoji group' })
    @SlashGroup('group', 'role-emoji')
    async groupCreate(
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

    @Slash({ name: 'delete', description: 'Delete an emoji group (and its mappings)' })
    @SlashGroup('group', 'role-emoji')
    async groupDelete(
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

    @Slash({ name: 'list', description: 'List all emoji groups' })
    @SlashGroup('group', 'role-emoji')
    async groupList(command: CommandInteraction): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        const guildId = command.guildId as string;
        try {
            const groups = await findAllRoleEmojiGroups(guildId);
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    description: groups.length ? undefined : 'No groups defined.',
                    fields: groups.map(g => ({
                        name: g.getDataValue('name') as string,
                        value: `id: \`${g.getDataValue('id')}\``
                    }))
                }],
                flags: 'Ephemeral'
            });
        } catch (ex) {
            console.error(ex);
        }
    }

    // ── mapping ──────────────────────────────────────────────────────────

    @Slash({ name: 'add', description: 'Add an emoji→role mapping inside a group' })
    @SlashGroup('mapping', 'role-emoji')
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
    @SlashGroup('mapping', 'role-emoji')
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

    @Slash({ name: 'list', description: 'List emoji→role mappings in a group' })
    @SlashGroup('mapping', 'role-emoji')
    async mappingList(
        @SlashOption({
            description: 'group name',
            name: 'group',
            required: true,
            type: ApplicationCommandOptionType.String
        }) groupName: string,
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
            const mappings = await findAllRoleEmojisInGroup(groupId);
            const fields = mappings.map(x => {
                const emojiChar = x.getDataValue('emojiChar') as string;
                const emojiId = x.getDataValue('emojiId') as string;
                const emojiName = x.getDataValue('emojiName') as string;
                const mappedRole = command.guild?.roles.cache.find(r => r.id === x.getDataValue('roleId'));
                return {
                    name: emojiChar ? emojiChar : `<${emojiName}${emojiId}>`,
                    value: mappedRole?.name ?? ''
                };
            });
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    description: fields.length ? undefined : 'No mappings in this group.',
                    fields
                }],
                flags: 'Ephemeral'
            });
        } catch (ex) {
            console.error(ex);
        }
    }

    // ── watch ────────────────────────────────────────────────────────────

    @Slash({ name: 'start', description: 'Start watching a message for reactions' })
    @SlashGroup('watch', 'role-emoji')
    async watchStart(
        @SlashOption({
            description: 'Message ID',
            name: 'message-id',
            required: true,
            type: ApplicationCommandOptionType.String
        }) messageId: string,
        @SlashOption({
            description: 'comma-separated group names (omit for all groups)',
            name: 'groups',
            required: false,
            type: ApplicationCommandOptionType.String
        }) groups: string | undefined,
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

            const explicitGroupIds = await resolveGroupNames(command, guildId, groups);
            if (explicitGroupIds === null) return;

            // Resolve which groups' emoji to react with. Empty input
            // → react with every group's emoji in this guild, mirroring
            // the runtime "no pin = all groups" rule.
            let reactionGroupIds = explicitGroupIds;
            if (reactionGroupIds.length === 0) {
                const allGroups = await findAllRoleEmojiGroups(guildId);
                reactionGroupIds = allGroups.map(g => g.getDataValue('id') as number);
            }

            const recordedRoleReceiveMessage = await findRoleReceiveMessage(guildId, command.channelId, messageId);
            const mappings = await findAllRoleEmojisInGroups(reactionGroupIds);

            // Each react can fail independently (custom emoji from another
            // guild that the bot can't access, deleted custom emoji,
            // missing AddReactions perms on the channel, …) — we collect
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
                try {
                    await message.react(resolvable);
                } catch (err) {
                    console.error(`role-emoji watch start: react failed for ${String(resolvable)}:`, err);
                    failed.push(emojiChar || emojiId);
                }
            }

            if (!recordedRoleReceiveMessage) {
                await addRoleReceiveMessage(guildId, command.channelId, messageId);
            }
            // Pin the explicit group set when one was provided; an empty
            // input keeps the message in "use all groups" mode by
            // clearing any previous pins.
            await setMessageGroups(guildId, command.channelId, messageId, explicitGroupIds);

            const baseDesc = recordedRoleReceiveMessage
                ? `Message \`\`${messageId}\`\` watch settings updated.`
                : `Message \`\`${messageId}\`\` is being watched.`;
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

    @Slash({ name: 'stop', description: 'Stop watching a message\'s reactions' })
    @SlashGroup('watch', 'role-emoji')
    async watchStop(
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
                await removeAllMessageGroups(guildId, command.channelId, messageId);
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

    @Slash({ name: 'set-groups', description: 'Set which emoji groups apply to a watched message' })
    @SlashGroup('watch', 'role-emoji')
    async watchSetGroups(
        @SlashOption({
            description: 'Message ID',
            name: 'message-id',
            required: true,
            type: ApplicationCommandOptionType.String
        }) messageId: string,
        @SlashOption({
            description: 'comma-separated group names (omit to clear pins → use all groups)',
            name: 'groups',
            required: false,
            type: ApplicationCommandOptionType.String
        }) groups: string | undefined,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        await command.deferReply({ flags: 'Ephemeral' }).catch(() => { /* already replied */ });
        const guildId = command.guildId as string;
        try {
            const recorded = await findRoleReceiveMessage(guildId, command.channelId, messageId);
            if (!recorded) {
                await command.editReply({
                    embeds: [{
                        color: FAILED_COLOR,
                        title: 'Failed',
                        description: `Message \`\`${messageId}\`\` is not being watched.`
                    }]
                });
                return;
            }
            const groupIds = await resolveGroupNames(command, guildId, groups);
            if (groupIds === null) return;
            await setMessageGroups(guildId, command.channelId, messageId, groupIds);
            const desc = groupIds.length === 0
                ? `Cleared group pins for \`\`${messageId}\`\` — every group in this guild now applies.`
                : `Pinned ${groupIds.length} group(s) to \`\`${messageId}\`\`.`;
            await command.editReply({
                embeds: [{ color: SUCCEEDED_COLOR, title: 'Succeeded', description: desc }]
            });
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

    @Slash({ name: 'show', description: 'Show watch settings (pinned groups) for a message' })
    @SlashGroup('watch', 'role-emoji')
    async watchShow(
        @SlashOption({
            description: 'Message ID',
            name: 'message-id',
            required: true,
            type: ApplicationCommandOptionType.String
        }) messageId: string,
        command: CommandInteraction
    ): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        const guildId = command.guildId as string;
        try {
            const recorded = await findRoleReceiveMessage(guildId, command.channelId, messageId);
            if (!recorded) {
                await command.reply({
                    embeds: [{
                        color: FAILED_COLOR,
                        title: 'Not watched',
                        description: `Message \`\`${messageId}\`\` is not being watched in this channel.`
                    }],
                    flags: 'Ephemeral'
                });
                return;
            }
            const ids = await findMessageGroupIds(guildId, command.channelId, messageId);
            const allGroups = await findAllRoleEmojiGroups(guildId);
            const named = ids.length === 0
                ? '(none — using all groups)'
                : allGroups
                    .filter(g => ids.includes(g.getDataValue('id') as number))
                    .map(g => `\`${g.getDataValue('name')}\``)
                    .join(', ');
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    title: `Watching \`\`${messageId}\`\``,
                    description: `Pinned groups: ${named}`
                }],
                flags: 'Ephemeral'
            });
        } catch (ex) {
            console.error(ex);
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
