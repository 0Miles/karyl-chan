// Discord encodes animated avatars/banners with an `a_` hash prefix. The
// `.webp` endpoint serves the still frame by default and the animated
// variant when `&animated=true` is appended (Discord CDN honours this
// query parameter; the .gif endpoint returns 415 for many assets so we
// stay on .webp). Consumers opt into animation selectively — hover on a
// DM row vs. always-playing inside the profile card.

export function isAnimatedAvatar(url: string | null | undefined): boolean {
    if (!url) return false;
    return /\/avatars\/\d+\/a_/.test(url);
}

export function isAnimatedBanner(url: string | null | undefined): boolean {
    if (!url) return false;
    return /\/banners\/\d+\/a_/.test(url);
}

export function animatedAvatarUrl(url: string): string {
    return url.includes('?') ? `${url}&animated=true` : `${url}?animated=true`;
}
