import { QueryTypes } from "sequelize";
import type { Migration } from "./runner.js";

/**
 * M1-A2 — plugin_commands 三軸擴欄 + manifest backfill（指令架構 v2）
 *
 * 策略：ADD COLUMN × 8（SQLite 允許 ADD COLUMN，不需要 rebuild）。
 *   backfill 由 JS 程式碼從 plugins.manifestJson 解析後 UPDATE。
 *   down 走 rebuild table pattern（對稱 drop all 8 columns，保相容性）。
 *
 * 新增欄位（8 個）：
 *   description              TEXT NULL  → backfill 後 fallback to name
 *   adminEnabled             INTEGER NOT NULL DEFAULT 1
 *   scope                    TEXT NULL  → backfill 後填 'guild'/'global'
 *   integrationTypes         TEXT NULL  → comma-joined, lexicographically sorted + deduped
 *   contexts                 TEXT NULL  → comma-joined, lexicographically sorted + deduped
 *   defaultMemberPermissions TEXT NULL
 *   defaultEphemeral         INTEGER NULL
 *   requiredCapability       TEXT NULL
 *
 * backfill case 8（A-schema §3 case 8 + H-8 修正）：
 *   軌一 row（featureKey IS NOT NULL）：
 *     manifest.guild_features[?].commands[?] 找 name 對應
 *     scope = cmd.scope ?? 'guild'
 *   軌三 row（featureKey IS NULL）：
 *     manifest.commands[?] 找 name 對應
 *     scope = cmd.scope ?? (row.guildId ? 'guild' : 'global')
 *   共同欄位：
 *     description          = cmd.description ?? row.name（fallback 防空字串）
 *     integrationTypes     = sortJoin(cmd.integration_types ?? ['guild_install'])
 *     contexts             = sortJoin(cmd.contexts ?? ['Guild'])
 *     defaultMemberPermissions = cmd.default_member_permissions ?? null
 *     defaultEphemeral     = cmd.default_ephemeral ? 1 : 0
 *     requiredCapability   = cmd.required_capability ?? null
 *     adminEnabled         = 1（既有 row 視為啟用）
 *
 * 預檢（均為 fatal throw，需手動清理 dirty data 後重跑）：
 *   - orphan rows：pluginId 在 plugins 表找不到 → orphanIds
 *   - manifest parse 失敗：manifestJson 無法解析 → parseFailedPlugins
 *   - manifest 找不到對應 name 的 command → missingIds
 *   - 軌一衝突：integration_types 含 'user_install' 但 manifest 未指定 scope → inconsistentIds
 *   - 軌三衝突：cmd.scope 與 row.guildId 推導出的 scope 不一致 → inconsistentIds
 * 索引：plugin_commands_admin_enabled_idx ON plugin_commands(pluginId, adminEnabled)
 */

// ── manifest 型別（v1/v2 共用，backfill 只讀欄位）──────────────────────

interface ManifestCommand {
  name: string;
  description?: string;
  scope?: string;
  integration_types?: string[];
  contexts?: string[];
  default_member_permissions?: string | null;
  default_ephemeral?: boolean;
  required_capability?: string | null;
}

interface ManifestGuildFeature {
  key: string;
  commands?: ManifestCommand[];
}

interface PluginManifest {
  commands?: ManifestCommand[];
  guild_features?: ManifestGuildFeature[];
}

// ── helper ────────────────────────────────────────────────────────────────

/** sort + dedup，對應 M0-FROZEN §1.4 */
function sortJoin(arr: string[]): string {
  return [...new Set(arr)].sort().join(",");
}

// ── DB row 型別 ──────────────────────────────────────────────────────────

interface PluginCommandRow {
  id: number;
  pluginId: number;
  guildId: string | null;
  name: string;
  featureKey: string | null;
}

interface PluginRow {
  id: number;
  manifestJson: string;
}

interface BackfillValues {
  id: number;
  description: string;
  scope: string;
  integrationTypes: string;
  contexts: string;
  defaultMemberPermissions: string | null;
  defaultEphemeral: number;
  requiredCapability: string | null;
}

// ── migration ─────────────────────────────────────────────────────────────

const migration: Migration = {
  up: async ({ queryInterface }) => {
    // 整個 up body（ADD COLUMN + backfill + CREATE INDEX）包進單一 transaction。
    // SQLite ALTER TABLE 是 atomic，DDL 可包在 explicit transaction 中。
    await queryInterface.sequelize.transaction(async (t) => {
      // ── Step 1：ADD COLUMN × 8 ────────────────────────────────────────
      // 每欄用 describeTable 預檢，確保冪等（重跑安全）
      const table = await queryInterface.describeTable("plugin_commands");

      const columnsToAdd: Array<{ name: string; ddl: string }> = [
        {
          name: "description",
          ddl: "ALTER TABLE plugin_commands ADD COLUMN description              TEXT    NULL;",
        },
        {
          name: "adminEnabled",
          ddl: "ALTER TABLE plugin_commands ADD COLUMN adminEnabled             INTEGER NOT NULL DEFAULT 1;",
        },
        {
          name: "scope",
          ddl: "ALTER TABLE plugin_commands ADD COLUMN scope                    TEXT    NULL;",
        },
        {
          name: "integrationTypes",
          ddl: "ALTER TABLE plugin_commands ADD COLUMN integrationTypes         TEXT    NULL;",
        },
        {
          name: "contexts",
          ddl: "ALTER TABLE plugin_commands ADD COLUMN contexts                 TEXT    NULL;",
        },
        {
          name: "defaultMemberPermissions",
          ddl: "ALTER TABLE plugin_commands ADD COLUMN defaultMemberPermissions TEXT    NULL;",
        },
        {
          name: "defaultEphemeral",
          ddl: "ALTER TABLE plugin_commands ADD COLUMN defaultEphemeral         INTEGER NULL;",
        },
        {
          name: "requiredCapability",
          ddl: "ALTER TABLE plugin_commands ADD COLUMN requiredCapability       TEXT    NULL;",
        },
      ];

      for (const col of columnsToAdd) {
        if (!(col.name in table)) {
          await queryInterface.sequelize.query(col.ddl, { transaction: t });
        }
      }

      // ── Step 2：backfill（JS 解析 manifest → UPDATE plugin_commands）──
      // 取全部 plugin_commands row（包含 pluginId、name、featureKey、guildId）
      const cmdRows = (await queryInterface.sequelize.query(
        `SELECT id, pluginId, guildId, name, featureKey FROM plugin_commands;`,
        { transaction: t, type: QueryTypes.SELECT },
      )) as PluginCommandRow[];

      if (cmdRows.length === 0) {
        // 空表，無需 backfill；CREATE INDEX 仍需在 Step 3 執行
      } else {
        // 取所有有用到的 plugin（去重）
        const pluginIds = [...new Set(cmdRows.map((r) => r.pluginId))];
        const pluginRows = (await queryInterface.sequelize.query(
          `SELECT id, manifestJson FROM plugins WHERE id IN (${pluginIds.map(() => "?").join(",")});`,
          { transaction: t, type: QueryTypes.SELECT, replacements: pluginIds },
        )) as PluginRow[];

        // 建立 pluginId → manifest 的映射；parse 失敗全部累積後一起 throw
        const manifestByPluginId = new Map<number, PluginManifest>();
        /** 累積 JSON.parse 失敗的 plugin（批次列出，admin 一次修齊再重跑） */
        const parseFailedPlugins: Array<{ id: number; message: string }> = [];
        for (const pluginRow of pluginRows) {
          try {
            const manifest = JSON.parse(
              pluginRow.manifestJson,
            ) as PluginManifest;
            manifestByPluginId.set(pluginRow.id, manifest);
          } catch (e) {
            parseFailedPlugins.push({
              id: pluginRow.id,
              message: e instanceof Error ? e.message : String(e),
            });
          }
        }

        // 預檢各類錯誤；全部累積後一次 throw，避免 admin 修一個重跑又看到下一個
        /** orphan rows：pluginId 在 plugins 表找不到 */
        const orphanIds: Array<{ id: number; pluginId: number }> = [];
        /** manifest 內找不到對應 name 的 command */
        const missingIds: number[] = [];
        /**
         * 衝突 row：
         *   軌一：integration_types 含 'user_install' 但 manifest 未指定 scope
         *         （推導出 scope='guild' + integrationTypes 含 'user_install'，違反 M0-FROZEN R-1）
         *   軌三：cmd.scope 與 guildId 推導出的 scope 不一致
         *         （scope='global' + guildId IS NOT NULL 或 scope='guild' + guildId IS NULL，違反 invariant）
         */
        const inconsistentIds: Array<{ id: number; reason: string }> = [];
        const updates: BackfillValues[] = [];

        for (const row of cmdRows) {
          const manifest = manifestByPluginId.get(row.pluginId);
          if (!manifest) {
            // plugins 表找不到對應 pluginId（orphan row）→ fatal，統一 throw
            orphanIds.push({ id: row.id, pluginId: row.pluginId });
            continue;
          }

          let cmd: ManifestCommand | undefined;

          if (row.featureKey !== null) {
            // 軌一 row：從 guild_features[featureKey].commands 找
            const feat = manifest.guild_features?.find(
              (f) => f.key === row.featureKey,
            );
            if (!feat) {
              missingIds.push(row.id);
              continue;
            }
            cmd = feat.commands?.find((c) => c.name === row.name);
          } else {
            // 軌三 row：從 manifest.commands 找
            cmd = manifest.commands?.find((c) => c.name === row.name);
          }

          if (!cmd) {
            missingIds.push(row.id);
            continue;
          }

          // scope 推導（H-8 修：從 manifest 讀，缺省回退）
          let scope: string;
          if (row.featureKey !== null) {
            // 軌一
            scope = cmd.scope ?? "guild";
            // 衝突預檢：integration_types 含 'user_install' 但 manifest 未指定 scope
            // → 推出 scope='guild' + integrationTypes 含 'user_install'，違反 M0-FROZEN R-1 / C-runtime §3.3
            if (cmd.integration_types?.includes("user_install") && !cmd.scope) {
              inconsistentIds.push({
                id: row.id,
                reason:
                  `軌一 row：integration_types 含 'user_install' 但 manifest 未指定 scope，` +
                  `將推導為 scope='guild'，違反 M0-FROZEN R-1。請在 manifest 明確指定 scope。`,
              });
              continue;
            }
          } else {
            // 軌三
            const derivedScope = row.guildId !== null ? "guild" : "global";
            scope = cmd.scope ?? derivedScope;
            // 衝突預檢：cmd.scope 與 guildId 推導出的 scope 不一致
            // → 違反 invariant「scope=guild ↔ guildId IS NOT NULL」
            if (cmd.scope && cmd.scope !== derivedScope) {
              inconsistentIds.push({
                id: row.id,
                reason:
                  `軌三 row：manifest cmd.scope='${cmd.scope}' 與 guildId 推導 scope='${derivedScope}' 不一致，` +
                  `違反 invariant（scope=guild ↔ guildId IS NOT NULL）。請清理歷史殘留資料。`,
              });
              continue;
            }
          }

          const description =
            cmd.description !== undefined && cmd.description.trim() !== ""
              ? cmd.description
              : row.name; // fallback to name 防空字串

          const integrationTypes = sortJoin(
            cmd.integration_types ?? ["guild_install"],
          );
          const contexts = sortJoin(cmd.contexts ?? ["Guild"]);
          const defaultMemberPermissions =
            cmd.default_member_permissions ?? null;
          const defaultEphemeral: number =
            cmd.default_ephemeral === true ? 1 : 0;
          const requiredCapability = cmd.required_capability ?? null;

          updates.push({
            id: row.id,
            description,
            scope,
            integrationTypes,
            contexts,
            defaultMemberPermissions,
            defaultEphemeral,
            requiredCapability,
          });
        }

        // 若有任何預檢錯誤，一次全部列出，迫使 admin 清理 dirty data 後重跑
        if (
          orphanIds.length > 0 ||
          parseFailedPlugins.length > 0 ||
          missingIds.length > 0 ||
          inconsistentIds.length > 0
        ) {
          const lines: string[] = [
            "[M1-A2] backfill 預檢失敗，請清理後重跑 migration：",
          ];
          if (orphanIds.length > 0) {
            lines.push(
              `  orphan rows（pluginId 在 plugins 表找不到）：` +
                orphanIds
                  .map((r) => `id=${r.id} pluginId=${r.pluginId}`)
                  .join(", "),
            );
          }
          if (parseFailedPlugins.length > 0) {
            lines.push(
              `  manifest JSON 解析失敗的 plugin：` +
                parseFailedPlugins
                  .map((p) => `id=${p.id} (${p.message})`)
                  .join("; "),
            );
          }
          if (missingIds.length > 0) {
            lines.push(
              `  manifest 找不到對應 command 的 plugin_commands：id=[${missingIds.join(", ")}]`,
            );
          }
          if (inconsistentIds.length > 0) {
            lines.push(`  scope 衝突的 plugin_commands：`);
            for (const inc of inconsistentIds) {
              lines.push(`    id=${inc.id}：${inc.reason}`);
            }
          }
          throw new Error(lines.join("\n"));
        }

        // 批次 UPDATE（每 row 一條 SQL，SQLite 沒有原生 batch update）
        for (const u of updates) {
          await queryInterface.sequelize.query(
            `UPDATE plugin_commands
                SET description              = ?,
                    scope                    = ?,
                    integrationTypes         = ?,
                    contexts                 = ?,
                    defaultMemberPermissions = ?,
                    defaultEphemeral         = ?,
                    requiredCapability       = ?,
                    adminEnabled             = 1
              WHERE id = ?;`,
            {
              transaction: t,
              replacements: [
                u.description,
                u.scope,
                u.integrationTypes,
                u.contexts,
                u.defaultMemberPermissions,
                u.defaultEphemeral,
                u.requiredCapability,
                u.id,
              ],
            },
          );
        }
      }

      // ── Step 3：加索引 ──────────────────────────────────────────────────
      await queryInterface.sequelize.query(
        `CREATE INDEX IF NOT EXISTS plugin_commands_admin_enabled_idx
             ON plugin_commands(pluginId, adminEnabled);`,
        { transaction: t },
      );
    }); // end transaction
  },

  down: async ({ queryInterface }) => {
    // down：SQLite rebuild table pattern — 只保留 v1 欄位
    // PRAGMA foreign_keys 在 transaction 外切換（SQLite 規範要求）
    // try/finally 確保即使 rebuild 中途失敗，foreign_keys 也一定恢復 ON
    await queryInterface.sequelize.query(`PRAGMA foreign_keys = OFF;`);
    try {
      await queryInterface.sequelize.transaction(async (t) => {
        // Step 1：移除新增索引
        await queryInterface.sequelize.query(
          `DROP INDEX IF EXISTS plugin_commands_admin_enabled_idx;`,
          { transaction: t },
        );

        // Step 2：rebuild table（拿掉 8 個新欄位）
        // 先建 rollback 表（只含 v1 欄位）
        await queryInterface.sequelize.query(
          `CREATE TABLE plugin_commands_rollback (
              id               INTEGER  PRIMARY KEY AUTOINCREMENT,
              pluginId         INTEGER  NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
              guildId          TEXT     NULL,
              name             TEXT     NOT NULL,
              discordCommandId TEXT     NULL,
              featureKey       TEXT     NULL,
              manifestJson     TEXT     NOT NULL,
              createdAt        DATETIME NOT NULL,
              updatedAt        DATETIME NOT NULL
          );`,
          { transaction: t },
        );

        // 複製 v1 欄位資料
        await queryInterface.sequelize.query(
          `INSERT INTO plugin_commands_rollback
               (id, pluginId, guildId, name, discordCommandId, featureKey, manifestJson, createdAt, updatedAt)
           SELECT id, pluginId, guildId, name, discordCommandId, featureKey, manifestJson, createdAt, updatedAt
             FROM plugin_commands;`,
          { transaction: t },
        );

        // 刪舊表、改名
        await queryInterface.sequelize.query(`DROP TABLE plugin_commands;`, {
          transaction: t,
        });
        await queryInterface.sequelize.query(
          `ALTER TABLE plugin_commands_rollback RENAME TO plugin_commands;`,
          { transaction: t },
        );

        // 重建 v1 索引（來自原始 20260429030000-plugin-commands.ts）
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS plugin_commands_unique
               ON plugin_commands(pluginId, guildId, name);`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE INDEX IF NOT EXISTS plugin_commands_lookup
               ON plugin_commands(name, guildId);`,
          { transaction: t },
        );
        // 來自 20260429090000-plugin-commands-feature-key.ts
        await queryInterface.sequelize.query(
          `CREATE INDEX IF NOT EXISTS plugin_commands_by_feature
               ON plugin_commands(pluginId, featureKey);`,
          { transaction: t },
        );
      }); // end transaction
    } finally {
      // 無論 rebuild 成功或失敗，恢復 foreign_keys（對齊 M1-A1 與 20260424000000 先例）
      await queryInterface.sequelize.query(`PRAGMA foreign_keys = ON;`);
    }
  },
};

export default migration;
