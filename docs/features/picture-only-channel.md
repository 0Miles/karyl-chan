# Picture-only channel

## 用途

把某個頻道限制為**只能發送含附件（圖片、影片、檔案等）的訊息**；純文字訊息會被自動刪除。

適合用於作品展示、梗圖分享、截圖回報等需要視覺內容的頻道。

## 快速流程

1. `/picture-only-channel watch`（在想限制的頻道執行）
2. 成員在該頻道發純文字訊息 → 立刻被 bot 刪除
3. 含附件的訊息保留（訊息本身的文字內容不受限）
4. 不再需要 → `/picture-only-channel stop-watch`

## 指令

### `/picture-only-channel watch`
**Capability**：`picture-only.manage`

把當前頻道登記為圖片限定頻道。

### `/picture-only-channel stop-watch`
**Capability**：`picture-only.manage`

取消限制。

## 規則細節

### 附件判定

只要訊息帶有**任一種附件**（`message.attachments.size > 0`）就保留：
- 圖片 / 影片 / 音訊 / 文件
- Discord 的 sticker、embed 不算（這些不屬於 `attachments`）

### 例外

- Bot 自己發的訊息同樣受限（實務上本 bot 不會在這類頻道發文字）
- 所有訊息都要通過 `messageCreate` 事件處理，因此離線期間發的訊息不會被回溯刪除
- Reply 帶文字回覆一則有圖片的訊息，若該 reply 自己沒圖片，會被刪除

## 所需 Bot 權限

- `View Channels`
- `Read Message History`
- `Manage Messages`（刪除違規訊息）

## 資料儲存

- `PictureOnlyChannel(channelId, guildId)`：哪些頻道被 watch

## 實作位置

| 檔案 | 功能 |
|---|---|
| `src/commands/picture-only-channel.commands.ts` | Slash 指令 |
| `src/events/picture-only-channel.events.ts` | messageCreate 過濾 |
| `src/models/picture-only-channel.model.ts` | 頻道登記 |
