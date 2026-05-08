/**
 * Idempotent seed for the 4 fixed scope tabs.
 *
 * Runs at boot after migrations. If a fixed tab is missing (e.g. manually
 * deleted from the DB), it is recreated with the canonical ID.
 */

import {
  BehaviorScopeTab,
  FIXED_TAB_IDS,
  FIXED_TAB_TYPES,
  type ScopeTabType,
} from "./models/behavior-scope-tab.model.js";
import { botEventLog } from "../bot-events/bot-event-log.js";

const FIXED_TAB_LABELS: Record<string, string> = {
  global_all: "All Scope",
  all_dms: "All DMs",
  all_bot_dms: "All Bot DMs",
  all_guilds: "All Guilds",
};

export async function ensureFixedScopeTabs(): Promise<{
  created: ScopeTabType[];
  existing: ScopeTabType[];
}> {
  const created: ScopeTabType[] = [];
  const existing: ScopeTabType[] = [];

  const rows = await BehaviorScopeTab.findAll({
    where: { isFixed: true },
  });
  const byType = new Map(
    rows.map(
      (r) =>
        [r.getDataValue("tabType") as ScopeTabType, r] as const,
    ),
  );

  for (const tabType of FIXED_TAB_TYPES) {
    if (byType.has(tabType)) {
      existing.push(tabType);
      continue;
    }
    const id = FIXED_TAB_IDS[tabType as keyof typeof FIXED_TAB_IDS];
    await BehaviorScopeTab.create({
      id,
      tabType,
      label: FIXED_TAB_LABELS[tabType] ?? tabType,
      isFixed: true,
      sortOrder: Object.keys(FIXED_TAB_IDS).indexOf(tabType),
    });
    created.push(tabType);
  }

  if (created.length > 0) {
    botEventLog.record(
      "info",
      "bot",
      `scope-tab-seed: created ${created.length} fixed tab(s) (${created.join(", ")})`,
      { created, existing },
    );
  }

  const missing = FIXED_TAB_TYPES.filter(
    (t) => !created.includes(t) && !existing.includes(t),
  );
  if (missing.length > 0) {
    throw new Error(
      `scope-tab-seed: expected 4 fixed tabs, missing: ${missing.join(", ")}`,
    );
  }

  return { created, existing };
}
