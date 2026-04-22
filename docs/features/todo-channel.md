# Todo channel

## 用途

把一個頻道當成共享的待辦事項清單。提及某個成員的訊息被視為一則「待辦」，任何人對該訊息加上 reaction 就視為完成。

## 快速流程

1. `/todo-channel watch`（在想當作清單的頻道執行）
2. 其他成員在該頻道發訊息並 `@某人`，訊息自動登記為 todo
3. 任何人對該訊息加 reaction → todo 被標記為完成
4. `@bot` 自己 → bot 會把所有未完成的 todo 拉到頻道底部重新列出
5. 若不再需要 → `/todo-channel stop-watch`

## 指令

### `/todo-channel watch`
**Capability**：`todo.manage`

把當前頻道登記為 todo list。重複執行不會出錯（已登記會回 "No action"）。

### `/todo-channel stop-watch`
**Capability**：`todo.manage`

停止把當前頻道視為 todo list。已存在的 todo 記錄會一併移除。

### `/todo-channel check-cache`
**Capability**：`todo.manage`

掃描當前頻道的最近 100 則訊息，凡是符合「有 mention、無任何 reaction、非提及 bot 的訊息」的都補登記為 todo。用於手動同步（例如 bot 離線期間漏收的訊息）。

## 規則細節

### 什麼算 todo？

- 訊息必須由**非 bot 的使用者**發送
- 訊息必須 mention 至少一位成員
- 訊息不能只提及 bot 本身（除非是 reply 型別）

### 什麼算完成？

- 訊息被加上**任何 reaction**（包含 bot 自己加的）
- 移除所有 reaction 會把訊息重新視為未完成 todo

### 提及 bot 的行為

當某人在 todo channel 發訊息並 mention 本 bot，bot 會：
1. 把該頻道的所有未完成 todo 撈出
2. 對每則原始 todo：
   - 若該則已經有 reaction 或沒有 mention 任何人 → 從記錄中移除
   - 若是 bot 自己重新發過的 reply 訊息 → 刪除並清記錄
   - 若原訊息有討論串（thread）→ 在原位以 reply 留一份副本
   - 否則 → 在頻道底部重新發一次（帶附件），刪除原訊息
3. 刪除使用者那則觸發用的 @bot 訊息

### Reply 的特殊規則

當 todo 被 reply 型別的訊息 reaction 標記完成時，bot 會自動對 reply 目標訊息加上 👍 reaction（反之，移除 reaction 時也會移除 👍）。這是為了串起「回覆＝完成」的視覺指示。

## 所需 Bot 權限

- `View Channels`
- `Send Messages`
- `Manage Messages`（才能刪除過期 todo）
- `Read Message History`
- `Add Reactions`

## 資料儲存

- `TodoChannel(channelId, guildId)`：哪些頻道被 watch
- `TodoMessage(messageId, channelId, guildId, createdAt)`：每則 todo

## 實作位置

| 檔案 | 功能 |
|---|---|
| `src/commands/todo-channel.commands.ts` | Slash 指令 |
| `src/events/todo-channel.events.ts` | messageCreate / reaction handlers |
| `src/models/todo-channel.model.ts` | 頻道登記 |
| `src/models/todo-message.model.ts` | Todo 訊息記錄 |
