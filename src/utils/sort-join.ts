/**
 * sort-join.ts — 三軸欄位規範化 helper
 *
 * 對應 v2 schema 三軸欄位（integrationTypes / contexts）的
 * lexicographically-sorted + deduped comma-joined 規範。
 * 對齊 A-schema D-1 + M0-FROZEN §1.4。
 *
 * 接受兩種輸入形態：
 *   - string[]  — 直接 sort + dedup + join（migration 端）
 *   - string    — 先以逗號切割，再 sort + dedup + join（routes 端）
 *   - null / undefined — 回傳 ""
 */
export function sortJoin(
  input: string | string[] | undefined | null,
): string {
  if (!input) return "";
  const arr = Array.isArray(input)
    ? input
    : input
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  if (arr.length === 0) return "";
  return [...new Set(arr)].sort().join(",");
}
