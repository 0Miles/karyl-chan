// Discord serves stickers from two hosts depending on format:
// - format 1 (PNG), 2 (APNG), 3 (LOTTIE) live on cdn.discordapp.com
// - format 4 (GIF, used by user-uploaded Nitro stickers) only resolves on
//   media.discordapp.net and returns 404 from cdn
export function stickerImageUrl(id: string, formatType: number, size = 160): string {
    if (formatType === 4) {
        return `https://media.discordapp.net/stickers/${id}.gif?size=${size}`;
    }
    return `https://cdn.discordapp.com/stickers/${id}.png?size=${size}`;
}
