import type { BotStatus, HealthStatus } from './types';

export class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        ...init
    });
    if (!response.ok) {
        throw new ApiError(response.status, `${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
}

export const api = {
    getHealth: (init?: RequestInit) => getJson<HealthStatus>('/api/health', init),
    getBotStatus: (init?: RequestInit) => getJson<BotStatus>('/api/bot/status', init)
};
