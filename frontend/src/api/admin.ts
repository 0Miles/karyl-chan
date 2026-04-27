import { ApiError, authedFetch } from './client';
import type { AdminAuditEntry, AdminLoginEntry, BotEvent, BotEventCategory, BotEventLevel } from './types';

export interface AdminRole {
    name: string;
    description: string | null;
    capabilities: string[];
}

export interface AdminUserProfile {
    username: string;
    globalName: string | null;
    avatarUrl: string;
}

export interface AuthorizedUser {
    userId: string;
    role: string;
    note: string | null;
    isOwner: boolean;
    profile: AdminUserProfile | null;
}

export interface CurrentUser {
    userId: string;
    isOwner: boolean;
    role: string | null;
    note: string | null;
    profile: AdminUserProfile | null;
    capabilities: string[];
}

export interface AdminUserList {
    ownerId: string | null;
    users: AuthorizedUser[];
}

async function json<T>(response: Response): Promise<T> {
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json();
            if (body && typeof body.error === 'string') message = body.error;
        } catch {
            // non-JSON error body — keep the generic message
        }
        throw new ApiError(response.status, message);
    }
    return response.json() as Promise<T>;
}

export async function getCurrentUser(): Promise<CurrentUser> {
    const response = await authedFetch('/api/admin/me');
    return json<CurrentUser>(response);
}

export async function listAdminUsers(): Promise<AdminUserList> {
    const response = await authedFetch('/api/admin/users');
    return json<AdminUserList>(response);
}

export async function upsertAdminUser(payload: { userId: string; role: string; note?: string | null }): Promise<AuthorizedUser> {
    const response = await authedFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return json<AuthorizedUser>(response);
}

export async function deleteAdminUser(userId: string): Promise<void> {
    const response = await authedFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) {
        throw new ApiError(response.status, `HTTP ${response.status}`);
    }
}

export interface AdminCapabilityCatalogItem {
    key: string;
    description: string;
}

export async function listAdminCapabilities(): Promise<AdminCapabilityCatalogItem[]> {
    const response = await authedFetch('/api/admin/capabilities');
    const body = await json<{ capabilities: AdminCapabilityCatalogItem[] }>(response);
    return body.capabilities;
}

export async function listAdminRoles(): Promise<AdminRole[]> {
    const response = await authedFetch('/api/admin/roles');
    const body = await json<{ roles: AdminRole[] }>(response);
    return body.roles;
}

export async function upsertAdminRole(payload: { name: string; description?: string | null }): Promise<AdminRole> {
    const response = await authedFetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return json<AdminRole>(response);
}

export async function patchAdminRole(name: string, payload: { description: string | null }): Promise<AdminRole> {
    const response = await authedFetch(`/api/admin/roles/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return json<AdminRole>(response);
}

export async function deleteAdminRole(name: string): Promise<void> {
    const response = await authedFetch(`/api/admin/roles/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) {
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json();
            if (body && typeof body.error === 'string') message = body.error;
        } catch { /* noop */ }
        throw new ApiError(response.status, message);
    }
}

export async function grantRoleCapability(role: string, capability: string): Promise<void> {
    const response = await authedFetch(`/api/admin/roles/${encodeURIComponent(role)}/capabilities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability })
    });
    if (!response.ok && response.status !== 204) {
        throw new ApiError(response.status, `HTTP ${response.status}`);
    }
}

export async function revokeRoleCapability(role: string, capability: string): Promise<void> {
    const response = await authedFetch(
        `/api/admin/roles/${encodeURIComponent(role)}/capabilities/${encodeURIComponent(capability)}`,
        { method: 'DELETE' }
    );
    if (!response.ok && response.status !== 204) {
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json();
            if (body && typeof body.error === 'string') message = body.error;
        } catch { /* noop */ }
        throw new ApiError(response.status, message);
    }
}

export async function fetchRecentAudit(limit = 20, before?: number): Promise<AdminAuditEntry[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before !== undefined) params.set('before', String(before));
    const response = await authedFetch(`/api/admin/audit?${params.toString()}`);
    const body = await json<{ entries: AdminAuditEntry[] }>(response);
    return body.entries;
}

export async function fetchBotEvents(opts: {
    limit?: number;
    before?: number;
    level?: BotEventLevel;
    category?: BotEventCategory;
} = {}): Promise<{ events: BotEvent[]; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.before !== undefined) params.set('before', String(opts.before));
    if (opts.level !== undefined) params.set('level', opts.level);
    if (opts.category !== undefined) params.set('category', opts.category);
    const response = await authedFetch(`/api/admin/bot-events?${params.toString()}`);
    return json<{ events: BotEvent[]; hasMore: boolean }>(response);
}

export async function fetchAdminLoginStatus(): Promise<{ admins: AdminLoginEntry[] }> {
    const response = await authedFetch('/api/admin/login-status');
    return json<{ admins: AdminLoginEntry[] }>(response);
}
