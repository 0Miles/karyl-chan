# Role emoji

## 用途

讓成員透過對指定訊息加上 reaction emoji 來**領取對應的身分組**（role）。移除 reaction 則移除身分組。常見用途：自選通知偏好、自選遊戲身份、自選興趣分類等。

對應關係以**表情群組（emoji group）**為單位儲存。同一個 guild 可有多組獨立的 emoji → role 對應；每則被監聽的訊息綁定**一個**群組，bot 收到 reaction 時只會以該群組的對應來決定要給哪個身分組。

## 快速流程

1. `/role-emoji group add name:<group-name>` → 建立一個表情群組
2. `/role-emoji add group:<group> emoji:<emoji> role:<role>` → 在群組內建立 emoji → role 對應
3. 手動發一則「請選擇身分組」之類的公告訊息，或重複使用已有的訊息
4. `/role-emoji watch message-id:<id> group:<group>` → 告訴 bot 監聽該訊息並套用指定群組；bot 會自動把群組的 emoji 加為 reaction
5. 成員點 reaction → bot 給他對應身分組
6. 成員取消 reaction → bot 拿掉對應身分組

## 指令

所有指令皆需 `role-emoji.manage` capability。

### `/role-emoji group add name:<name>`

建立一個新的表情群組。群組名稱在同一 guild 內必須唯一。

### `/role-emoji group remove name:<name>`

刪除表情群組。其下所有 emoji → role 對應與所有訊息對該群組的綁定都會一併移除（FK cascade）。

### `/role-emoji group list`

列出當前 guild 所有表情群組以及各群組內的 emoji → role 對應。

### `/role-emoji add group:<group> emoji:<emoji> role:<role>`

在指定群組內建立一組 emoji → role 對應。`emoji` 可以是：
- Unicode emoji（`👍`、`❤️` 等）
- Custom emoji（`<:name:id>` 或 `<a:name:id>` animated 格式）

**同一群組內**同一個 emoji 只能對應一個 role；不同群組可重複使用同一個 emoji 並對應到不同 role。

### `/role-emoji remove group:<group> emoji:<emoji>`

移除指定群組內某 emoji 的對應。已登記訊息上的 reaction 不會被自動清掉（成員仍能點但 bot 不再處理）。

### `/role-emoji watch message-id:<id> group:<group>`

登記一則訊息為領取點，並把它綁定到指定的群組。

bot 會：
1. 自動對該訊息補上群組內已登記 emoji 的 reaction
2. 之後對該訊息的 reaction add/remove 會以該群組的對應來觸發身分組操作

`message-id` 是 Discord 訊息 ID（開發者模式右鍵 → 複製 ID）。

對已被監聽的訊息再次執行此指令會**換成新指定的群組**並補上新群組的 emoji reaction（舊群組多出來的 reaction 不會被自動移除）。

### `/role-emoji stop-watch message-id:<id>`

停止監聽該訊息，並清除其群組綁定。已對該訊息加 reaction 的成員不會被自動移除身分組。

## 規則細節

### Emoji 格式支援

目前內建的 regex 支援：
- 常見 Unicode emoji（copyright、registered、U+2000–U+3300 範圍、surrogate pair emoji）
- Custom emoji 格式 `<:name:id>` 或 `<a:name:id>`（animated）

**不支援**的類型（留作後續改善，見規劃中的 #17）：
- ZWJ 組合序列（`👨‍👩‍👧‍👦`）
- 膚色變體（`👍🏽`）
- 區域旗幟（`🇹🇼`）

### 群組綁定解析規則

reaction 觸發時，bot 直接讀取該訊息綁定的單一群組（`RoleReceiveMessage.groupId`），只查那個群組的對應；查不到對應就靜默忽略。

每則被監看訊息綁定 **恰好一個** 群組；schema 強制 NOT NULL。早期版本支援的「無 pin 退回全部群組」與「多群組綁定」行為已隨 `20260427030000-role-receive-single-group` migration 全面移除：升級時無綁定的舊資料會被刪除，多綁定的舊資料會自動收斂為最小 id 的那一個。

## 所需 Bot 權限

- `View Channels`
- `Read Message History`（fetch 訊息）
- `Add Reactions`（自動補 reaction）
- `Manage Roles`（賦予 / 移除身分組）

額外的階層限制：**bot 自己的最高 role 必須高於它要操作的 role**（Discord 強制）。

## 資料儲存

- `RoleEmojiGroup(id, guildId, name)`：表情群組；`(guildId, name)` 唯一。
- `RoleEmoji(groupId, emojiId, emojiChar, emojiName, roleId, sortOrder)`：emoji → role 對應；`(groupId, emojiId, emojiChar)` 為 PK，`groupId` FK→`RoleEmojiGroup`（cascade delete）。`sortOrder` 是群組內的插入順序，watch 加 reaction 時依此順序執行。
- `RoleReceiveMessage(guildId, channelId, messageId, groupId)`：被監聽的訊息；`groupId` NOT NULL FK→`RoleEmojiGroup`（cascade delete），每則訊息恰好綁定一個群組。

## 實作位置

| 檔案 | 功能 |
|---|---|
| `src/modules/builtin-features/role-emoji/role-emoji.commands.ts` | Slash 指令 |
| `src/modules/builtin-features/role-emoji/role-emoji.events.ts` | reaction add / remove handlers |
| `src/modules/builtin-features/role-emoji/role-emoji.model.ts` | Emoji → role 對應（含排序） |
| `src/modules/builtin-features/role-emoji/role-emoji-group.model.ts` | 表情群組 |
| `src/modules/builtin-features/role-emoji/role-receive-message.model.ts` | 監聽訊息（含群組綁定） |
