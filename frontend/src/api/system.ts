import { authedFetch, ApiError } from './client';
import type { FeatureSummary, SystemStats } from './types';

async function getJson<T>(path: string): Promise<T> {
    const response = await authedFetch(path);
    if (!response.ok) throw new ApiError(response.status, `${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
}

export async function getSystemStats(): Promise<SystemStats> {
    return getJson<SystemStats>('/api/system/stats');
}

export async function fetchFeatureSummary(): Promise<FeatureSummary> {
    return getJson<FeatureSummary>('/api/admin/feature-summary');
}
