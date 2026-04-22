import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebServer } from '../src/web/server.js';

describe('web server', () => {
    let server: FastifyInstance;

    beforeAll(async () => {
        server = await createWebServer();
        await server.ready();
    });

    afterAll(async () => {
        await server.close();
    });

    describe('GET /api/health', () => {
        it('responds 200 with status ok', async () => {
            const response = await server.inject({ method: 'GET', url: '/api/health' });
            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.status).toBe('ok');
        });

        it('includes uptime as a non-negative number', async () => {
            const response = await server.inject({ method: 'GET', url: '/api/health' });
            const body = response.json();
            expect(typeof body.uptime).toBe('number');
            expect(body.uptime).toBeGreaterThanOrEqual(0);
        });

        it('includes an ISO timestamp', async () => {
            const response = await server.inject({ method: 'GET', url: '/api/health' });
            const body = response.json();
            expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });
    });

    describe('unknown routes', () => {
        it('returns 404', async () => {
            const response = await server.inject({ method: 'GET', url: '/api/does-not-exist' });
            expect(response.statusCode).toBe(404);
        });
    });
});
