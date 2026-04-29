import type { FastifyInstance } from "fastify";
import type { Client } from "discord.js";
import type { DmInboxStore } from "../../web/dm-inbox.service.js";
import { sequelize } from "../../models/db.js";
import { requireCapability } from "./route-guards.js";

interface SystemRoutesOptions {
  bot?: Client;
  dmInbox?: DmInboxStore;
}

export async function registerSystemRoutes(
  server: FastifyInstance,
  options: SystemRoutesOptions = {},
): Promise<void> {
  const { bot, dmInbox } = options;

  server.get("/api/system/stats", async (request, reply) => {
    if (!requireCapability(request, reply, "system.read")) return;
    const mem = process.memoryUsage();

    let dbConnected = false;
    try {
      await sequelize.authenticate();
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    const guildCount = bot?.guilds.cache.size ?? 0;

    let dmChannelCount = 0;
    let dmActivity: { date: string; count: number }[] = [];
    if (dmInbox) {
      const channels = await dmInbox.listChannels();
      dmChannelCount = channels.length;

      // 過去 7 天的 DM 活動（依 lastMessageAt 分組）
      const counts = new Map<string, number>();
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        counts.set(d.toISOString().slice(0, 10), 0);
      }
      for (const ch of channels) {
        if (!ch.lastMessageAt) continue;
        const date = ch.lastMessageAt.slice(0, 10);
        if (counts.has(date)) {
          counts.set(date, (counts.get(date) ?? 0) + 1);
        }
      }
      dmActivity = Array.from(counts.entries()).map(([date, count]) => ({
        date,
        count,
      }));
    }

    return {
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
      dbConnected,
      guildCount,
      dmChannelCount,
      dmActivity,
    };
  });
}
