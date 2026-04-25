import { FAILED_COLOR, SUCCEEDED_COLOR } from './../utils/constant.js';
import { CommandInteraction, ApplicationCommandOptionType, Role } from 'discord.js';
import { Discord, Slash, SlashGroup, SlashOption } from 'discordx';
import { addRoleEmoji, removeRoleEmoji, findRoleEmoji, findGuildAllRoleEmojis } from '../models/role-emoji.model.js';
import { findRoleReceiveMessage, addRoleReceiveMessage, removeRoleReceiveMessage } from '../models/role-receive-message.model.js';
import { requireCapability } from '../permission/permission-check.js';

@Discord()
@SlashGroup({ description: 'Manage role emoji', name: 'role-emoji', defaultMemberPermissions: '268435456' })
@SlashGroup('role-emoji')
export class RoleEmojiCommands {
    @Slash({ name: 'add', description: 'Add a new role emoji' })
    async add(
        @SlashOption({
            description: "emoji",
            name: "emoji",
            required: true,
            type: ApplicationCommandOptionType.String,
        }) emoji: string,
        @SlashOption({
            description: "role",
            name: "role",
            required: true,
            type: ApplicationCommandOptionType.Role,
        }) role: Role,
        command: CommandInteraction): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        try {
            const emojiMatch = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])|^<(a?:[^:>]+:)([^>]+)>$/.exec(emoji);
            if (!emojiMatch) {
                await command.reply({ content: `\`\`${emoji}\`\` is not an emoji.`, flags: 'Ephemeral' });
            } else {
                const recordedRoleEmoji = await findRoleEmoji(command.guildId as string, emojiMatch[1] ?? '', emojiMatch[3] ?? '');
                if (!recordedRoleEmoji) {
                    await addRoleEmoji(command.guildId as string, role.id, emojiMatch[1] ?? '', emojiMatch[2] ?? '', emojiMatch[3] ?? '')
                    await command.reply({
                        embeds: [{
                            color: SUCCEEDED_COLOR,
                            title: `Succeeded`,
                            description: `${emoji} = \`\`${role.name}\`\``
                        }],
                        flags: 'Ephemeral'
                    });
                } else {
                    const mappedRole = command.guild?.roles.cache.find(x => x.id === recordedRoleEmoji.getDataValue('roleId'));
                    await command.reply({
                        embeds: [{
                            color: FAILED_COLOR,
                            title: `Failed`,
                            description: `${emoji} has been mapped by \`\`${mappedRole?.name}\`\`.`
                        }],
                        flags: 'Ephemeral'
                    });
                }
            }
        } catch (ex) {
            console.error(ex);
        }
    }

    @Slash({ name: 'remove', description: 'Remove a role emoji' })
    async remove(
        @SlashOption({
            description: "emoji",
            name: "emoji",
            required: true,
            type: ApplicationCommandOptionType.String,
        }) emoji: string,
        command: CommandInteraction): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        try {
            const emojiMatch = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])|^<(a?:[^:>]+:)([^>]+)>$/.exec(emoji);
            if (!emojiMatch) {
                await command.reply({ content: `\`\`${emoji}\`\` is not an emoji.`, flags: 'Ephemeral' });
            } else {
                const recordedRoleEmoji = await findRoleEmoji(command.guildId as string, emojiMatch[1] ?? '', emojiMatch[3] ?? '');
                if (recordedRoleEmoji) {
                    await removeRoleEmoji(command.guildId as string, emojiMatch[1] ?? '', emojiMatch[3] ?? '')
                    await command.reply({
                        embeds: [{
                            color: SUCCEEDED_COLOR,
                            title: `Succeeded`,
                            description: `${emoji} has been removed.`
                        }],
                        flags: 'Ephemeral'
                    });
                } else {
                    await command.reply({
                        embeds: [{
                            color: FAILED_COLOR,
                            title: `Failed`,
                            description: `No records found for ${emoji}.`
                        }],
                        flags: 'Ephemeral'
                    });
                }
            }
        } catch (ex) {
            console.error(ex);
        }
    }

    @Slash({ name: 'list', description: 'List all role emoji' })
    async list(command: CommandInteraction): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        try {
            const allRoleEmojis = await findGuildAllRoleEmojis(command.guildId as string);
            const result = allRoleEmojis
                .map(x => {
                    const emojiChar = x.getDataValue('emojiChar');
                    const emojiId = x.getDataValue('emojiId');
                    const emojiName = x.getDataValue('emojiName');
                    const mappedRole = command.guild?.roles.cache.find(eachRole => eachRole.id === x.getDataValue('roleId'));
                    if (emojiChar) {
                        return {
                            name: `${emojiChar}`,
                            value: mappedRole?.name ?? ''
                        }
                    } else {
                        return {
                            name: `<${emojiName}${emojiId}>`,
                            value: mappedRole?.name ?? ''
                        }
                    }
                });
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    description: result.length ? undefined : 'No role emoji.',
                    fields: result
                }],
                flags: 'Ephemeral'
            });
        } catch (ex) {
            console.error(ex);
        }
    }

    @Slash({ name: 'watch-message', description: 'Watch a message\'s reactions' })
    async watchMessage(
        @SlashOption({
            description: "Message ID",
            name: "message-id",
            required: true,
            type: ApplicationCommandOptionType.String,
        }) messageId: string,
        command: CommandInteraction): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        // Reacting with N emoji is N REST round-trips and easily blows
        // past Discord's 3-second interaction window — defer up front so
        // the user sees a "thinking…" spinner instead of "interaction
        // failed" while the bot grinds through reactions.
        await command.deferReply({ flags: 'Ephemeral' }).catch(() => { /* already replied */ });
        try {
            const message = await command.channel?.messages.fetch({ message: messageId }).catch(() => null);
            if (!message) {
                await command.editReply({
                    embeds: [{
                        color: FAILED_COLOR,
                        title: `Failed`,
                        description: `Message \`\`${messageId}\`\` does not exist or isn't accessible in this channel.`
                    }]
                });
                return;
            }
            const recordedRoleReceiveMessage = await findRoleReceiveMessage(command.guildId as string, command.channelId, messageId);
            const allRoleEmojis = await findGuildAllRoleEmojis(command.guildId as string);
            // Each react can fail independently (custom emoji from another
            // guild that the bot can't access, deleted custom emoji,
            // missing AddReactions perms on the channel, …) — we collect
            // failures so the user sees what worked and what didn't,
            // instead of one broken row killing the whole watch.
            const failed: string[] = [];
            for (const re of allRoleEmojis) {
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
                    console.error(`role-emoji watch-message: react failed for ${String(resolvable)}:`, err);
                    failed.push(emojiChar || emojiId);
                }
            }
            if (!recordedRoleReceiveMessage) {
                await addRoleReceiveMessage(command.guildId as string, command.channelId, messageId);
            }
            const baseDesc = recordedRoleReceiveMessage
                ? `Message \`\`${messageId}\`\` is already in the watch list.`
                : `Message \`\`${messageId}\`\` is being watched.`;
            const failedSuffix = failed.length
                ? `\n\nCould not react with: ${failed.map(f => `\`${f}\``).join(', ')}`
                : '';
            await command.editReply({
                embeds: [{
                    color: failed.length ? FAILED_COLOR : SUCCEEDED_COLOR,
                    title: recordedRoleReceiveMessage ? 'No action' : 'Succeeded',
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

    @Slash({ name: 'stop-watch-message', description: 'Stop watching a message\'s reactions' })
    async stopWatchMessage(
        @SlashOption({
            description: "Message ID",
            name: "message-id",
            required: true,
            type: ApplicationCommandOptionType.String,
        }) messageId: string,
        command: CommandInteraction): Promise<void> {
        if (!(await requireCapability(command, 'role-emoji.manage'))) return;
        await command.deferReply({ flags: 'Ephemeral' }).catch(() => { /* already replied */ });
        try {
            const recordedRoleReceiveMessage = await findRoleReceiveMessage(command.guildId as string, command.channelId, messageId);
            if (recordedRoleReceiveMessage) {
                await removeRoleReceiveMessage(command.guildId as string, command.channelId, messageId);
                await command.editReply({
                    embeds: [{
                        color: SUCCEEDED_COLOR,
                        title: `Succeeded`,
                        description: `Message \`\`${messageId}\`\` is no longer being watched.`
                    }]
                });
            } else {
                await command.editReply({
                    embeds: [{
                        color: SUCCEEDED_COLOR,
                        title: `No action`,
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