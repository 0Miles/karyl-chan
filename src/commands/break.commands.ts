import { CommandInteraction, ChannelType, InteractionContextType } from 'discord.js';
import { Discord, Slash } from 'discordx';
import { endSession, findActiveSession } from '../models/behavior-session.model.js';
import { DEFAULT_COLOR, SUCCEEDED_COLOR } from '../utils/constant.js';

/**
 * `/break` — DM-only. Ends the invoking user's active continuous-forward
 * session (if any). Counterpart to the webhook-side [BEHAVIOR:END]
 * sentinel: gives the user an unconditional client-side off switch even
 * when the downstream webhook server is unreachable or stops replying.
 *
 * Globally registered (`guilds: []`) so the command appears in DM
 * surfaces; guild commands are not reachable from DM channels.
 */
@Discord()
export class BreakCommands {
    @Slash({
        name: 'break',
        description: '結束目前正在進行的持續轉發',
        guilds: [],
        contexts: [InteractionContextType.BotDM, InteractionContextType.PrivateChannel]
    })
    async break(command: CommandInteraction): Promise<void> {
        if (command.channel?.type !== ChannelType.DM) {
            await command.reply({ content: '此指令僅限私訊使用。', flags: 'Ephemeral' }).catch(() => {});
            return;
        }
        const userId = command.user.id;
        const session = await findActiveSession(userId);
        if (!session) {
            await command.reply({
                embeds: [{ color: DEFAULT_COLOR, description: '目前沒有持續轉發可結束。' }],
                flags: 'Ephemeral'
            }).catch(() => {});
            return;
        }
        await endSession(userId);
        await command.reply({
            embeds: [{ color: SUCCEEDED_COLOR, description: '✓ 持續轉發已結束。' }],
            flags: 'Ephemeral'
        }).catch(() => {});
    }
}
