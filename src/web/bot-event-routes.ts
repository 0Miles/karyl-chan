import type { FastifyInstance } from 'fastify';
import { Op } from 'sequelize';
import { BotEvent } from '../models/bot-event.model.js';
import { requireCapability } from './route-guards.js';

/**
 * Admin endpoint for querying the persistent bot event log.
 *
 * GET /api/admin/bot-events
 *   ?limit=50     — number of events to return (default 50, max 200)
 *   ?before=<id>  — cursor: return events with id < before (omit for first page)
 *   ?level=       — filter by level ('info' | 'warn' | 'error')
 *   ?category=    — filter by category ('bot' | 'auth' | 'feature' | 'web' | 'error')
 *
 * Returns { events: BotEvent[], hasMore: boolean }
 * Events are ordered by id DESC (newest first).
 *
 * Requires the `admin` capability.
 */
export async function registerBotEventRoutes(server: FastifyInstance): Promise<void> {
    server.get<{
        Querystring: {
            limit?: string;
            before?: string;
            level?: string;
            category?: string;
        };
    }>('/api/admin/bot-events', async (request, reply) => {
        if (!requireCapability(request, reply, 'admin')) return;

        const rawLimit = parseInt(request.query.limit ?? '50', 10);
        const limit = Number.isFinite(rawLimit)
            ? Math.min(Math.max(rawLimit, 1), 200)
            : 50;

        const rawBefore = request.query.before;
        const beforeId = rawBefore !== undefined ? parseInt(rawBefore, 10) : NaN;

        const where: Record<string, unknown> = {};

        if (!Number.isNaN(beforeId) && Number.isFinite(beforeId)) {
            where['id'] = { [Op.lt]: beforeId };
        }

        const rawLevel = request.query.level;
        if (rawLevel && ['info', 'warn', 'error'].includes(rawLevel)) {
            where['level'] = rawLevel;
        }

        const rawCategory = request.query.category;
        if (rawCategory && ['bot', 'auth', 'feature', 'web', 'error'].includes(rawCategory)) {
            where['category'] = rawCategory;
        }

        // Fetch one extra row to determine hasMore without a separate COUNT query.
        const rows = await BotEvent.findAll({
            where,
            order: [['id', 'DESC']],
            limit: limit + 1
        });

        const hasMore = rows.length > limit;
        const events = hasMore ? rows.slice(0, limit) : rows;

        return {
            events: events.map(row => ({
                id: row.getDataValue('id') as number,
                level: row.getDataValue('level') as string,
                category: row.getDataValue('category') as string,
                message: row.getDataValue('message') as string,
                context: (row.getDataValue('context') as Record<string, unknown> | null) ?? null,
                createdAt: (row.getDataValue('createdAt') as Date).toISOString(),
                updatedAt: (row.getDataValue('updatedAt') as Date).toISOString()
            })),
            hasMore
        };
    });
}
