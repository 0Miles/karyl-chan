import type { ArgsOf } from 'discordx';
import { Discord, On } from 'discordx';
import { ChannelType, type DMChannel, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction } from 'discord.js';
import { dmInboxService, type DmRecipient } from '../web/dm-inbox.service.js';
import { dmEventBus } from '../web/dm-event-bus.js';
import { avatarUrlFor, toApiMessage } from '../web/message-mapper.js';

async function publishReactionUpdate(reaction: MessageReaction | PartialMessageReaction): Promise<void> {
    const resolved = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
    if (!resolved) return;
    if (resolved.message.channel.type !== ChannelType.DM) return;
    const message = resolved.message.partial
        ? await (resolved.message as PartialMessage).fetch().catch(() => null)
        : (resolved.message as Message);
    if (!message) return;
    dmEventBus.publish({
        type: 'message-updated',
        channelId: message.channelId,
        message: toApiMessage(message)
    });
}

function recipientFor(channel: DMChannel): DmRecipient | null {
    const user = channel.recipient;
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        globalName: user.globalName ?? null,
        avatarUrl: avatarUrlFor(user.id, user.avatar)
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
            const apiMessage = toApiMessage(message);
            const summary = await dmInboxService.recordActivity(channel.id, recipient, apiMessage);
            dmEventBus.publish({ type: 'channel-touched', channel: summary });
            dmEventBus.publish({ type: 'message-created', channelId: channel.id, message: apiMessage });
        } catch (err) {
            console.error('dm-inbox messageCreate failed:', err);
        }
    }

    @On()
    async messageUpdate([_oldMessage, newMessage]: ArgsOf<'messageUpdate'>): Promise<void> {
        try {
            if (newMessage.channel.type !== ChannelType.DM) return;
            const fetched = newMessage.partial
                ? await (newMessage as PartialMessage).fetch().catch(() => null)
                : (newMessage as Message);
            if (!fetched) return;
            dmEventBus.publish({
                type: 'message-updated',
                channelId: fetched.channelId,
                message: toApiMessage(fetched)
            });
        } catch (err) {
            console.error('dm-inbox messageUpdate failed:', err);
        }
    }

    @On()
    async messageDelete([message]: ArgsOf<'messageDelete'>): Promise<void> {
        try {
            if (message.channel.type !== ChannelType.DM) return;
            dmEventBus.publish({
                type: 'message-deleted',
                channelId: message.channelId,
                messageId: message.id
            });
        } catch (err) {
            console.error('dm-inbox messageDelete failed:', err);
        }
    }

    @On()
    async messageReactionAdd([reaction]: ArgsOf<'messageReactionAdd'>): Promise<void> {
        try {
            await publishReactionUpdate(reaction);
        } catch (err) {
            console.error('dm-inbox messageReactionAdd failed:', err);
        }
    }

    @On()
    async messageReactionRemove([reaction]: ArgsOf<'messageReactionRemove'>): Promise<void> {
        try {
            await publishReactionUpdate(reaction);
        } catch (err) {
            console.error('dm-inbox messageReactionRemove failed:', err);
        }
    }
}
