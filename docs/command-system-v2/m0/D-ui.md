# M0-D：admin/behaviors 頁與 plugin 詳情頁線框設計草案

> 設計階段產出物。不含 `.vue` 程式碼，只含 ASCII 線框、結構描述、檔名建議、i18n key 樹。

---

## 前置：設計決策推論

**Aesthetic direction（設計方向）**

延續既有系統設計語言（CSS 變數驅動、`var(--border)` / `var(--bg-surface)` / `var(--accent)` 為基礎），
不引入新元件庫或主題包。
視覺升級方向：**資訊密度分層 + 來源信號優先**。
三種 source（custom / plugin / system）在列表與 form 中透過顏色 + icon 左側 indicator bar 構成第一層視覺 cue，
而不是用同一種灰色卡片靠文字 badge 區分。
記憶點：custom=accent 色、plugin=紫色（`--source-plugin`）、system=muted 灰色 + lock icon，
每張卡片左邊有 3px 色條，讓人在 100ms 內不讀文字就能分辨來源。

---

## 1. admin/behaviors 頁結構

### 1.1 側邊欄分類維度選擇

**選定：以 audience（對象）作為一級分類維度（H-2 + CR-9 修正後版本）。**

> **重要概念釐清（H-2）**：原 D-ui v1 草稿把「scope」與「target/audience」混為一談 ── 實際上：
> - `audience` ∈ {`all_dms`, `user`, `group`} 是 behavior 對象篩選
> - `scope` ∈ {`global`, `guild`} 是 Discord 指令**註冊作用域**
>
> 兩者完全不同概念，sidebar 只用 audience，scope 只出現在 form 的 Discord 三軸 section。

理由：
- **trigger** 維度（slash_command / message_pattern）只有兩種，平鋪或 filter-chip 即可，不值得佔一級側欄。
- **audience** 維度（all_dms / user / group）是現行側欄既有維度，admin 肌肉記憶，不打斷
- **scope** 屬於 Discord 三軸，只在 form 內顯示，不出現在 sidebar
- ~~**source filter-chip**~~：CR-9 用戶覆寫，**已移除**。三 source（custom / plugin / system）的視覺區分留在 workspace 卡片（左側 3px 色條）

### 1.2 側邊欄線框（CR-9 移除 filter；H-2 標題修正）

```
┌─────────────────────────────────┐
│  Behaviors              [+ 新增] │  ← sidebar-header，只有 canManageCatalog 才顯示 +
├─────────────────────────────────┤
│  ◉ 對象 (Audience)              │  ← H-2 修：原寫「Target (scope)」是概念混淆
│  ┌─────────────────────────────┐│
│  │ 💬 All DMs           (固定) ││  ← pinned，audienceKind='all'
│  │ 👤 User A                   ││
│  │ 👤 User B                   ││
│  │ 👥 Group 組合技             ││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

**設計說明**：
- ~~來源篩選器~~：CR-9 用戶覆寫已移除，不再提供。
- 保留現有 `all_dms` 置頂邏輯（`audienceKind === 'all'` pinned）。
- 三 source（custom / plugin / system）的視覺區分**留在 workspace 卡片**左側 3px 色條，而不靠側欄篩選。

### 1.3 Workspace behavior list row 樣貌

每條 behavior 用 `BehaviorCard`（accordion 折疊）。頭部 row 從左到右：

```
[source-bar] [drag-handle|lock] [▶/▼] [title]  [trigger-summary]  [tag...] [toggle] [⋮]
```

- **source-bar**：卡片左側 3px 色條。custom=`var(--accent)`，plugin=`var(--source-plugin, #7c3aed)`，system=`var(--text-muted)`。
- **drag-handle**：僅 source=custom 的 behavior 可拖曳排序（現行邏輯）；source=plugin / system 顯示鎖定 icon。
- **trigger-badge**（新增）：緊跟 trigger-summary 之後，顯示觸發類型 pill（`slash` / `pattern` 兩種，用 icon + 短文字）。
- **source-badge**（三種，現有 tag-plugin / tag-system 擴充）：
  - source=custom：不顯示 badge（custom 是預設，不需要額外標記）
  - source=plugin：`🧩 plugin-name`（show plugin name，不只是 "plugin"）
  - source=system：`⚙ 系統` lock badge

```
範例 row（source=plugin）：
│█│   ≡  ▼  管理員登入     /login    [⚡ slash]  [🧩 auth-bot]  [●○] [⋮] │
     ^drag-handle disabled（lock icon）

範例 row（source=custom）：
│█│  ⠿  ▼  早安觸發     starts: 早安    [📝 pattern]                [●○] [⋮] │
     ^accent色條  ^可拖曳

範例 row（source=system）：
│░│   🔒  ▼  DM admin 登入  /admin-login  [⚡ slash]  [⚙ 系統]   [—]     │
     ^muted色條  ^toggle隱藏（system 不可 toggle enabled）
```

### 1.4 主工作區 — 選中一條 behavior 後的 form 差異

**共同 header**：
```
[title h2]  [kind-badge: all_dms|user|group]  [spacer]  [+ 新增 Behavior]  [🗑️ 刪除 Target]
```

#### source=custom（完全可編輯）

```
┌────────────────────────────────────────────────────────────────┐
│ card-head: [drag] [▼] 標題 [trigger-summary] [tags] [toggle] [⋮]│
├────────────────────────────────────────────────────────────────┤
│ card-body（open 時）                                            │
│ ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│ │ 標題 *              │  │ 描述                             │ │
│ │ [input text]         │  │ [textarea]                       │ │
│ └──────────────────────┘  └──────────────────────────────────┘ │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│ │ 觸發類型     │  │ 觸發值       │  │ 移至 Target          │   │
│ │ [select]     │  │ [input]      │  │ [select]             │   │
│ └──────────────┘  └──────────────┘  └──────────────────────┘   │
│ ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│ │ Behavior 類型│  │  [if webhook] ────────────────────────── │ │
│ │ [select]     │  │  Webhook URL *                           │ │
│ │ webhook/plugin│  │  [input]                               │ │
│ └──────────────┘  │  Secret（可選）                          │ │
│                   │  [input type=password-text]               │ │
│                   └──────────────────────────────────────────┘ │
│                   [if plugin] ─────────────────────────────── │ │
│                   │  選擇 Plugin  [select]                    │ │
│                   │  選擇 behavior  [select]               │ │
│                   └──────────────────────────────────────────┘ │
│ ┌──────────────┐  ┌────────────────────┐                       │
│ │ 轉發模式     │  │ ☑ 匹配後停止       │                       │
│ │ [select]     │  └────────────────────┘                       │
│ └──────────────┘                                               │
│                                    [取消]  [儲存]              │
└────────────────────────────────────────────────────────────────┘
```

欄位全可編輯，與現行 `type='webhook'` / `type='plugin'` 邏輯相同。

#### source=plugin（三軸可改 + on/off；其餘唯讀）

```
┌────────────────────────────────────────────────────────────────┐
│ card-head: [lock] [▼] 標題 [trigger-summary] [🧩 plugin-name] [toggle] │
├────────────────────────────────────────────────────────────────┤
│ ┌── 來源說明 banner ─────────────────────────────────────────┐ │
│ │ 🧩 此 behavior 由 Plugin「auth-bot」提供，部分欄位不可修改  │ │
│ │    → 查看 Plugin 詳情                          [連結 →]   │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [唯讀區：灰底，用 readonly input 顯示]                          │
│ ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│ │ 標題（唯讀）         │  │ 描述（唯讀）                     │ │
│ │ [readonly input]     │  │ [readonly textarea]              │ │
│ └──────────────────────┘  └──────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ 觸發值（唯讀，plugin manifest 決定）                      │   │
│ │ [readonly input]  🔒                                      │   │
│ └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│ [可編輯區：三軸 + enabled]                                      │
│ ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│ │ Scope（Target）  │  │ Integration Type │  │ Context       │  │
│ │ [select/multi]   │  │ [select/multi]   │  │ [select/multi]│  │
│ └──────────────────┘  └──────────────────┘  └───────────────┘  │
│                                             [取消]  [儲存三軸] │
└────────────────────────────────────────────────────────────────┘
```

**重點設計決策**：
- 來源說明 banner（`source-notice`）使用 `var(--source-plugin-bg)` 底色，顯目但不干擾。
- 「查看 Plugin 詳情」是 router-link 到 `/admin/plugins/:pluginKey`。
- 觸發相關欄位（triggerType / triggerValue / webhookUrl / pluginBehaviorKey）全部 readonly，視覺上用 `background: var(--bg-page)` 灰底 + 🔒 icon 標示。
- Save 按鈕標籤改為「儲存三軸設定」避免 admin 誤以為可以改更多。

#### source=system（只能改 trigger value）

```
┌────────────────────────────────────────────────────────────────┐
│ card-head: [🔒] [▼] 標題 [trigger-summary] [⚙ 系統]           │
│  （無 toggle，無 ⋮ menu）                                       │
├────────────────────────────────────────────────────────────────┤
│ ┌── 鎖定說明 banner ──────────────────────────────────────────┐ │
│ │ ⚙ 系統內建 behavior，僅可修改觸發指令                        │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [唯讀欄位：標題、描述、behavior類型]                            │
│                                                                 │
│ [可編輯：trigger type + trigger value]                          │
│ ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│ │ 觸發類型             │  │ 觸發值（指令名稱）               │ │
│ │ [select，不含system] │  │ [input]                          │ │
│ └──────────────────────┘  └──────────────────────────────────┘ │
│                                                    [儲存觸發] │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Plugin 詳情頁建議

### 2.1 拍板：獨立 route（`/admin/plugins/:pluginKey`）

**理由（三條，不妥協）**：

1. **資訊量**：Plugin 詳情頁需承載「總覽 → behaviors → plugin 自訂指令 → guild features → scopes → setup secret」六個 section。PluginCard 的 accordion 是為「卡片清單中快速查看」設計的，強行塞六個 section 會讓卡片高度失控。
2. **可連結性**：source=plugin 的 behavior form 裡有「查看 Plugin 詳情」連結。這個連結必須有 URL。卡片展開無法被連結。
3. **navigation pattern 一致性**：admin/guilds 已有 `/admin/guilds/:guildId` 詳情 route，admin/plugins 走同樣的 pattern 符合整個 admin 的 mental model。

**Route 路徑**：`/admin/plugins/:pluginKey`（用 `pluginKey` 而不是 `id`，人類可讀、CLI 可輸入）

### 2.2 Plugin 詳情頁線框

```
/admin/plugins/:pluginKey
──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────┐
│ ← 返回外掛列表          [enable toggle]  [⚙ 三點 menu]        │  page-header
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  🧩 Plugin Name                v1.2.0                        │  h1 + version
│     plugin-key                                              │  monospace subheading
│     描述文字（manifest.plugin.description）                   │
│                                                              │
│  ● 上線  /  ○ 離線   最後心跳：3 分鐘前                      │  status row
│                                                              │
│  [stats chips: N dm behaviors · N guild features · N commands]│
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [Tab: 總覽] [Tab: Behaviors] [Tab: 指令] [Tab: Guild Features]│  AppTabs（CR-3 命名修正）
│             [Tab: Scopes]  [Tab: 安全設定]                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 Tab：Behaviors（軌二，plugin 提供的 webhook 接口層）

此 tab 顯示 plugin manifest 宣告的所有 `behaviors[]`（v2 manifest，原 v1 `dm_behaviors[]`），admin 可以 on/off 每條。CR-3 命名修正：v1 詞彙「DM Behaviors」改為「Behaviors」對齊 v2 manifest。

```
Tab: Behaviors
──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────┐
│ [說明文字] 以下是此 Plugin 在 DM 中提供的 behaviors。       │
│           啟用後，需在「Behaviors」頁建立對應的 behavior 條目│
│           才會生效。                                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ key: answer_qa                                           │ │
│ │ 名稱：Q&A 回答引擎                                       │ │
│ │ 描述：接收用戶訊息並呼叫 RAG 管道返回回答（manifest 提供）│ │
│ │ [badge: 支援連續對話] [badge: slash / pattern]            │ │
│ │ 三軸（唯讀 badge）：                                     │ │
│ │   Scope: global  IntegType: user_install  Ctx: BotDM,PrivateChannel │ │ ← H-3 修：對齊 §1.1 鎖定 enum
│ │                                     [toggle: on/off]     │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ key: summarize                                           │ │
│ │ 名稱：摘要助手                                           │ │
│ │ 描述：對長文字進行摘要（manifest 提供）                  │ │
│ │ 三軸（唯讀 badge）：manifest 鎖定值                      │ │
│ │                                     [toggle: on/off]     │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ 空狀態：此 Plugin 未宣告任何 Behavior。                  │
└──────────────────────────────────────────────────────────────┘
```

**每條 behavior row 的欄位**：
- `key`（monospace）
- `name`（font-weight 500）
- `description`（manifest 提供，唯讀展示給 admin 看）
- 三軸 badge（read-only pill，manifest 鎖定值）：scope / integration_types / contexts
- 是否支援連續對話 badge（`supports_continuous === true`）
- on/off toggle（admin 可操作；後端對應表 OQ-11 標明於 M1-A 與 M1-D 對齊；建議用 `plugin_behavior_overrides(pluginId, behaviorKey, enabled)` 新表）

---

### 2.3.1 Tab：指令（軌三，plugin 自訂指令）— H-4 補繪

CR-3 拍板獨立「指令」tab。此 tab 顯示 plugin manifest 宣告的所有 `plugin_commands[]`，三軸由 manifest 寫死，admin 只能 on/off 個別指令。

```
Tab: 指令
──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────┐
│ [說明文字] 以下是此 Plugin 提供的自訂 slash 指令。            │
│           三軸由 Plugin manifest 寫死，admin 只能啟用 / 停用。 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ name: /play                                              │ │
│ │ 描述：播放音樂（從 manifest）                            │ │
│ │ 三軸（read-only badge，manifest 鎖定）：                 │ │
│ │   Scope: guild  IntegType: guild_install  Ctx: Guild     │ │
│ │ 預設權限（read-only）：ManageGuild                       │ │
│ │ 預設 ephemeral：true                                      │ │
│ │                                     [toggle: on/off]     │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ name: /translate                                         │ │
│ │ 描述：翻譯訊息（從 manifest）                            │ │
│ │ 三軸（read-only badge）：                                │ │
│ │   Scope: global  IntegType: user_install  Ctx: BotDM,PrivateChannel │ │
│ │                                     [toggle: on/off]     │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ 空狀態：此 Plugin 未宣告任何自訂指令。                       │
└──────────────────────────────────────────────────────────────┘
```

**每條 plugin_command row 的欄位**：
- `name`（monospace，前綴 `/`）
- `description`（manifest 提供，唯讀展示給 admin 看）
- 三軸 read-only badge：scope / integration_types / contexts（M0-FROZEN §1.1 鎖定 enum）
- `default_member_permissions` read-only（manifest 提供）
- `default_ephemeral` read-only（manifest 提供）
- on/off toggle（admin 可操作，對應後端 `plugin_commands.adminEnabled`）

**與 Behaviors tab 的差別**：
| 維度 | §2.3 Behaviors tab（軌二） | §2.3.1 指令 tab（軌三） |
|------|---------------------------|------------------------|
| 來源 | `manifest.behaviors[]` | `manifest.plugin_commands[]` |
| 三軸 | 不在 manifest（admin 在 /admin/behaviors 設定）| manifest 鎖死 |
| 操作 | on/off + 在 admin/behaviors 改三軸 | 僅 on/off |
| webhook URL | plugin 提供 webhook_path | 走 plugin RPC dispatch（不顯示 URL）|

### 2.4 Tab：總覽

```
Tab: 總覽
──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────┐
│ dl 表格（meta-grid）：                                       │
│   Plugin URL    │ https://...                               │
│   Plugin Key    │ auth-bot（monospace）                     │
│   Author        │ ...（manifest）                           │
│   Homepage      │ ...（manifest，link）                     │
│   最後心跳      │ 3 分鐘前                                   │
├──────────────────────────────────────────────────────────────┤
│ 外掛設定（config_schema）                                    │
│   [config-grid：各欄位 label + input]                        │
│                                    [儲存設定]               │
└──────────────────────────────────────────────────────────────┘
```

### 2.5 Tab：Guild Features（軌一，只讀展示）

```
Tab: Guild Features
──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────┐
│ [說明] 以下功能可在各伺服器的「Bot 功能」tab 中個別開關。     │
│        此頁為唯讀展示。                                      │
├──────────────────────────────────────────────────────────────┤
│ [feature list：icon + name + description，無 toggle]         │
└──────────────────────────────────────────────────────────────┘
```

**說明**：軌一 GuildBotFeaturesPanel 邏輯不動。詳情頁的 Guild Features tab 只展示 manifest 宣告的 `guild_features` 清單（靜態展示），不提供 per-guild toggle（那個在 admin/guilds 頁面）。

### 2.6 Tab：Scopes

複用現有 PluginCard 內的 scope 管理 UI（approve / pending chips + 按鈕）。

### 2.7 Tab：安全設定

複用現有 PluginCard 內的 setup secret 按鈕 + confirm + result modal 流程。

---

## 3. AddBehavior Modal 線框

新 modal 取代現行「直接建立空白 webhook card 然後在 card 內填」的模式。
分兩步驟流程（wizard）。

### Step 1：選擇 source

```
┌──────────────────────────────────────────────────────────────┐
│  新增 Behavior                                     [×]       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  請選擇 Behavior 來源：                                      │
│                                                              │
│  ┌────────────────────────┐  ┌────────────────────────────┐  │
│  │  ⚡ 管理員自訂         │  │  🧩 Plugin 提供            │  │
│  │                        │  │                            │  │
│  │  自行設定 Webhook 或   │  │  選擇已安裝的 Plugin       │  │
│  │  連結至 Plugin，完全   │  │  提供的 behavior，三軸  │  │
│  │  可控                  │  │  由 manifest 決定          │  │
│  └────────────────────────┘  └────────────────────────────┘  │
│                                                              │
│  （System behavior 無法手動新增）                            │
│                                                              │
│  [取消]                                          [下一步 →] │
└──────────────────────────────────────────────────────────────┘
```

### Step 2a：source=custom

```
┌──────────────────────────────────────────────────────────────┐
│  新增 Behavior — 管理員自訂                        [×]       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ← 返回選擇來源                                             │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Behavior 名稱 *                                        │  │
│  │ [input]                                               │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  選擇觸發方式：                                              │
│  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │  ⚡ Slash Command    │  │  📝 訊息 Pattern             │  │
│  │  /command            │  │  startswith / regex / ...    │  │
│  └──────────────────────┘  └──────────────────────────────┘  │
│                                                              │
│  [if slash]: 觸發指令名稱  [input]                          │
│  [if pattern]: 匹配類型 [select]  觸發值 [input]            │
│                                                              │
│  ────── 三軸設定 ──────                                      │
│  Scope(Target)  [select]                                    │
│  Integration Types  [multi-select or checkboxes]            │
│  Contexts  [multi-select or checkboxes]                     │
│                                                              │
│  ────── 轉發設定 ──────                                      │
│  ○ Webhook  ○ Plugin                                       │
│  [if webhook]: URL [input]  Secret（可選）[input]           │
│  [if plugin]: 選擇 Plugin [select]  選擇 behavior [select]│
│                                                              │
│  [取消]                                          [建立]     │
└──────────────────────────────────────────────────────────────┘
```

### Step 2b：source=plugin

```
┌──────────────────────────────────────────────────────────────┐
│  新增 Behavior — Plugin 提供                       [×]       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ← 返回選擇來源                                             │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 選擇 Plugin                                           │  │
│  │ [select: plugin name + key]                           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 選擇 behavior                                       │  │
│  │ [select: behavior key + name + description]           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌── 三軸預覽（唯讀，manifest 決定）──────────────────────┐  │
│  │  Scope: global  IntegType: user_install  Ctx: BotDM,PrivateChannel │ ← H-3 修
│  │  ℹ️ 三軸由 Plugin manifest 鎖定，無法修改              │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Behavior 顯示名稱（可自訂）                           │  │
│  │ [input, default = behavior.name]                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [取消]                                          [建立]     │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 元件路徑與檔案建議

### 4.1 admin/behaviors 下

| 狀態 | 現有檔案 | 說明 |
|------|---------|------|
| 保留改名 | `BehaviorsPage.vue` → 保留，但內部邏輯配合新資料模型（source 篩選）調整 | |
| 保留 | `BehaviorSidebar.vue` → 保留，僅 sidebar 標題改「對象 (Audience)」（H-2 修；CR-9 移除 source filter-chip） | |
| 保留拆分 | `BehaviorWorkspace.vue` → 保留，拆出 `BehaviorSourceNotice.vue` banner 元件 | |
| 保留大改 | `BehaviorCard.vue` → 保留，新增 source-bar 色條 + 三種 source 的條件分支（custom/plugin/system 各自的 readonly 邏輯已有部分基礎，擴充） | |
| 廢棄替換 | `AddTargetModal.vue` → 保留（新增 target 的 modal），**新增** `AddBehaviorModal.vue`（新增 behavior 的 wizard modal，取代現行直接建立空白卡片的做法） | |

**新增檔案**：
```
frontend/src/views/admin/behaviors/
├── BehaviorsPage.vue          （保留，擴充 source filter 狀態）
├── BehaviorSidebar.vue        （保留，僅標題改 Audience；CR-9 不加 filter-chip）
├── BehaviorWorkspace.vue      （保留，拆出 BehaviorSourceNotice）
├── BehaviorCard.vue           （保留，擴充 source-bar + 三種 form 分支）
├── BehaviorSourceNotice.vue   （新增：plugin/system 來源說明 banner）
├── AddTargetModal.vue         （保留，無需大改）
└── AddBehaviorModal.vue       （新增：兩步驟 wizard modal）
```

### 4.2 admin/plugins 下

**新增 Plugin 詳情頁**：

```
frontend/src/views/admin/plugins/
├── PluginsPage.vue            （保留，只需在 PluginCard 加「→ 詳情」連結）
├── PluginCard.vue             （保留，加一個「查看詳情」icon button 在 card-head）
├── PluginDetailPage.vue       （新增：詳情頁 wrapper + header + AppTabs）
├── PluginDetailOverview.vue   （新增：總覽 tab = 現行 PluginCard body 的 meta + config）
├── PluginDetailBehaviors.vue  （新增：Behaviors tab）
├── PluginDetailCommands.vue   （新增：全域/feature 指令 tab）
├── PluginDetailFeatures.vue   （新增：Guild Features 唯讀展示 tab）
├── PluginDetailScopes.vue     （新增：Scopes tab，複用現行 approve 邏輯）
└── PluginDetailSecurity.vue   （新增：安全設定 tab，複用 setup secret 邏輯）
```

### 4.3 與 SidebarLayout / App* 元件的對齊

- **BehaviorsPage.vue**：繼續用 `SidebarLayout`，`#sidebar` slot = `BehaviorSidebar`，main slot = `BehaviorWorkspace`。不動。
- **PluginDetailPage.vue**：不用 `SidebarLayout`（詳情頁是全寬 tab layout）。用 `DashboardLayout` 或直接 `<div class="page">` 對齊 `PluginsPage.vue` 現有風格。
- **AddBehaviorModal.vue**：用 `AppModal`，對齊現有 `AddTargetModal` + `AppConfirmDialog` 的 modal 語言。
- **BehaviorSourceNotice.vue**：純 `<div class="source-notice">` banner，用 CSS 變數，不依賴 App* 元件。
- **PluginDetailBehaviors.vue** 的 toggle：用現有 `.toggle` / `.slider` CSS 模式（全局一致）。
- **AppTabs**：`PluginDetailPage.vue` 的 tab 切換用 `AppTabs.vue`（已存在於 components/）。

---

## 5. i18n Key 樹

```
# 現有節奏延伸

behaviors:
  sidebar:
    title: "Behaviors"
    addTooltip: "新增 Target"
    allDms: "所有 DM"
    allDmsHint: "適用所有私訊"
    userKindHint: "指定用戶"
    groupMemberCount: "{count} 位成員"
    # 新增：
    # ~~sourceFilter~~ 已移除（CR-9 用戶覆寫）

  page:
    pickTarget: "請選擇對象"

  workspace:
    newBehaviorDefaultTitle: "新 Behavior"
    addBehavior: "新增 Behavior"
    deleteTargetConfirm: "確定刪除 {label} 嗎？"
    deleteTargetTooltip: "刪除此 Target"
    kindAllDms: "所有 DM"
    kindUser: "指定用戶"
    kindGroup: "群組"
    empty: "尚無 Behavior"
    groupNameLabel: "群組名稱"
    membersToggle: "{count} 位成員"
    memberIdPlaceholder: "Discord User ID（17-20 位數字）"
    memberIdInvalid: "User ID 格式不符"
    membersEmpty: "群組目前沒有成員"

  card:
    # 現有（維持）
    title: "名稱"
    description: "描述"
    triggerType: "觸發類型"
    triggerValue: "觸發值"
    targetId: "目標"
    behaviorType: "Behavior 類型"
    behaviorTypeWebhook: "Webhook"
    behaviorTypePlugin: "Plugin"
    behaviorTypeSystem: "系統"
    forwardType: "轉發模式"
    forwardOneTime: "單次"
    forwardContinuous: "連續對話"
    webhookUrl: "Webhook URL"
    webhookSecret: "Webhook Secret"
    webhookSecretHint: "（可選，用於 HMAC 驗證）"
    webhookSecretPlaceholder: "留空 = 不設定"
    webhookUrlRequired: "請填入 Webhook URL"
    pluginRequired: "請選擇 Plugin"
    pluginBehaviorKeyRequired: "請選擇 behavior"
    pluginPick: "選擇 Plugin"
    pluginNoneAvailable: "（無可用 Plugin）"
    pluginBehaviorKey: "選擇 behavior"
    stopOnMatch: "匹配後停止（不繼續比對後續條目）"
    deleteConfirm: "確定刪除「{title}」嗎？"
    dragHint: "拖曳排序"
    moreActions: "更多操作"
    titleRequired: "名稱為必填"
    triggerValueRequired: "觸發值為必填"
    regexInvalid: "正規表達式語法錯誤"
    toggleEnabled: "點擊停用"
    toggleDisabled: "點擊啟用"
    tagContinuous: "連續對話模式"
    tagContinuousShort: "連續"
    tagStop: "匹配後停止"
    tagStopShort: "停止"
    tagPlugin: "由 Plugin 提供"
    tagPluginShort: "Plugin"
    tagSystem: "系統內建"
    tagSystemShort: "系統"
    systemRowLocked: "系統內建，不可拖曳"
    previewStartsWith: "以 {value} 開頭"
    previewEndsWith: "以 {value} 結尾"
    previewSlashCommand: "/{value}"
    previewRegex: "regex: {value}"
    triggerStartsWith: "以…開頭"
    triggerEndsWith: "以…結尾"
    triggerRegex: "Regex"
    triggerSlashCommand: "Slash 指令"
    # 新增：
    sourceCustom: "自訂"
    sourcePlugin: "Plugin"
    sourceSystem: "系統"
    sourceNoticPlugin: "此 behavior 由 Plugin「{name}」提供，部分欄位不可修改"
    sourceNoticPluginLink: "查看 Plugin 詳情"
    sourceNoticSystem: "系統內建 behavior，僅可修改觸發指令"
    saveTrigger: "儲存觸發"
    saveAxes: "儲存三軸設定"

  modal:
    addTarget: "新增 Target"
    kindLabel: "Target 類型"
    kindUser: "指定用戶"
    kindGroup: "群組"
    userIdLabel: "Discord User ID"
    userIdPlaceholder: "17-20 位數字"
    userIdInvalid: "User ID 格式不符"
    groupNameLabel: "群組名稱"
    groupNamePlaceholder: "例：VIP 群組"
    groupNameRequired: "請填入群組名稱"
    create: "建立"

  addModal:
    # 新增：AddBehaviorModal
    title: "新增 Behavior"
    step1Title: "選擇來源"
    sourceCustomTitle: "管理員自訂"
    sourceCustomDesc: "自行設定 Webhook 或連結至 Plugin，完全可控"
    sourcePluginTitle: "Plugin 提供"
    sourcePluginDesc: "選擇已安裝的 Plugin 提供的 behavior"
    sourceSystemNote: "System behavior 無法手動新增"
    step2AdminTitle: "管理員自訂"
    step2PluginTitle: "Plugin 提供"
    triggerSlash: "Slash 指令"
    triggerPattern: "訊息 Pattern"
    axesLabel: "三軸設定"
    axesNote: "由 Plugin manifest 鎖定，無法修改"
    nameLabel: "Behavior 名稱"
    namePlaceholder: "例：問答助手"
    forwardLabel: "轉發設定"
    forwardWebhook: "Webhook"
    forwardPlugin: "Plugin"
    back: "← 返回"
    create: "建立"

admin:
  plugins:
    # 現有（維持）
    title: "外掛管理"
    subtitle: "管理已安裝的 Plugin"
    empty: "尚未安裝任何 Plugin"
    emptyHint: "Plugin 啟動後會自動向 karyl-chan 登記"
    online: "上線"
    offlineCount: "{n} 個離線"
    statusActive: "上線"
    statusInactive: "離線"
    toggleEnabled: "點擊停用"
    toggleDisabled: "點擊啟用"
    dmBehaviorsCount: "{n} 個 Behavior"
    guildFeaturesCount: "{n} 個 Guild Feature"
    commandsCount: "{n} 個指令"
    url: "Plugin URL"
    lastHeartbeat: "最後心跳"
    neverHeartbeat: "從未心跳"
    heartbeatJustNow: "剛剛"
    heartbeatMinutesAgo: "{n} 分鐘前"
    heartbeatHoursAgo: "{n} 小時前"
    manifestRaw: "原始 Manifest"
    deleteAllOffline: "刪除所有離線"
    deleteAllConfirmTitle: "確認刪除所有離線 Plugin"
    deleteAllConfirm: "確定要刪除 {n} 個離線 Plugin 嗎？此操作不可復原。"
    deleteAllProgress: "已完成 {done} / {total}"
    deleteConfirmTitle: "確認刪除 Plugin"
    deleteConfirm: "確定要刪除「{name}」嗎？此操作不可復原。"
    rpcScopes: "RPC Scopes"
    # 新增：
    viewDetail: "查看詳情"

    # 詳情頁（新增）
    detail:
      backLink: "← 返回外掛列表"
      tabOverview: "總覽"
      tabBehaviors: "Behaviors"
      tabCommands: "指令"
      tabFeatures: "Guild Features"
      tabScopes: "Scopes"
      tabSecurity: "安全設定"
      overviewMeta:
        pluginKey: "Plugin Key"
        author: "作者"
        homepage: "首頁"
      behaviors:
        intro: "以下是此 Plugin 在 DM 中提供的 behaviors。啟用後，需在「Behaviors」頁建立對應的 behavior 條目才會生效。"
        empty: "此 Plugin 未宣告任何 Behavior"
        toggleOn: "啟用此 behavior"
        toggleOff: "停用此 behavior"
        supportsContinuous: "支援連續對話"
        axesReadonly: "三軸由 manifest 鎖定"
      commands:
        intro: "以下為此 Plugin 宣告的全域與 feature 指令"
        empty: "此 Plugin 未宣告任何指令"
        globalGroup: "全域指令"
        featureGroup: "Feature 指令"
        scopeGuild: "伺服器"
        scopeGlobal: "全域"
      features:
        intro: "以下功能可在各伺服器的「Bot 功能」tab 中個別開關，此頁為唯讀展示"
        empty: "此 Plugin 未提供 Guild Feature"
      scopes:
        approved: "已授權 Scopes"
        pending: "待審核 Scopes"
        pendingHint: "有 {n} 個待審核 Scope"
        pendingCount: "{n} 個待審核"
        approveButton: "授權"
        approveModalTitle: "授權 RPC Scopes"
        approveConfirm: "確定授權「{name}」申請的以下 RPC Scopes？"

    scopes:
      # 現有（保留）
      approved: "已授權 Scopes"
      pending: "待審核 Scopes"
      pendingHint: "{n} 個待審核"
      pendingCount: "{n} 個待審核"
      approveButton: "授權"
      approveModalTitle: "授權 RPC Scopes"
      approveConfirm: "確定授權「{name}」申請的以下 Scopes？"

    setupSecret:
      # 現有（保留）
      button: "重新產生 Setup Secret"
      confirmTitle: "確認重新產生"
      confirmBody: "重新產生「{name}」的 Setup Secret 後，舊的 Secret 立即失效。確定繼續？"
      resultTitle: "Setup Secret（僅顯示一次）"
      secretLabel: "Setup Secret"
      copyButton: "複製"
      copiedButton: "已複製"
      instruction: "請將此 Secret 貼到 Plugin 的環境變數中。"
      envHint: "KARYL_SETUP_SECRET={secret}"
      warning: "此 Secret 只顯示一次，關閉後無法再次查看。"
      checkboxLabel: "我已複製此 Secret"
      closeButton: "確認關閉"

    menu:
      delete: "刪除 Plugin"
```

---

## 6. 「拒絕 AI slop」自檢清單

### admin/behaviors 頁

1. **source 用左側色條區分，而不只靠 badge 文字**：三種 source（custom=accent、plugin=紫色、system=muted）在卡片列表中用 3px 左側 indicator bar 提供 pre-attentive 視覺 cue。絕對不允許「三種 source 全部用同一個灰色卡片，只靠 tag badge 文字區分」。
2. **source=plugin 的 banner 必須有 router-link**：「來源說明 banner」內的「查看 Plugin 詳情」連結必須是真實的 `<RouterLink>`，不能只是純文字。source=plugin 的唯讀欄位必須用視覺上明確的「灰底 + readonly 標記」，而不是用 `:disabled` 讓輸入框變灰但沒有說明。

### Plugin 詳情頁

1. **Tab layout 而不是無限長滾動頁**：Plugin 詳情有六個 section，使用 `AppTabs` 分頁。不允許把六個 section 全部縱向堆疊、靠錨點連結。資訊密度分層是關鍵。
2. **Behaviors tab 的 toggle 行為必須與 Behaviors 頁解耦**：詳情頁的 on/off 影響「此 behavior key 是否允許被使用」，而不是 Behaviors 頁某條具體 behavior 的 enabled。兩者是不同層級的開關，UI 上需要有明確說明文字，避免 admin 混淆（就算後端 API 一樣是 toggle，前端說明文字必須不同）。

### AddBehavior Modal

1. **兩步驟 wizard 不允許縮減為單一長 form**：source 選擇放 Step 1，細節設定放 Step 2。不要把 source=custom 和 source=plugin 的欄位全塞在一頁用 `v-if` 切換——那是「偷懶的 if-else」而不是設計，用戶看到的是「form 欄位突然出現/消失」。
2. **三軸設定必須在 plugin 路徑明確標示「唯讀由 manifest 決定」**：用 `ℹ️` 圖示 + 說明文字，不允許把三軸 select 變成 disabled 但不解釋原因。

---

## 設計風險拍板記錄

| 風險 | 拍板決定 | 理由 |
|------|---------|------|
| Plugin 詳情頁是獨立 route 還是 PluginCard 展開 | **獨立 route `/admin/plugins/:pluginKey`** | 六個 section 無法塞卡片；`source=plugin` 的 behavior 需要可連結的 URL；與 admin/guilds/:guildId 保持一致 pattern |
| Behaviors 頁側欄分類維度 | **audience 作為主側欄維度（all_dms/user/group），三軸只在 form 內** | H-2 修：原寫「scope」是概念混淆；CR-9：用戶覆寫移除 source filter；target 分類是現有用戶的肌肉記憶，不宜打斷 |

---

## M0-D 完成回報

### 1. 文件路徑
`/home/miles/workspace/karyl-chan/docs/command-system-v2/m0/D-ui.md`

### 2. 主要設計決策（7 點）

1. **audience 為主側欄維度（H-2 + CR-9 修正後）**：sidebar 主結構是 audience 三類（all_dms / user / group），保留現有 target 選擇體驗。CR-9 移除 source filter-chip，三 source 的視覺區分改靠 workspace 卡片左側色條。
2. **三種 source 用左側 3px 色條區分**：custom=accent、plugin=`--source-plugin`（紫）、system=muted，pre-attentive 識別，不靠文字 badge。
3. **source=plugin 的 form 加 banner + router-link**：明確告知 admin 哪些欄位被 plugin 鎖定，並提供跳轉詳情頁的路徑。
4. **Plugin 詳情頁獨立 route，用 AppTabs 分六 tab**：與 admin/guilds 的 pattern 一致；Behaviors tab 是新軌三的主要操作入口。
5. **AddBehavior 改為兩步驟 wizard modal**：取代現行「建立空白卡片再填」的反直覺流程；Step 1 選 source，Step 2 按 source 類型展示不同欄位。
6. **軌一 GuildBotFeaturesPanel 完全不動**：Plugin 詳情頁的 Guild Features tab 僅唯讀展示 manifest，per-guild toggle 仍在 admin/guilds。
7. **所有 CSS 變數命名新增 `--source-plugin` / `--source-plugin-bg`**：不引入新元件庫，只擴充現有 CSS 變數體系。

### 3. 對其他子任務 A / B / C 的硬依賴與命名對齊

- **API 欄位命名**：設計假設 `BehaviorRow` 新增 `source: 'custom' | 'plugin' | 'system'` 欄位（現有 v1 `type` 是 `'webhook' | 'plugin' | 'system'`，CR-9 改名為 `source` 並把 `'webhook'` 改為 `'custom'`）。實作前需與後端對齊。
- **三軸欄位命名**：設計中多次提到「scope / integration_types / contexts」三軸，這些欄位名稱需要後端 API 確認後實作子任務才能動工。
- **Plugin behavior on/off 開關**：詳情頁 Behaviors tab 的 toggle 對應的後端 API endpoint 名稱未確定，需要後端子任務先定義。
- **router 設定**：Plugin 詳情頁 route `/admin/plugins/:pluginKey` 需要 router.ts 新增 route entry，這是 C 子任務（或 fullstack 實作）的前置。

### 4. 兩個重要設計風險的拍板答案

| 風險 | 答案 |
|------|------|
| Plugin 詳情頁路由方式 | 獨立 route `/admin/plugins/:pluginKey` |
| Behaviors 側欄分類維度 | audience 為主側欄維度（H-2 修概念混淆，CR-9 移除 source filter，三軸只在 form 內）|
