import { computed, ref } from 'vue';

const ACCESS_KEY = 'karyl-access-token';
const ACCESS_EXPIRES_KEY = 'karyl-access-expires';
const REFRESH_KEY = 'karyl-refresh-token';

export interface IssuedTokens {
    accessToken: string;
    accessExpiresAt: number;
    refreshToken: string;
    refreshExpiresAt: number;
}

const accessToken = ref<string | null>(localStorage.getItem(ACCESS_KEY));
const accessExpiresAt = ref<number | null>(parseNumber(localStorage.getItem(ACCESS_EXPIRES_KEY)));
const refreshToken = ref<string | null>(localStorage.getItem(REFRESH_KEY));

function parseNumber(value: string | null): number | null {
    if (!value) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export function setTokens(tokens: IssuedTokens): void {
    accessToken.value = tokens.accessToken;
    accessExpiresAt.value = tokens.accessExpiresAt;
    refreshToken.value = tokens.refreshToken;
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(ACCESS_EXPIRES_KEY, String(tokens.accessExpiresAt));
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
    accessToken.value = null;
    accessExpiresAt.value = null;
    refreshToken.value = null;
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(ACCESS_EXPIRES_KEY);
    localStorage.removeItem(REFRESH_KEY);
}

export function getAccessToken(): string | null {
    return accessToken.value;
}

export function getRefreshToken(): string | null {
    return refreshToken.value;
}

export function accessTokenExpired(now: number = Date.now()): boolean {
    return accessExpiresAt.value !== null && accessExpiresAt.value <= now + 5_000;
}

export const isAuthenticated = computed(() => accessToken.value !== null);
