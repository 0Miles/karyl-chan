# Loop Session 2026-04-29 — 戰果摘要

> 起點:Tier 1 fixes 寫好但未驗證,Tier 2-5 規劃中
> 終點:Tier 1-5 全部交付,3 個範例 plugin 線上跑、admin server 頁
> 重整完成、defects report 完成、5 項額外健壯性修補
>
> 共 8 個 commit,跨 karyl-chan / accounting-plugin / messaging-plugin。

## Tier 1 — Behavior 系統收尾

`6f9dd90 fix(behaviors): tighten plugin/system/slash_command boundaries`

- `ensureSystemLoginBehavior` 現在用 `encryptSecret()` 加密 `system://admin-login`
  placeholder,避免 decryptedView callers 對唯一一個明文 row 噴錯。
- `collectApplicableBehaviors` 把 `type='system'` rows 提到清單前面 ——
  admin 編 user-target 規則撞 triggerValue 不會蓋掉 system flow。
- `assertNoCollisions` reject 跟 bot 內建指令撞名的 plugin 指令。
- POST/PATCH `/api/behaviors` reject `type='plugin' × triggerType='slash_command'`
  的死組合(plugin slash 指令走 manifest.commands,不走 behaviors)。
- BehaviorCard.vue 對 `slash_command` 在 `type=plugin` 時隱藏 + 自動
  矯正觸發類型;後端再 reject 一次當作雙保險。
- Plugin reaper 過期 plugin 後 rebuild event subscription index,
  避免事件繼續派送到死掉的 plugin。

## Tier 2 — accounting-plugin (記帳)

`16094c7 feat(plugin): contexts + integration_types in command manifest`
+ accounting-plugin 0.1.0 init commit

`/account` slash command 提供四個子指令:`add` / `list` / `balance` /
`remove`。Bot 端先擴充 manifest 接受 `contexts` (Guild|BotDM|PrivateChannel)
與 `integration_types` (guild_install|user_install) 兩個欄位,plugin 端
才有辦法宣告 DM 也能用的指令。

資料用 bot 的 `storage.kv_*` RPC 持久化,key 是 user_id 當 bucket
(每 user 64KB 配額)。架構限制(KV 不支援 user-bucket type)記在
defects report 第 D1 條。

實機驗證:simulated dispatch 三筆 add 都正確寫入 plugin_kv,counter
+ entries 都對。

## Tier 3 — messaging-plugin (傳話)

`198a0d5 feat(plugin): messages.send_dm RPC` + messaging-plugin 0.1.0 init

新增 RPC `messages.send_dm({user_id, content})` 解決原本「plugin 拿到
user id 但沒辦法用 messages.send 因為沒有 DM channel id」的 bug。
然後 messaging-plugin 用它 + messages.send 提供 `/relay user`(DM)
與 `/relay channel`(post 進 guild 頻道)兩條指令。

權限模型:fail-closed allowlist,`RELAY_ALLOWED_USER_IDS` env 留空 =
所有 /relay 都 reject。Plugin guide 中標註 `default_member_permissions:
"MANAGE_GUILD"` 仍是文字未翻譯,後續 S3 fix 已補。

## Tier 4 — Server 頁重整

`7d78c87 feat(guilds): all-servers dashboard + plugin feature toggles`

後端
- 新表 `plugin_feature_defaults(pluginId, featureKey, enabled)` 存
  operator-level 預設覆寫(蓋掉 manifest 的 `enabled_by_default`)。
- 新 endpoints:`GET /api/plugins/feature-defaults`、
  `PUT /api/plugins/:id/feature-defaults/:featureKey`、
  `POST /api/plugins/:id/feature-defaults/:featureKey/apply-to-all`。
  apply-to-all 會 enumerate bot 在的所有 guild,upsert 對應的
  `plugin_guild_features` row,把它們的 enabled 全部設成
  `effectiveDefault`(override 優先,否則 manifest default)。
- registerPluginRoutes 接受 Discord client 才能拿 guilds.cache。

前端
- 伺服器 sidebar 第一條固定 「所有伺服器」(id="_all"),選中時改
  渲染 `AllServersDashboard.vue` 而非單一 guild detail。
- AllServersDashboard 依 plugin 群組顯示 features:manifest default、
  override、effective default、已啟用/已停用 guild 數量;toggle
  override + 「套用到所有伺服器」按鈕。
- 既有 guild 的 `features` 子分頁加新 sub-tab 「Plugin Features」,
  渲染 `GuildPluginFeaturesPanel.vue`,提供該 guild plugin features
  的 per-guild on/off toggle。

未做(documented as defect R4):per-guild slash command resync。
Plugin commands 目前全部 global scope,toggle 一個 guild feature
不會改該 guild 看不看得到指令。要修需把 plugin command 改 guild
scope per-feature 派送,屬於下一個 sprint。

## Tier 5 — Defects report + 額外健壯性

`bd4e3f2 docs(plugin): architecture review + improvement plan`

`docs/development/plugin-architecture-review.md` 寫了 21 條 defects
分類在 6 個面向(安全 / 儲存 / 派送 / namespace / Admin UI / 生命週期 /
Schema)以三級嚴重度標記,並建議了 5 個 sprint 的 priority。

額外修了三條安全的:

`19e3254 fix(plugin): translate default_member_permissions + auto-detect reserved names`

- **S3** 後續修 `4a7fa78`:`default_member_permissions` 字串現在會被
  翻譯成 bigint string 並真的傳給 Discord(同時接受
  `"MANAGE_GUILD"` 與 `"ManageGuild"` 兩種大小寫)。`/relay` 現在
  Discord-side 真的會被 perms 過濾(實測 perms=32)。
- **N1** RESERVED_COMMAND_NAMES 改成動態:讀
  `bot.application.commands.cache` + 各 guild commands cache,以該 plugin
  自己的 commands 為例外。In-process discordx 命令撞名自動擋下,
  不需要手動維護白名單。

## 線上狀態

```
karyl-chan        → healthy (port 902)
echo-webhook      → healthy
accounting-plugin → healthy (registered as id 2)
messaging-plugin  → healthy (registered as id 3)
```

Discord 全域指令清單:`manual / break / login / account / relay`,
皆 contexts=[0,1,2] integration_types=[0,1]。`relay` 的 Discord-side
defaultMemberPermissions=32(MANAGE_GUILD)。

## 給 Miles 的 TL;DR

1. Plugin 架構成熟到能寫實用 plugin。記帳 / 傳話兩個範例都跑起來了,
   manifest 規格涵蓋 events / dm_behaviors / commands / config_schema /
   guild_features 五個面向。
2. Server 頁有了「所有伺服器」總覽 + plugin features 的預設+套用流程。
3. **下個 sprint 的優先序在** `plugin-architecture-review.md`,五級
   sprint 拆好了:Sprint A 安全(per-plugin sign key 等)、Sprint B
   DX(config 表單 / metrics)、Sprint C 健壯性(metrics / rate limit /
   per-guild dispatch reject)、Sprint D 儲存升級(multi-bucket KV)、
   Sprint E 互動補完(button/modal routing)。
4. 你回來時 docker 全跑著,可以直接驗。

— Loop ended at 04:32 CST 2026-04-29.

---

## 後續 autonomous wakeups (04:32 → 07:57)

> 用戶回來前的 4 個 wakeups,做的都是「不會改壞功能的健壯性 / 可維護性
> 提升」,不開新功能。

### 健壯性 fix

- `51f6564` plugin event-dispatch 失敗 log 加 `shouldRecord` dedup
  per (pluginId, eventType, failure-class) 一分鐘一次。Plugin 連續
  500 不會再炸 bot_event_log 一秒一條。
- `7c160ac` / `8ee2757` (accounting) 新 RPC `storage.kv_increment`
  with per-key in-process promise mutex。Accounting plugin 的
  `nextId()` 已換用,實測 10 個並發 add 都拿到不同 id。文件 D2 已
  標記為 fixed 並記下「不要走回頭路用 IMMEDIATE transaction,因為
  :memory: SQLite 跑不過」的踩坑紀錄(`80d3a30` / `bb59673`)。

### 測試擴增 (314 → 331 cases)

- `199f8ab` 新 `tests/plugin-kv.test.ts` 6 case 覆蓋 incrementKv,
  含 10-way race regression。**順便修 2 個既有測試 bit-rot**:
  - `tests/permission.test.ts` import 已被 `f635664` 刪除的檔案,
    刪除整個檔案。
  - `tests/web-server.test.ts` 兩個 auth-gate case 打的是
    `/api/health`,但 `5183a8b` 把 health whitelist 掉了 → 401
    變 200。改打 `/api/dm/channels`。
- `6fe1cfa` 新 `tests/plugin-feature-default.test.ts` 7 case 蓋
  Tier 4 的 operator-override 表。
- `3d85117` 新 `tests/plugin-guild-feature.test.ts` 8 case 蓋 per-
  guild plugin feature row CRUD。

CI(`.github/workflows/docker-publish.yml`)會跑 `npm run build` +
`npm run test:typecheck` + `npm test`,目前三項都綠 → merge 到 main
不會被 CI 擋。

### 整體狀態 (07:57)

```
karyl-chan        → 2h up, healthy (port 902)
echo-webhook      → 5h up, healthy
accounting-plugin → 3h up, healthy (atomic counter version)
messaging-plugin  → 4h up, healthy

最近 50 分鐘 bot 0 個 warn/error。
總提交數 (since Tier 1 base 4978a11):20 commits。
測試:331/331 通過。
```

— Loop autonomous phase ended at 07:57 CST. 下一個 wakeup 排在 08:48,
   接近你 9:00 回來的時間就停。
