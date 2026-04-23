// Discord serves the still frame of an animated avatar on the .webp endpoint
// by default and the animated variant when ?animated=true is appended. We
// detect the `a_` hash prefix in the path and only opt into animation while
// the operator is hovering the row, mirroring Discord's own behaviour.

export function isAnimatedAvatar(url: string | null | undefined): boolean {
    if (!url) return false;
    return /\/avatars\/\d+\/a_/.test(url);
}

export function animatedAvatarUrl(url: string): string {
    return url.includes('?') ? `${url}&animated=true` : `${url}?animated=true`;
}
