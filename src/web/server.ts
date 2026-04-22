import Fastify, { FastifyInstance } from 'fastify';

export interface WebServerOptions {
    port: number;
    host?: string;
}

export async function createWebServer(): Promise<FastifyInstance> {
    const server = Fastify({
        logger: {
            level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
        }
    });

    server.get('/api/health', async () => {
        return {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    });

    return server;
}

export async function startWebServer(options: WebServerOptions): Promise<FastifyInstance> {
    const server = await createWebServer();
    await server.listen({
        port: options.port,
        host: options.host ?? '0.0.0.0'
    });
    return server;
}
