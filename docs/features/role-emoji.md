# Role emoji

## 用途

讓成員透過對指定訊息加上 reaction emoji 來**領取對應的身分組**（role）。移除 reaction 則移除身分組。常見用途：自選通知偏好、自選遊戲身份、自選興趣分類等。

對應關係以**表情群組（emoji group）**為單位儲存。同一個 guild 可有多組獨立的 emoji → role 對應；每則被監聽的訊息可指定要套用哪些群組（或保留預設「全部群組」），讓同一個 emoji 在不同訊息上能對應到不同 role。

## 快速流程

1. `/role-emoji group create name:<group-name>` → 建立一個表情群組
2. `/role-emoji mapping add group:<group> emoji:<emoji> role:<role>` → 在群組內建立 emoji → role 對應
3. 手動發一則「請選擇身分組」之類的公告訊息，或重複使用已有的訊息
4. `/role-emoji watch start message-id:<id> [groups:<g1,g2>]` → 告訴 bot 監聽該訊息；bot 會自動把指定群組（或全部群組）的 emoji 加為 reaction
5. 成員點 reaction → bot 給他對應身分組
6. 成員取消 reaction → bot 拿掉對應身分組

## 指令

所有指令皆需 `role-emoji.manage` capability。

### `/role-emoji group create name:<name>`

建立一個新的表情群組。群組名稱在同一 guild 內必須唯一。

### `/role-emoji group delete name:<name>`

刪除表情群組。其下所有 emoji → role 對應與所有訊息對該群組的 pin 都會一併移除（FK cascade）。

### `/role-emoji group list`

列出當前 guild 所有表情群組。

### `/role-emoji mapping add group:<group> emoji:<emoji> role:<role>`

在指定群組內建立一組 emoji → role 對應。`emoji` 可以是：
- Unicode emoji（`👍`、`❤️` 等）
- Custom emoji（`<:name:id>` 或 `<a:name:id>` animated 格式）

**同一群組內**同一個 emoji 只能對應一個 role；不同群組可重複使用同一個 emoji 並對應到不同 role。

### `/role-emoji mapping remove group:<group> emoji:<emoji>`

移除指定群組內某 emoji 的對應。已登記訊息上的 reaction 不會被自動清掉（成員仍能點但 bot 不再處理）。

### `/role-emoji mapping list group:<group>`

列出指定群組內的所有 emoji → role 對應。

### `/role-emoji watch start message-id:<id> [groups:<comma-separated-names>]`

登記一則訊息為領取點，並可選擇要 pin 哪些群組。

- `groups` 留空：訊息會套用本 guild 內**所有群組**的對應（與舊行為一致）。
- `groups:` 提供逗號分隔的群組名稱：訊息只會套用這些群組的對應。

bot 會：
1. 自動對該訊息補上所選群組（或全部群組）內已登記 emoji 的 reaction
2. 之後對該訊息的 reaction add/remove 會以這些群組的對應來觸發身分組操作

`message-id` 是 Discord 訊息 ID（開發者模式右鍵 → 複製 ID）。

對已被監聽的訊息再次執行此指令會**更新**其群組 pin 並補上新 emoji 的 reaction。

### `/role-emoji watch stop message-id:<id>`

停止監聽該訊息，並清除其群組 pin。已對該訊息加 reaction 的成員不會被自動移除身分組。

### `/role-emoji watch set-groups message-id:<id> [groups:<comma-separated-names>]`

修改既有監聽訊息的群組 pin。`groups` 留空 → 改為「套用全部群組」。

### `/role-emoji watch show message-id:<id>`

顯示某監聽訊息目前 pin 的群組。

## 規則細節

### Emoji 格式支援

目前內建的 regex 支援：
- 常見 Unicode emoji（copyright、registered、U+2000–U+3300 範圍、surrogate pair emoji）
- Custom emoji 格式 `<:name:id>` 或 `<a:name:id>`（animated）

**不支援**的類型（留作後續改善，見規劃中的 #17）：
- ZWJ 組合序列（`👨‍👩‍👧‍👦`）
- 膚色變體（`👍🏽`）
- 區域旗幟（`🇹🇼`）

### 群組 pin 解析規則

reaction 觸發時，bot 依下列順序決定要查哪些群組：
1. 若該訊息有 pin 任何群組 → 只查那些群組。
2. 若沒有 pin（junction 表中無紀錄）→ 查當前 guild 的**所有**群組。

舊資料庫升級後，原有的對應會被搬到一個叫 `default` 的群組，所有原本被監聽的訊息保持「無 pin」狀態，因此行為與升級前一致。

## 所需 Bot 權限

- `View Channels`
- `Read Message History`（fetch 訊息）
- `Add Reactions`（自動補 reaction）
- `Manage Roles`（賦予 / 移除身分組）

額外的階層限制：**bot 自己的最高 role 必須高於它要操作的 role**（Discord 強制）。

## 資料儲存

- `RoleEmojiGroup(id, guildId, name)`：表情群組；`(guildId, name)` 唯一。
- `RoleEmoji(groupId, emojiId, emojiChar, emojiName, roleId)`：emoji → role 對應；`(groupId, emojiId, emojiChar)` 為 PK，`groupId` FK→`RoleEmojiGroup`（cascade delete）。
- `RoleReceiveMessage(guildId, channelId, messageId)`：被監聽的訊息清單。
- `RoleReceiveMessageGroup(guildId, channelId, messageId, groupId)`：監聽訊息與群組的多對多關聯；空集合代表「套用全部群組」。

## 實作位置

| 檔案 | 功能 |
|---|---|
| `src/commands/role-emoji.commands.ts` | Slash 指令 |
| `src/events/role-emoji.events.ts` | reaction add / remove handlers |
| `src/models/role-emoji.model.ts` | Emoji → role 對應 |
| `src/models/role-emoji-group.model.ts` | 表情群組 |
| `src/models/role-receive-message.model.ts` | 監聽訊息清單 |
| `src/models/role-receive-message-group.model.ts` | 監聽訊息 ↔ 群組 junction |
