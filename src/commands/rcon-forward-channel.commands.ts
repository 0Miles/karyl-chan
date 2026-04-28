import { RconForwardChannel } from './../models/rcon-forward-channel.model.js';
import { CommandInteraction, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { Discord, ModalComponent, Slash, SlashGroup } from 'discordx';
import { FAILED_COLOR, SUCCEEDED_COLOR } from '../utils/constant.js';
import { encryptSecret } from '../utils/crypto.js';
import { requireDiscordCapability } from '../permission/permission-check.js';

@Discord()
@SlashGroup({ description: 'Manage rcon forward channel', name: 'rcon-forward-channel', defaultMemberPermissions: '16' })
@SlashGroup('rcon-forward-channel')
export class RconForwardChannelCommands {
    @Slash({ name: 'watch', description: 'Watch this channel as a rcon forward channel' })
    async watchChannel(command: CommandInteraction): Promise<void> {
        if (!(await requireDiscordCapability(command, 'rcon.configure'))) return;
        const existingRecord = await RconForwardChannel.findOne({
            where: {
                channelId: command.channelId,
                guildId: command.guildId
            }
        });
        if (!existingRecord) {
            const modal = new ModalBuilder()
                .setTitle('Rcon forward channel')
                .setCustomId('NewRconForwardChannelForm');

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldHost')
                        .setLabel('Host')
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(1)
                        .setMaxLength(300)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldPassword')
                        .setLabel('Password')
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(1)
                        .setMaxLength(300)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldPort')
                        .setLabel('Port')
                        .setStyle(TextInputStyle.Short)
                        .setValue('25575')
                        .setMinLength(1)
                        .setMaxLength(5)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldTriggerPrefix')
                        .setLabel('Trigger prefix')
                        .setStyle(TextInputStyle.Short)
                        .setValue('/')
                        .setMinLength(1)
                        .setMaxLength(10)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldCommandPrefix')
                        .setLabel('Command prefix')
                        .setStyle(TextInputStyle.Short)
                        .setValue('/')
                        .setMaxLength(10)
                        .setRequired(false)
                )
            );

            command.showModal(modal);
        } else {
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    title: `No action`,
                    description: `Current channel is already in the watch list.`
                }],
                flags: 'Ephemeral'
            });
        }
    }

    @ModalComponent()
    async NewRconForwardChannelForm(interaction: ModalSubmitInteraction): Promise<void> {
        try {
            let [triggerPrefix, commandPrefix, host, portString, password] = ['fieldTriggerPrefix', 'fieldCommandPrefix', 'fieldHost', 'fieldPort', 'fieldPassword'].map((id) =>
                interaction.fields.getTextInputValue(id)
            );

            const existingRecord = await RconForwardChannel.findOne({
                where: {
                    channelId: interaction.channelId,
                    guildId: interaction.guildId
                }
            });

            if (!existingRecord) {
                await RconForwardChannel.create({
                    channelId: interaction.channelId,
                    guildId: interaction.guildId,
                    triggerPrefix,
                    commandPrefix,
                    host,
                    password: encryptSecret(password),
                    port: parseInt(portString)
                });
            } else {
                const updates: Record<string, unknown> = {
                    triggerPrefix,
                    commandPrefix,
                    host,
                    port: parseInt(portString)
                };
                if (password) {
                    updates.password = encryptSecret(password);
                }
                await existingRecord.update(updates);
            }

            await this.replyStatus(
                interaction as any,
                triggerPrefix,
                commandPrefix,
                host,
                portString
            );

            return;
        } catch (ex) {
            console.error(ex);
        }
    }

    async replyStatus(interaction: CommandInteraction, triggerPrefix: string, commandPrefix: string, host: string, port: string) {
        await interaction.reply({
            flags: 'Ephemeral',
            embeds: [{
                color: SUCCEEDED_COLOR,
                fields: [
                    {
                        name: `Trigger prefix`,
                        value: triggerPrefix
                    },
                    {
                        name: `Command prefix`,
                        value: commandPrefix
                    },
                    {
                        name: `Host`,
                        value: host
                    },
                    {
                        name: `Port`,
                        value: port
                    },
                    {
                        name: `Password`,
                        value: '••••••••'
                    }
                ]
            }]
        });
    }

    @Slash({ name: 'stop-watch', description: 'Stop watching this channel as a rcon forward channel' })
    async stopWatchChannel(command: CommandInteraction): Promise<void> {
        if (!(await requireDiscordCapability(command, 'rcon.configure'))) return;
        const existingRecord = await RconForwardChannel.findOne({
            where: {
                channelId: command.channelId,
                guildId: command.guildId
            }
        });
        if (existingRecord) {
            await existingRecord.destroy();
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    title: `Succeeded`,
                    description: `Current channel is no longer being watched.`
                }],
                flags: 'Ephemeral'
            });
        } else {
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    title: `No action`,
                    description: `Current channel is not being watched.`
                }],
                flags: 'Ephemeral'
            });
        }
    }

    @Slash({ name: 'status', description: 'Check this channel status' })
    async status(command: CommandInteraction): Promise<void> {
        if (!(await requireDiscordCapability(command, 'rcon.configure'))) return;
        const existingRecord = await RconForwardChannel.findOne({
            where: {
                channelId: command.channelId,
                guildId: command.guildId
            }
        });
        if (existingRecord) {
            await this.replyStatus(command, existingRecord.getDataValue('triggerPrefix'), existingRecord.getDataValue('commandPrefix'), existingRecord.getDataValue('host'), existingRecord.getDataValue('port').toString());
        } else {
            await command.reply({
                embeds: [{
                    color: FAILED_COLOR,
                    title: `Current channel is not being watched.`
                }],
                flags: 'Ephemeral'
            });
        }
    }

    @Slash({ name: 'edit', description: 'Edit rcon forward parameter' })
    async edit(
        command: CommandInteraction): Promise<void> {
        if (!(await requireDiscordCapability(command, 'rcon.configure'))) return;
        const existingRecord = await RconForwardChannel.findOne({
            where: {
                channelId: command.channelId,
                guildId: command.guildId
            }
        });
        if (existingRecord) {
            const modal = new ModalBuilder()
                .setTitle('Rcon forward channel')
                .setCustomId('NewRconForwardChannelForm');
            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldHost')
                        .setLabel('Host')
                        .setStyle(TextInputStyle.Short)
                        .setValue(existingRecord.getDataValue('host'))
                        .setMinLength(1)
                        .setMaxLength(300)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldPassword')
                        .setLabel('Password')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('留空以保持原密碼')
                        .setRequired(false)
                        .setMaxLength(300)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldPort')
                        .setLabel('Port')
                        .setStyle(TextInputStyle.Short)
                        .setValue(existingRecord.getDataValue('port').toString())
                        .setMinLength(1)
                        .setMaxLength(5)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldTriggerPrefix')
                        .setLabel('Trigger prefix')
                        .setStyle(TextInputStyle.Short)
                        .setValue(existingRecord.getDataValue('triggerPrefix'))
                        .setMinLength(1)
                        .setMaxLength(10)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('fieldCommandPrefix')
                        .setLabel('Command prefix')
                        .setStyle(TextInputStyle.Short)
                        .setValue(existingRecord.getDataValue('commandPrefix'))
                        .setMaxLength(10)
                        .setRequired(false)
                )
            );

            command.showModal(modal);
        } else {
            await command.reply({
                embeds: [{
                    color: FAILED_COLOR,
                    title: `Current channel is not being watched.`
                }],
                flags: 'Ephemeral'
            });
        }
    }
}