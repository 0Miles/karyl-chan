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
- **事件** — manifest `events_subscribed` 宣告要收哪些；bot fan-out 到
  plugin 的 `/events`。

## Plugin → Bot RPC

`POST /api/plugin/<method>`，`Authorization: Bearer <token>`，body 是 JSON。
能呼叫哪些 method 由 manifest 的 `rpcMethodsUsed` 決定（bot 簽 token 時把它
當作 scope allowlist；新增的 scope 要 admin 核准，除非 `PLUGIN_AUTO_APPROVE_SCOPES`）。
常見：`interactions.respond` / `interactions.followup` / `messages.send_dm` /
`voice.*` / `auth.session` / KV 存取等 —— 完整清單看 bot 端
`src/modules/plugin-system/plugin-rpc-routes.ts`，SDK 端 `ctx.botRpc(path, body)`。

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

## 部署

每個 plugin 是一個 docker service，掛在 bot 建立的 `karyl-chan-net`
external network 上，環境變數至少要 `BOT_URL`（預設 `http://karyl-chan:3000`）、
`PLUGIN_URL`（bot 派 dispatch 用，預設容器主機名）、`KARYL_PLUGIN_SETUP_SECRET`。
官方 plugin 的 `docker-compose.yml` 在 `karyl-chan-plugins` repo 根目錄。

## 相關檔案

- bot 端：`src/modules/plugin-system/`（`plugin-routes.ts` register/heartbeat、
  `plugin-interaction-dispatch.service.ts` 指令派送、`plugin-event-bridge.service.ts`
  事件派送、`plugin-rpc-routes.ts` RPC、`plugin-registry.service.ts` 註冊邏輯、
  `models/plugin.model.ts`），HMAC 規格 `src/utils/hmac.ts`，JWT 簽發中心
  `src/modules/web-core/jwt.service.ts`。
- plugin 端：[`karyl-chan-plugins`](https://github.com/0Miles/karyl-chan-plugins) —
  `packages/sdk/`（SDK + manifest builder + HMAC + `verifyPluginSession`），
  `packages/utility` / `packages/radio`（範例）。
