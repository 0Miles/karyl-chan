/**
 * 20260507020000-drop-legacy-behavior-targets
 *
 * M1-A1 cleanup：確保 behavior_targets + behavior_target_members 表
 * 不存在於任何升級路徑上的 DB。
 *
 * 背景：migration 20260501010000-behaviors-v2-rebuild 已執行 DROP，
 * 但早於此 migration 的 fresh install 若只跑到 20260501 之前再升級，
 * 仍可能保留舊表。本 migration 作為最終清除保險。
 *
 * down 不還原（破壞性 cleanup，v1 表在 v2 無用途）。
 */

import type { QueryInterface } from "sequelize";

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(
    "DROP TABLE IF EXISTS behavior_target_members;",
  );
  await queryInterface.sequelize.query(
    "DROP TABLE IF EXISTS behavior_targets;",
  );
}

export async function down(_queryInterface: QueryInterface): Promise<void> {
  // 不還原：v1 表已永久廢棄。
}
