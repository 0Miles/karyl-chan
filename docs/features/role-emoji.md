# Role emoji

## 用途

讓成員透過對指定訊息加上 reaction emoji 來**領取對應的身分組**（role）。移除 reaction 則移除身分組。常見用途：自選通知偏好、自選遊戲身份、自選興趣分類等。

## 快速流程

1. `/role-emoji add emoji:<emoji> role:<role>` → 建立 emoji → role 的對應
2. 手動發一則「請選擇身分組」之類的公告訊息，或重複使用已有的訊息
3. `/role-emoji watch-message message-id:<id>` → 告訴 bot 監聽該訊息；bot 會自動把所有已登記的 emoji 加為 reaction
4. 成員點 reaction → bot 給他對應身分組
5. 成員取消 reaction → bot 拿掉對應身分組

## 指令

### `/role-emoji add emoji:<emoji> role:<role>`
**Capability**：`role-emoji.manage`

建立一組 emoji → role 的對應。`emoji` 可以是：
- Unicode emoji（`👍`、`❤️` 等）
- Custom emoji（`:my_emoji:` 自動轉成 `<:my_emoji:12345>` 格式）

同一個 emoji 只能對應一個 role；重複登記會失敗。

### `/role-emoji remove emoji:<emoji>`
**Capability**：`role-emoji.manage`

移除某 emoji 的對應。已登記訊息上的 reaction 不會被自動清掉（成員仍能點但 bot 不再處理）。

### `/role-emoji list`
**Capability**：`role-emoji.manage`

列出當前 guild 所有 emoji → role 對應。Ephemeral 回覆。

### `/role-emoji watch-message message-id:<message-id>`
**Capability**：`role-emoji.manage`

登記一則訊息為領取點。bot 會：
1. 自動對該訊息補上所有已登記 emoji 的 reaction
2. 之後對該訊息的 reaction add/remove 會觸發身分組操作

`message-id` 是 Discord 訊息 ID（開發者模式右鍵 → 複製 ID）。

### `/role-emoji stop-watch-message message-id:<message-id>`
**Capability**：`role-emoji.manage`

停止監聽該訊息。已對該訊息加 reaction 的成員不會被自動移除身分組。

## 規則細節

### Emoji 格式支援

目前內建的 regex 支援：
- 常見 Unicode emoji（copyright、registered、U+2000–U+3300 範圍、surrogate pair emoji）
- Custom emoji 格式 `<:name:id>` 或 `<a:name:id>`（animated）

**不支援**的類型（留作後續改善，見規劃中的 #17）：
- ZWJ 組合序列（`👨‍👩‍👧‍👦`）
- 膚色變體（`👍🏽`）
- 區域旗幟（`🇹🇼`）

## 所需 Bot 權限

- `View Channels`
- `Read Message History`（fetch 訊息）
- `Add Reactions`（自動補 reaction）
- `Manage Roles`（賦予 / 移除身分組）

額外的階層限制：**bot 自己的最高 role 必須高於它要操作的 role**（Discord 強制）。

## 資料儲存

- `RoleEmoji(guildId, roleId, emojiChar, emojiId, emojiName)`
- `RoleReceiveMessage(guildId, channelId, messageId)`：被監聽的訊息清單

## 實作位置

| 檔案 | 功能 |
|---|---|
| `src/commands/role-emoji.commands.ts` | Slash 指令 |
| `src/events/role-emoji.events.ts` | reaction add / remove handlers |
| `src/models/role-emoji.model.ts` | Emoji 對應 |
| `src/models/role-receive-message.model.ts` | 監聽訊息清單 |
