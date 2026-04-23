import { authedFetch, ApiError } from './client';
import type { SystemEvent, SystemStats } from './types';

async function getJson<T>(path: string): Promise<T> {
    const response = await authedFetch(path);
    if (!response.ok) throw new ApiError(response.status, `${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
}

export async function getSystemEvents(): Promise<SystemEvent[]> {
    const data = await getJson<{ events: SystemEvent[] }>('/api/system/events');
    return data.events;
}

export async function getSystemStats(): Promise<SystemStats> {
    return getJson<SystemStats>('/api/system/stats');
}
