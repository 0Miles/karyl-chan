import type { ArgsOf, Client } from 'discordx';
import { Discord, On } from 'discordx';
import { PictureOnlyChannel } from '../models/picture-only-channel.model.js';

@Discord()
export class PictureOnlyChannelEvents {
    @On()
    async messageCreate([message]: ArgsOf<'messageCreate'>, client: Client): Promise<void> {
        try {
            const existingRecord = await await PictureOnlyChannel.findOne({
                where: {
                    channelId: message.channelId,
                    guildId: message.guildId
                }
            });

            if (existingRecord) {
                if (!message.attachments.find(x => true)) {
                    await message.delete();
                }
            }
        } catch (ex) {
            console.error(ex);
        }
    }
}