import { CommandInteraction, ChannelType, InteractionContextType, type APIEmbedField } from 'discord.js';
import { Discord, Slash } from 'discordx';
import { ALL_DMS_TARGET_ID, findUserTarget } from '../models/behavior-target.model.js';
import { findGroupTargetIdsForUser } from '../models/behavior-target-member.model.js';
import { findBehaviorsByTargets, type BehaviorRow } from '../models/behavior.model.js';
import { describeTrigger } from '../utils/behavior-trigger.js';
import { DEFAULT_COLOR } from '../utils/constant.js';

/**
 * `/manual` — DM-only. Lists behaviors that would fire for the invoking
 * user, in the same priority + sortOrder evaluation order the messageCreate
 * handler walks. Does not leak target structure: when no behaviors apply,
 * the reply is a flat "no available behaviors" with no hint as to whether
 * any targets exist or are simply disabled.
 *
 * `guilds: []` opts out of the Client's `botGuilds` default so this
 * registers as a global command (guild commands aren't reachable in
 * DM channels).
 */
@Discord()
export class ManualCommands {
    @Slash({
        name: 'manual',
        description: '查看你在私訊可用的行為列表',
        guilds: [],
        contexts: [InteractionContextType.BotDM, InteractionContextType.PrivateChannel]
    })
    async manual(command: CommandInteraction): Promise<void> {
        if (command.channel?.type !== ChannelType.DM) {
            await command.reply({ content: '此指令僅限私訊使用。', flags: 'Ephemeral' }).catch(() => {});
            return;
        }
        const userId = command.user.id;
        const collected: BehaviorRow[] = [];

        const userTarget = await findUserTarget(userId);
        if (userTarget) {
            collected.push(...await findBehaviorsByTargets([userTarget.id], { enabledOnly: true }));
        }
        const groupIds = await findGroupTargetIdsForUser(userId);
        if (groupIds.length > 0) {
            collected.push(...await findBehaviorsByTargets(groupIds, { enabledOnly: true }));
        }
        collected.push(...await findBehaviorsByTargets([ALL_DMS_TARGET_ID], { enabledOnly: true }));

        if (collected.length === 0) {
            await command.reply({
                embeds: [{ color: DEFAULT_COLOR, description: '目前沒有可用的行為。' }],
                flags: 'Ephemeral'
            }).catch(() => {});
            return;
        }

        const fields: APIEmbedField[] = collected.slice(0, 25).map((b, idx) => {
            const lines = [
                `觸發：${describeTrigger(b.triggerType, b.triggerValue)}`,
                `類型：${b.forwardType === 'continuous' ? '持續轉發' : '一次性轉發'}`
            ];
            if (b.description) lines.push(b.description);
            return {
                name: `${idx + 1}. ${b.title}`,
                value: lines.join('\n').slice(0, 1024)
            };
        });

        const hasContinuous = collected.some(b => b.forwardType === 'continuous');
        const footer = hasContinuous
            ? { text: '持續轉發進行中可隨時輸入 /break 結束' }
            : undefined;

        await command.reply({
            embeds: [{
                color: DEFAULT_COLOR,
                title: '可用的行為',
                fields,
                footer
            }],
            flags: 'Ephemeral'
        }).catch(() => {});
    }
}
