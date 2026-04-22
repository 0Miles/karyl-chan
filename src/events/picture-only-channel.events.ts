import type { ArgsOf, Client } from 'discordx';
import { Discord, On } from 'discordx';
import { PictureOnlyChannel } from '../models/picture-only-channel.model.js';

@Discord()
export class PictureOnlyChannelEvents {
    @On()
    async messageCreate([message]: ArgsOf<'messageCreate'>, client: Client): Promise<void> {
        try {
            const existingRecord = await PictureOnlyChannel.findOne({
                where: {
                    channelId: message.channelId,
                    guildId: message.guildId
                }
            });

            if (existingRecord && message.attachments.size === 0) {
                await message.delete();
            }
        } catch (ex) {
            console.error(ex);
        }
    }
}