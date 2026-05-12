# Plugin 開發指南

> Plugin 的「怎麼寫」住在獨立的 [`karyl-chan-plugins`](https://github.com/0Miles/karyl-chan-plugins) monorepo
> —— 共用 SDK（`@karyl-chan/plugin-sdk`）+ 官方 plugin 都在那。本文件只
> 講 **bot 這一側的 plugin 協定**：認證、生命週期、派送、RPC。寫實際
> plugin 請看那個 repo 的 `README.md` 與 `packages/sdk/README.md`。

karyl-chan 的 plugin 是「同 docker network 的 sibling 服務」，不是
in-process 模組。Plugin 啟動時主動向 bot 註冊 manifest；bot 把 Discord
互動 / 事件 派送給它；plugin 透過 RPC 反向操作 bot。所有跨服務呼叫都
經過 HMAC 簽章或 bearer token，沒有任何祕密在 plugin 之間共用 —— 一個
plugin 被攻陷不會牽連別的 plugin 或 bot 本身。

## 認證與生命週期

```
admin 預先配發 per-plugin setup secret
   POST /api/plugins/setup-secret { pluginKey }   →  { setupSecret }（只回一次）
                                                       存進該 plugin 的 KARYL_PLUGIN_SETUP_SECRET
plugin 啟動
   POST /api/plugins/register
     header  X-Plugin-Setup-Secret: <setupSecret>
     body    { manifest }
   ← { plugin, token, dispatchHmacKey, sessionVerifyPublicKey,
       heartbeat: { path, interval_seconds } }

plugin 每 ~30s
   POST /api/plugins/heartbeat   header  Authorization: Bearer <token>
   ← { ok: true, sessionVerifyPublicKey }      ← 拿到輪替後的新公鑰

401（bot 重啟清掉 token 快取）→ plugin 重跑 register
```

- **`X-Plugin-Setup-Secret`** — 每個 plugin 一條，admin 用 `POST /api/plugins/setup-secret`
  預先建立（bot 只存 SHA-256 hash，cleartext 給一次）。沒有全域 fallback；
  DB 裡沒有 `setupSecretHash` 的 plugin register 直接 401。
- **`token`**（bearer）— register 時配發，每次 re-register 輪替，bot 只存
  hash。用於所有 `/api/plugin/*` RPC。heartbeat 會延長其有效期。
- **`dispatchHmacKey`** — bot 第一次 register 時 `randomBytes(32)` 生成、
  DB 存（明文，bot 內部）、回給 plugin 一次。**bot → plugin 的所有派送都用
  這把 key 做 HMAC 簽章**；plugin 收到請求時驗章。
- **`sessionVerifyPublicKey`** — bot 的 JWT 簽發中心（Ed25519，見
  [架構文件](../architecture.md) / `src/modules/web-core/jwt.service.ts`）的
  **公鑰**（SPKI PEM）。需要做 WebUI 的 plugin（如 radio）用它離線驗證
  `plugin-session` token；不需要 WebUI 的 plugin 忽略即可。register response
  跟每次 heartbeat 都會帶（輪替後 ~30s 內生效）。

## Bot → Plugin 派送（slash command / autocomplete / 事件）

bot 對 manifest 宣告的 endpoint POST 一個 JSON payload，帶這幾個 header：

| Header | 內容 |
|---|---|
| `X-Karyl-Timestamp` | unix 秒 |
| `X-Karyl-Signature` | `v0=<hex>`，`HMAC-SHA256(dispatchHmacKey, "v0:<ts>:<body>")` |
| `X-Karyl-Signature-V1` | `v1=<hex>`，`HMAC-SHA256(dispatchHmacKey, "v1:<METHOD>:<path>:<ts>:<body>")` |

plugin 兩個都收得到；有 v1 就優先驗 v1（method+path bound，防跨端點重放）；
時間戳超過 ±300s 一律拒。SDK 的 `createPluginServer` 已經把這套驗證包好了。

- **slash command** — bot 先 `deferReply`（3s budget），POST 到 plugin 的
  `/commands/:commandName`，**不等回應**；plugin 自己透過 `/api/plugin/interactions.respond`
  RPC 回填那個 deferred reply（Discord 給 15 分鐘）。
- **autocomplete** — 必須同步回，bot 等 plugin POST `/commands/:name/autocomplete`
  的回應（1.5s budget），逾時 / 失敗 → 回空清單。
- **元件（按鈕）** — plugin 在它送出的訊息上掛 Discord v1 按鈕，`custom_id` 形如
  `kc:<pluginKey>:<componentId>`（可再帶 `:<tail>` 夾參數；SDK 的
  `componentCustomId(pluginKey, id, tail?)` 幫你建）。使用者點擊時 bot 先
  `deferUpdate()` ack（3s budget，不改訊息），再 POST 到 plugin manifest
  `endpoints.plugin_component`（預設 `/components`），帶點擊者 id / 顯示名稱 /
  目前所在語音頻道 id / plugin-scoped capability、訊息 id、以及那次點擊的
  （新鮮 15 分鐘）`interaction_token`。**不等回應**；plugin 透過
  `interactions.respond`（PATCH 按鈕所在訊息的 `@original`）回填，或
  `interactions.followup`（`ephemeral: true`）發個提示。component interaction
  每次點擊都是全新 interaction（含新 token），所以按鈕在訊息存在期間一直有效。
  SDK 端：`definePluginComponent({ id, handler })`，handler 拿到 `ComponentContext`，
  回傳 `{ content?, embeds?, components? }` 就會被拿去 PATCH `@original`，回傳
  空 / null 則維持訊息原狀。
- **事件** — manifest `events_subscribed` 宣告要收哪些；bot fan-out 到
  plugin 的 `/events`。

## Plugin → Bot RPC

`POST /api/plugin/<method>`，`Authorization: Bearer <token>`，body 是 JSON。
能呼叫哪些 method 由 manifest 的 `rpcMethodsUsed` 決定 —— 它就是這個 plugin 被授予的
scope：register 時 bot 直接把這份清單簽進 token，沒有 admin 核准步驟。每次 RPC 仍會
檢查 scope（呼叫沒在 manifest 宣告的 method 一律 403），所以 plugin 能呼叫的就是它宣告的。
常見：`interactions.respond` / `interactions.followup` /
`messages.send`（可帶 `components` —— v1 action rows）/ `messages.edit`
（改 bot 送過的訊息；`components: []` 清掉按鈕）/ `messages.delete` /
`messages.send_dm` / `voice.join` / `voice.play` / `voice.pause`
（`{ guild_id, paused? }`，省略 `paused` 即切換）/ `voice.stop` /
`voice.status` / `auth.session` / KV 存取等 —— 完整清單看 bot 端
`src/modules/plugin-system/plugin-rpc-routes.ts`，SDK 端 `ctx.botRpc(path, body)`。
`messages.send` / `messages.edit` 受 per-guild feature gate：plugin 在目標頻道
所在 guild 至少要有一個啟用中的 feature 才能送 / 改訊息。

### WebUI plugin 的使用者授權（plugin-session token）

需要給使用者一個瀏覽器可開的 WebUI 的 plugin（目前只有 radio）：

1. plugin 在 slash 指令裡呼叫 `POST /api/plugin/auth.session`（需 `auth.session` scope），
   bot 用它的 JWT 簽發中心簽一個 `plugin-session` JWT（帶 `userId` / `guildId` /
   使用者的 `admin` + `plugin:<thisKey>:*` capability 子集）回給 plugin。
2. plugin 把 token 塞進 WebUI 連結交給使用者。
3. WebUI server 收到請求 → 用 `sessionVerifyPublicKey` **離線**驗證該 JWT
   （SDK 的 `verifyPluginSession(token, publicKey)`），拿 `userId` / `capabilities`
   自己做授權判斷 —— 不用回打 bot。

token 是 bot 用 Ed25519 私鑰簽的，plugin 只有公鑰 → 驗得了、偽造不了。
admin 在系統設定頁可以輪替簽發金鑰；輪替後所有現存 token 立即作廢，plugin
在一個 heartbeat 週期內拿到新公鑰。

## Plugin WebUI 反向代理

Bot 內建反向代理，讓 plugin 的 WebUI 可以借用 bot 的 TLS 憑證與公開 port，不需要自己申請憑證或暴露額外 port。

### 路由規則

| 請求 | 行為 |
|---|---|
| `GET /plugin/<pluginKey>` | 301 redirect → `/plugin/<pluginKey>/` |
| `ANY /plugin/<pluginKey>/*` | 轉發到 plugin 在 manifest 宣告的 `url`，去掉 `/plugin/<pluginKey>` 前綴 |

例：bot 公開網址 `https://bot.example.com`，plugin `karyl-radio` 的 `plugin.url = "http://karyl-radio-plugin:3000"`：

```
GET https://bot.example.com/plugin/karyl-radio/dashboard?tab=queue
 → 轉發到 http://karyl-radio-plugin:3000/dashboard?tab=queue
```

### 認證行為

`/plugin/*` 路由**不需要 bot 登入 session**。Plugin 應自行驗證 `plugin-session` JWT（見上方「WebUI plugin 的使用者授權」）。Discord `?token=` 連結直接降落在此路徑，不需要事先取得 bot 的 access token。

### 代理條件

- Plugin 的 DB 紀錄必須存在且 `status === 'active'`（即 plugin 正在心跳）。
- `enabled` 旗標**不影響**代理——`enabled` 只控制 Discord 指令 / 事件的派送，不控制 plugin 自身的 HTTP 介面；admin 可以在不重新啟用 Discord 指令的情況下存取停用 plugin 的 WebUI。
- 未知的 pluginKey 或 `status !== 'active'` → `404 { "error": "unknown plugin" }`。
- 轉發 URL 取自 DB 儲存的 `plugin.url`（即 manifest 宣告值），不採用任何來自 request 的 host/來源。

### `publicBaseUrl`：plugin 如何知道自己的公開網址

Register 和每次 heartbeat 的回應都新增了 `publicBaseUrl` 欄位：

```json
{
  "ok": true,
  "sessionVerifyPublicKey": "...",
  "publicBaseUrl": "http://localhost:902/plugin/karyl-radio"
}
```

值為 `<WEB_BASE_URL>/plugin/<pluginKey>`（`WEB_BASE_URL` 末尾斜線會自動去除）。
**當 `WEB_BASE_URL` 未設定時，此欄位完全省略**（不會送 `null` 或空字串）。

有 WebUI 的 plugin 應使用 `publicBaseUrl` 作為瀏覽器可觸及的 base URL，並把路徑部分注入到 server-render 的 HTML 中（例如設定 `<base href="/plugin/karyl-radio/">`），讓 client-side 的 `fetch` / 靜態資源路徑正確落在代理前綴下。

SDK 會在後續版本將此欄位作為屬性暴露（`publicBaseUrl` 欄位已在 register / heartbeat 回應中）。

### CSP 要求

Bot 的 `@fastify/helmet` 設定了嚴格的 `Content-Security-Policy`，此 CSP 會套用到所有 `/plugin/*` 回應。如果 plugin 的 WebUI 回應中包含 `Content-Security-Policy` header，該 header 會覆蓋 bot 的預設 CSP（`@fastify/reply-from` 將 upstream 的 response headers 轉發給瀏覽器）。**有 WebUI 的 plugin 必須自行在回應中送出適當的 `Content-Security-Policy`**；未送出 CSP 的 plugin 將沿用 bot 的嚴格預設 CSP，大多數 inline script / style 都會被封鎖。

### 限制

- **SSE（text/event-stream）**：長時間保持的 SSE 串流會在代理的 30 秒 upstream timeout 到期時被切斷。如果 plugin 的 WebUI 需要 server-sent events，必須在自己的 WebSocket / SSE 連線逾時前重連，或改用其他通訊方式。
- **WebSocket**：`@fastify/reply-from` 不代理 WebSocket `Upgrade` 請求。未來如有 plugin 需要 WebSocket，代理必須擴充支援。

### 好處

Plugin 不再需要自己的 TLS 憑證或對外 port：bot 的 reverse proxy 替它處理 TLS 終端和對外 URL。

---

## 部署

每個 plugin 是一個 docker service，掛在 bot 建立的 `karyl-chan-net`
external network 上，環境變數至少要 `BOT_URL`（預設 `http://karyl-chan:3000`）、
`PLUGIN_URL`（bot 派 dispatch 用，預設容器主機名）、`KARYL_PLUGIN_SETUP_SECRET`。
官方 plugin 的 `docker-compose.yml` 在 `karyl-chan-plugins` repo 根目錄。

`KARYL_PLUGIN_SETUP_SECRET` 由 admin 預先配發：在 bot 的 `/admin/plugins`
頁點「新增 Plugin」、輸入 plugin 的 manifest `id`（也可直接 `POST
/api/plugins/setup-secret { pluginKey }`）—— bot 會建一個 placeholder row 並
一次性回傳明文 secret。把它填進該 plugin 的 `.env` 再啟動 plugin，plugin 就會
帶這個 secret 自動向 bot 註冊，之後在 `/admin/plugins` 由 admin 啟用。

## 相關檔案

- bot 端：`src/modules/plugin-system/`（`plugin-routes.ts` register/heartbeat、
  `plugin-interaction-dispatch.service.ts` 指令派送、`plugin-event-bridge.service.ts`
  事件派送、`plugin-rpc-routes.ts` RPC、`plugin-registry.service.ts` 註冊邏輯、
  `models/plugin.model.ts`），HMAC 規格 `src/utils/hmac.ts`，JWT 簽發中心
  `src/modules/web-core/jwt.service.ts`。
- plugin 端：[`karyl-chan-plugins`](https://github.com/0Miles/karyl-chan-plugins) —
  `packages/sdk/`（SDK + manifest builder + HMAC + `verifyPluginSession`），
  `packages/utility` / `packages/radio`（範例）。
