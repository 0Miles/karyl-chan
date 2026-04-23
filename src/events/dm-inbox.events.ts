import type { ArgsOf } from 'discordx';
import { Discord, On } from 'discordx';
import { ChannelType, type DMChannel, type Message, type PartialMessage } from 'discord.js';
import { dmInboxService, type DmRecipient } from '../web/dm-inbox.service.js';
import { toApiMessage } from '../web/message-mapper.js';

function recipientFor(channel: DMChannel): DmRecipient | null {
    const user = channel.recipient;
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        globalName: user.globalName ?? null,
        avatarUrl: user.displayAvatarURL({ size: 128 })
    };
}

@Discord()
export class DmInboxEvents {
    @On()
    async messageCreate([message]: ArgsOf<'messageCreate'>): Promise<void> {
        try {
            if (message.channel.type !== ChannelType.DM) return;
            const channel = message.channel as DMChannel;
            const recipient = recipientFor(channel);
            if (!recipient) return;
            dmInboxService.recordMessage(channel.id, recipient, toApiMessage(message));
        } catch (err) {
            console.error('dm-inbox messageCreate failed:', err);
        }
    }

    @On()
    async messageUpdate([_oldMessage, newMessage]: ArgsOf<'messageUpdate'>): Promise<void> {
        try {
            if (newMessage.channel.type !== ChannelType.DM) return;
            const fetched = newMessage.partial ? await (newMessage as PartialMessage).fetch().catch(() => null) : (newMessage as Message);
            if (!fetched) return;
            dmInboxService.updateMessage(fetched.channelId, toApiMessage(fetched));
        } catch (err) {
            console.error('dm-inbox messageUpdate failed:', err);
        }
    }

    @On()
    async messageDelete([message]: ArgsOf<'messageDelete'>): Promise<void> {
        try {
            if (message.channel.type !== ChannelType.DM) return;
            dmInboxService.removeMessage(message.channelId, message.id);
        } catch (err) {
            console.error('dm-inbox messageDelete failed:', err);
        }
    }
}
