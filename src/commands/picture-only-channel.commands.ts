import { PictureOnlyChannel } from '../models/picture-only-channel.model.js';
import { CommandInteraction, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { Discord, ModalComponent, Slash, SlashGroup } from 'discordx';
import { FAILED_COLOR, SUCCEEDED_COLOR } from '../utils/constant.js';

@Discord()
@SlashGroup({ description: 'Manage picture only channel', name: 'picture-only-channel', defaultMemberPermissions: '16' })
@SlashGroup('picture-only-channel')
export class PictureOnlyChannelCommands {
    @Slash({ name: 'watch', description: 'Watch this channel as a rcon forward channel' })
    async watchChannel(command: CommandInteraction): Promise<void> {
        const existingRecord = await PictureOnlyChannel.findOne({
            where: {
                channelId: command.channelId,
                guildId: command.guildId
            }
        });
        if (!existingRecord) {
            await PictureOnlyChannel.create({
                channelId: command.channelId,
                guildId: command.guildId
            });
            await command.reply({
                embeds: [{
                    color: SUCCEEDED_COLOR,
                    title: `Succeeded`,
                    description: `The current channel is being watched.`
                }],
                flags: 'Ephemeral'
            });
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

    @Slash({ name: 'stop-watch', description: 'Stop watching this channel as a rcon forward channel' })
    async stopWatchChannel(command: CommandInteraction): Promise<void> {
        const existingRecord = await PictureOnlyChannel.findOne({
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
}