import type { ArgsOf, Client } from 'discordx';
import { Discord, On } from 'discordx';
import { ChannelType, type DMChannel, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';
import { dmInboxService, type DmRecipient } from '../web/dm-inbox.service.js';
import { dmEventBus } from '../web/dm-event-bus.js';
import { avatarUrlFor, toApiMessage } from '../web/message-mapper.js';

async function publishReactionUpdate(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, client: Client): Promise<void> {
    const channel = reaction.message.channel;
    if (channel.type !== ChannelType.DM) return;
    // Skip our own reactions: the admin web that drove this change already
    // applied an optimistic update. Discord's REST view briefly lags behind
    // the gateway, so a refetch here would push back the pre-change state
    // and overwrite the operator's UI before reconciling.
    if (client.user && user.id === client.user.id) return;
    const channelId = reaction.message.channelId;
    const messageId = reaction.message.id;
    const message = await (channel as DMChannel).messages.fetch({ message: messageId, force: true }).catch(() => null);
    if (!message) return;
    dmEventBus.publish({
        type: 'message-updated',
        channelId,
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
    async messageReactionAdd([reaction, user]: ArgsOf<'messageReactionAdd'>, client: Client): Promise<void> {
        try {
            await publishReactionUpdate(reaction, user, client);
        } catch (err) {
            console.error('dm-inbox messageReactionAdd failed:', err);
        }
    }

    @On()
    async messageReactionRemove([reaction, user]: ArgsOf<'messageReactionRemove'>, client: Client): Promise<void> {
        try {
            await publishReactionUpdate(reaction, user, client);
        } catch (err) {
            console.error('dm-inbox messageReactionRemove failed:', err);
        }
    }
}
