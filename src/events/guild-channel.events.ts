import type { ArgsOf, Client } from 'discordx';
import { Discord, On } from 'discordx';
import { ChannelType, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction, type PartialUser, type TextChannel, type User } from 'discord.js';
import { guildChannelEventBus } from '../web/guild-channel-event-bus.js';
import { toApiMessage } from '../web/message-mapper.js';

async function publishReactionUpdate(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, client: Client): Promise<void> {
    const channel = reaction.message.channel;
    if (channel.type !== ChannelType.GuildText) return;
    if (client.user && user.id === client.user.id) return;
    const guildId = (channel as TextChannel).guildId;
    const channelId = reaction.message.channelId;
    const messageId = reaction.message.id;
    const message = await (channel as TextChannel).messages.fetch({ message: messageId, force: true }).catch(() => null);
    if (!message) return;
    guildChannelEventBus.publish({ type: 'guild-message-updated', guildId, channelId, message: toApiMessage(message) });
}

@Discord()
export class GuildChannelEvents {
    @On()
    async messageCreate([message]: ArgsOf<'messageCreate'>): Promise<void> {
        try {
            if (message.channel.type !== ChannelType.GuildText) return;
            const guildId = message.guildId;
            if (!guildId) return;
            guildChannelEventBus.publish({
                type: 'guild-message-created',
                guildId,
                channelId: message.channelId,
                message: toApiMessage(message)
            });
        } catch (err) {
            console.error('guild-channel messageCreate failed:', err);
        }
    }

    @On()
    async messageUpdate([_old, newMessage]: ArgsOf<'messageUpdate'>): Promise<void> {
        try {
            if (newMessage.channel.type !== ChannelType.GuildText) return;
            const guildId = newMessage.guildId;
            if (!guildId) return;
            const fetched = newMessage.partial
                ? await (newMessage as unknown as PartialMessage).fetch().catch(() => null)
                : (newMessage as Message);
            if (!fetched) return;
            guildChannelEventBus.publish({
                type: 'guild-message-updated',
                guildId,
                channelId: fetched.channelId,
                message: toApiMessage(fetched)
            });
        } catch (err) {
            console.error('guild-channel messageUpdate failed:', err);
        }
    }

    @On()
    async messageDelete([message]: ArgsOf<'messageDelete'>): Promise<void> {
        try {
            if (message.channel.type !== ChannelType.GuildText) return;
            const guildId = message.guildId;
            if (!guildId) return;
            guildChannelEventBus.publish({
                type: 'guild-message-deleted',
                guildId,
                channelId: message.channelId,
                messageId: message.id
            });
        } catch (err) {
            console.error('guild-channel messageDelete failed:', err);
        }
    }

    @On()
    async messageReactionAdd([reaction, user]: ArgsOf<'messageReactionAdd'>, client: Client): Promise<void> {
        try {
            await publishReactionUpdate(reaction, user, client);
        } catch (err) {
            console.error('guild-channel messageReactionAdd failed:', err);
        }
    }

    @On()
    async messageReactionRemove([reaction, user]: ArgsOf<'messageReactionRemove'>, client: Client): Promise<void> {
        try {
            await publishReactionUpdate(reaction, user, client);
        } catch (err) {
            console.error('guild-channel messageReactionRemove failed:', err);
        }
    }
}
