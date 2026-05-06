# M1 完成總結 — karyl-chan 指令架構 v2 重構

> **狀態**：M1 全階段完成，已 commit + docker healthy。等用戶 review 後決定 merge 策略。
> **完成時間**：2026-05-07
> **主 branch**：`chore/m1-a1-cleanup`（基於 origin/main，10 commits）
> **Plugin repo branch**：`refactor/merge-stateless-plugins`（2 個新 commits）

---

## 0. 重構成果

把舊版混雜的指令註冊路徑（in-process / plugin manifest 三層 / dm-slash-rebind hack / behaviors 表 DM-only）整成三軌：

| 軌 | 新狀態 |
|---|---|
| **軌一：Guild Feature** | 完全保留（內建 5 個 + plugin manifest `guild_features[]`，per-guild on/off 機制不動）|
| **軌二：Behaviors** | webhook 接口層；source ∈ {custom, plugin, system}，trigger ∈ {slash_command, message_pattern}，三軸 admin 可控 |
| **軌三：Plugin 自訂指令** | plugin manifest 鎖三軸，admin 只能 on/off |

統一的 `CommandReconciler` 接管軌二+軌三 Discord 指令登記，舊四檔 dispatcher（dm-slash-rebind / user-slash-behavior / system-behavior / webhook-behavior.events）退場。

---

## 1. Commit Chain（10 + 2 個 commit）

### karyl-chan（branch `chore/m1-a1-cleanup`）

從舊到新（origin/main → HEAD）：

| commit | 階段 | 內容 |
|---|---|---|
| `f870b2e` | M1-A1 | behaviors v2 破壞性遷移（無 backfill，無 archive，無 legacyId）|
| `d536751` | M1-A1 cleanup | 刪 3 孤兒檔 + main.ts 9 dead imports + behavior.model.ts deprecated types（淨刪 731 行）|
| `d5f08a0` | M1-A2 + A3 | plugin_commands 三軸擴 8 欄 + reconciler_owned_commands 名冊表 |
| `e66aa87` | M1-B（bot 端） | validateManifest v2：V-01~V-10 + V-C1/C2/C3 + CR-4 behaviors 防撞 |
| `7502d13` | M1-C1 | command-system 4 模組骨架（reconcile / dispatcher / matcher / forwarder，dormant）|
| `45b0afb` | M1-C2 | 退場 v1 dispatcher + main.ts 接線 command-system 模組 |
| `72424c2` | M1-D1 | admin/behaviors 頁 v2 重構（REST + audience 側欄 + AddBehaviorModal + webhookAuthMode UI）|
| `80db6ef` | M1-D2 | plugin 詳情頁（6 tab 獨立 route + 軌三指令 toggle + read-only behaviors 展示）|
| `03cb9fc` | M1-D2 fix | 移除 PluginDetailBehaviors template 中 vue-tsc 不支援的 type assertion |
| `4781cb4` | M1-E（主 repo） | plugin v1→v2 migration guide |

### karyl-chan-plugins（branch `refactor/merge-stateless-plugins`）

| commit | 階段 | 內容 |
|---|---|---|
| `8a12f8b` | M1-B（SDK） | Plugin SDK v2：definePluginCommand / defineBehavior / PluginConfigV2 + webhook-token timing-safe |
| `68677ef` | M1-E（plugins） | utility (15 commands) + radio (1 command) 升級至 v2 manifest（schema_version=2 + 三軸）|

---

## 2. 範圍對比（M0 規劃 vs M1 實作）

### M1-A 簡化（用戶決議「無視 v1 資料破壞性遷移」）

| M0 原規劃 7 檔 migration | M1 實作 |
|---|---|
| M1-A1: behaviors rebuild + 4 case backfill + legacyId | **簡化**：DROP + CREATE 三表（behaviors / behavior_audience_members / behavior_sessions）|
| M1-A2: behavior_audience_members | **併入 M1-A1** |
| M1-A3: sessions relink | **併入 M1-A1** |
| M1-A4: archive legacy targets | **不需要**（破壞性 DROP）|
| M1-A5: plugin_commands 擴 8 欄 | **保留** → 重編號為 M1-A2 |
| M1-A6: reconciler_owned_commands | **保留** → 重編號為 M1-A3 |
| M1-A7: DROP legacyId | **不需要**（沒 legacyId）|

實際 M1-A 共 3 個 migration（M1-A1 + 重編號 A2 + A3）。

### 7 個 critic + db-expert 雙審 finding 修補狀況

| 階段 | finding 處理 |
|---|---|
| M1-A1 一審 | 5 CRITICAL + 6 HIGH 全綠（透過 `f870b2e` 重做版 + `d536751` cleanup）|
| M1-A1 二審 | 3 CRITICAL + 6 HIGH（`a961...` agent 修補）+ 4 條新 critical（model 同步、slashCommandName 髒資料、SQLite FK auto-update、中段 session 對不上）→ 用戶決議簡化遷移路線 |
| M1-A2 雙審 | 5 CRITICAL = 0；7 HIGH 透過 `e66aa87` 之前的補強（agent 自修）落地 |

---

## 3. 驗證狀態（最後一輪 docker rebuild）

| 檢查項 | 結果 |
|---|---|
| TypeScript build（karyl-chan） | ✅ 通過（3 個預存錯誤跟 v2 重構無關）|
| TypeScript build（karyl-chan-plugins） | ✅ pnpm build 通過 |
| Migration 跑通 | ✅ 3 條全跑（M1-A1 0.072s, M1-A2 0.076s, M1-A3 0.057s）|
| Bot boot | ✅ healthy in <15s |
| `commandReconciler.reconcileAll()` | ✅ 跑通（清除 dm-slash-rebind 殘留 /login /break /manual）|
| `messageMatcher.register()` | ✅ messageCreate listener 掛載 |
| Plugin register（utility） | ✅ 200 OK，botPluginId=8 |
| Plugin register（radio） | ✅ 200 OK，botPluginId=4 |
| 軌一 plugin（utility/radio）heartbeat | ✅ 200 OK 持續 |
| Discord 指令清理 | ✅ v1 殘留 /login /break /manual 已從 Discord global 清除 |

---

## 4. 退場與保留

### 已刪除檔案（4 個）

- `src/modules/behavior/dm-slash-rebind.service.ts`
- `src/modules/behavior/user-slash-behavior.service.ts`
- `src/modules/behavior/system-behavior.service.ts`
- `src/modules/behavior/events/webhook-behavior.events.ts`

### 已退場檔案（3 個孤兒，cleanup 階段刪）

- `src/modules/behavior/target-routes.ts`
- `src/modules/behavior/group-member-routes.ts`
- `src/modules/plugin-system/plugin-dispatch.service.ts`

### 軌一不變區（M0-FROZEN §8 承諾）

全部未動：
- `src/modules/builtin-features/`（in-process registry + 5 個內建 feature）
- `src/modules/plugin-system/plugin-command-registry.service.ts:374-513`（per-feature 半部）
- `bot_feature_state` / `plugin_guild_features` / `plugins` / `plugin_kv` / `plugin_configs` 表
- `frontend/src/views/admin/guilds/GuildBotFeaturesPanel.vue`

---

## 5. 推遲到 M2 的項目（已知 OQ）

| OQ | 內容 | 推遲理由 |
|---|---|---|
| OQ-11 | plugin behavior 在詳情頁 toggle | 需要 `plugin_behavior_overrides(pluginId, behaviorKey, enabled)` 新表，M1 範圍未含。M1-D2 顯示 read-only placeholder + banner |
| OQ-7 | continuous session DB-side `expiresAt` 過期機制 | M2+ 增量 |
| OQ-3 | `slashHints.options[]` 是否支援 sub_command | sub_command 是 M2+ 範圍 |
| OQ-8 | `scope=guild` 軌二 behavior 在 guildCreate 時的增量 register | M1-C 已實作 reconcileAll，但 guildCreate 增量 reconcile 未做 |
| `plugin-command-registry` global 半部 → DB-only | M1-C2 改為 DB-only upsert（`discordCommandId=null`），實際 Discord 登記由 `CommandReconciler` 名冊機制接管。`unregisterAll` Discord 刪除依賴名冊，標 TODO M1-D/F | 短期可運作，長期需重構 |

---

## 6. UI 視覺驗證未跑

M1-D1 / M1-D2 完成後沒跑 Playwright 視覺驗證（無 Claude in Chrome / Playwright MCP 工具）。建議用戶 review：

- `/admin/behaviors`：audience 側欄、三 source 色條、AddBehaviorModal 兩步驟 wizard、webhookAuthMode mode select
- `/admin/plugins/:pluginKey`：6 tab 切換、軌三指令 on/off toggle、軌二 behaviors read-only placeholder

---

## 7. Branch 狀態與 merge 建議

### karyl-chan
- `local main` → `f870b2e` ←─ M1-A1 主 commit（agent 越權 commit 在 main 上）
- `chore/m1-a1-cleanup` → `4781cb4` ←─ HEAD，含 10 個 commit
- `origin/main` → `f8f4c0b` ←─ 上次推送

### karyl-chan-plugins
- `refactor/merge-stateless-plugins` ←─ 含 SDK v2 (`8a12f8b`) + plugin v2 升級 (`68677ef`)

### Merge 策略選項

1. **推 PR review 路線**（推薦）：
   - `chore/m1-a1-cleanup` 推 origin → 開 PR
   - PR 內含 10 個 commit，可 squash 也可保留
   - 兩 repo 各自 PR
2. **直接 push**：`git push origin chore/m1-a1-cleanup:main`（兩 repo 各自）
3. **拆細 PR**：把 M1-A / M1-B / M1-C / M1-D / M1-E 各自開 PR ── 工作量大、較不推薦

---

## 8. 已知技術債（非阻擋但建議追蹤）

- `behavior_target_routes.ts` / `group-member-routes.ts`（v1 routes）已刪，`v1 target API client` 在 frontend `behavior.ts` 仍保留以支援 sidebar audience 切換 ── M2 統一 audience model 後可清
- `behavior-helpers.ts` / `behavior-trigger.ts` / `webhook-dispatch.service.ts` 仍保留（HMAC helpers + sentinel const 仍被新 `webhook-forwarder` 使用）── 可能 M2 拆 helpers 到 command-system 內
- `system-behavior.service.ts` 已刪，但 `interaction-dispatcher` 內 system 分支的 admin-login / break 直接呼叫 helper（`issueLoginLinkForInteraction` / `endSession`）── 結構乾淨
- 軌三 `plugin_commands.discordCommandId` 在 M1-C2 後改為 `null`（global 半部移交 CommandReconciler）── reconciler 名冊維護 Discord 端登記，舊 `unregisterAll` 路徑需要適配 ── M2 整合確認

---

## 9. 用戶 review checklist

請依此清單檢視：

- [ ] git log 比對：commit chain 是否合理可讀
- [ ] `/admin/behaviors`：UI 視覺驗證（audience 側欄、三 source 色條、AddBehaviorModal）
- [ ] `/admin/plugins/:pluginKey`：UI 視覺驗證（6 tab、指令 toggle）
- [ ] Discord 端：utility / radio plugin 指令是否出現在期待 surface（utility 全通路、radio 只 guild）
- [ ] 既有功能：guild_features per-guild on/off（軌一）是否正常
- [ ] migration up/down dry run（如要嚴格驗證）
- [ ] PR / merge 策略決定

---

## 10. Migration Guide

`/home/miles/workspace/karyl-chan/docs/command-system-v2/m1/plugin-v2-migration-guide.md`

第三方 plugin 作者升級到 v2 SDK 的 7 步驟 + before/after 範例 + 欄位對照附錄。

---

**M1 重構完成。等用戶 review。**
