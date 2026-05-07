import { ApiError, authedFetch } from "./client";

// ── v2 列舉型別 ──────────────────────────────────────────────────────────────

export type BehaviorSource = "custom" | "plugin" | "system";
export type BehaviorTriggerType = "slash_command" | "message_pattern";
export type BehaviorMessagePatternKind = "startswith" | "endswith" | "regex";
export type BehaviorForwardType = "one_time" | "continuous";
export type BehaviorScope = "global" | "guild";
export type BehaviorAudienceKind = "all" | "user" | "group";
export type BehaviorWebhookAuthMode = "token" | "hmac";

// ── 保留舊型別供 v1 UI backward compat（BehaviorCard 暫時還需要）──────────────
/** @deprecated v1 型別。v2 用 BehaviorSource。 */
export type BehaviorType = "webhook" | "plugin" | "system";

// ── v2 BehaviorRow ──────────────────────────────────────────────────────────

export interface BehaviorRow {
  id: number;
  title: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  stopOnMatch: boolean;
  forwardType: BehaviorForwardType;
  source: BehaviorSource;
  triggerType: BehaviorTriggerType;
  messagePatternKind: BehaviorMessagePatternKind | null;
  messagePatternValue: string | null;
  slashCommandName: string | null;
  slashCommandDescription: string | null;
  scope: BehaviorScope;
  integrationTypes: string;
  contexts: string;
  placementGuildId: string | null;
  placementChannelId: string | null;
  audienceKind: BehaviorAudienceKind;
  audienceUserId: string | null;
  audienceGroupName: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookAuthMode: BehaviorWebhookAuthMode | null;
  pluginId: number | null;
  pluginBehaviorKey: string | null;
  systemKey: string | null;
}

// ── v2 Audience（sidebar 用）────────────────────────────────────────────────
// 從 /api/behaviors/audience-summary 推導，不依賴 v1 target 表。

export interface AudienceEntry {
  /** 唯一 key（格式：'all' | 'user:{userId}' | 'group:{groupName}'） */
  key: string;
  kind: BehaviorAudienceKind;
  userId?: string;
  groupName?: string;
  /** 此 audience 下的 behavior 數量 */
  behaviorCount: number;
}

// ── v1 target 型別（@deprecated — M2 重構後刪除）────────────────────────────
// 已不被任何元件使用，僅保留型別宣告避免其他已 @deprecated 的引用報錯。

/** @deprecated v1 型別。M2 重構後移除。 */
export type BehaviorTargetKind = "all_dms" | "user" | "group";

export interface BehaviorUserProfile {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
}

/** @deprecated v1 型別。M2 重構後移除。 */
export interface BehaviorTargetSummary {
  id: number;
  kind: BehaviorTargetKind;
  userId: string | null;
  groupName: string | null;
  profile: BehaviorUserProfile | null;
  memberCount: number | null;
}

/** @deprecated v1 型別。M2 重構後移除。 */
export interface BehaviorGroupMember {
  userId: string;
  profile: BehaviorUserProfile | null;
}

// ── v2 Create / Patch payload ────────────────────────────────────────────────

export interface BehaviorCreatePayload {
  title: string;
  description?: string;
  source: BehaviorSource;
  triggerType: BehaviorTriggerType;
  messagePatternKind?: BehaviorMessagePatternKind;
  messagePatternValue?: string;
  slashCommandName?: string;
  slashCommandDescription?: string;
  scope?: BehaviorScope;
  integrationTypes?: string;
  contexts?: string;
  audienceKind?: BehaviorAudienceKind;
  audienceUserId?: string;
  audienceGroupName?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookAuthMode?: BehaviorWebhookAuthMode;
  forwardType?: BehaviorForwardType;
  stopOnMatch?: boolean;
  enabled?: boolean;
  pluginId?: number;
  pluginBehaviorKey?: string;
}

export interface BehaviorPatchPayload {
  title?: string;
  description?: string;
  triggerType?: BehaviorTriggerType;
  messagePatternKind?: BehaviorMessagePatternKind | null;
  messagePatternValue?: string | null;
  slashCommandName?: string | null;
  slashCommandDescription?: string | null;
  scope?: BehaviorScope;
  integrationTypes?: string;
  contexts?: string;
  audienceKind?: BehaviorAudienceKind;
  audienceUserId?: string | null;
  audienceGroupName?: string | null;
  enabled?: boolean;
  forwardType?: BehaviorForwardType;
  stopOnMatch?: boolean;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  webhookAuthMode?: BehaviorWebhookAuthMode | null;
  pluginId?: number | null;
  pluginBehaviorKey?: string | null;
}

// ── 舊版 BehaviorPatch（供 BehaviorCard v1 兼容）────────────────────────────
/** @deprecated 使用 BehaviorPatchPayload */
export type BehaviorPatch = BehaviorPatchPayload;

// ── 輔助 ──────────────────────────────────────────────────────────────────────

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      (body as { error?: string }).error ??
        `${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

// ── v2 Behaviors API ─────────────────────────────────────────────────────────

export async function listBehaviors(params?: {
  audienceKind?: BehaviorAudienceKind;
  source?: BehaviorSource;
  triggerType?: BehaviorTriggerType;
}): Promise<BehaviorRow[]> {
  const qs = new URLSearchParams();
  if (params?.audienceKind) qs.set("audienceKind", params.audienceKind);
  if (params?.source) qs.set("source", params.source);
  if (params?.triggerType) qs.set("triggerType", params.triggerType);
  const url = `/api/behaviors${qs.toString() ? "?" + qs.toString() : ""}`;
  const r = await authedFetch(url);
  const body = await jsonOrThrow<{ behaviors: BehaviorRow[] }>(r);
  return body.behaviors;
}

export async function getBehavior(id: number): Promise<BehaviorRow> {
  const r = await authedFetch(`/api/behaviors/${id}`);
  const body = await jsonOrThrow<{ behavior: BehaviorRow }>(r);
  return body.behavior;
}

export async function createBehaviorV2(
  payload: BehaviorCreatePayload,
): Promise<BehaviorRow> {
  const r = await authedFetch("/api/behaviors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await jsonOrThrow<{ behavior: BehaviorRow }>(r);
  return body.behavior;
}

export async function updateBehavior(
  id: number,
  patch: BehaviorPatchPayload,
): Promise<BehaviorRow> {
  const r = await authedFetch(`/api/behaviors/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await jsonOrThrow<{ behavior: BehaviorRow }>(r);
  return body.behavior;
}

export async function deleteBehavior(id: number): Promise<void> {
  const r = await authedFetch(`/api/behaviors/${id}`, { method: "DELETE" });
  if (r.status === 204) return;
  await jsonOrThrow<unknown>(r);
}

export async function resyncBehavior(id: number): Promise<{ result: unknown }> {
  const r = await authedFetch(`/api/behaviors/${id}/resync`, {
    method: "POST",
  });
  return jsonOrThrow<{ result: unknown }>(r);
}

export async function reorderBehaviors(orderedIds: number[]): Promise<void> {
  const r = await authedFetch("/api/behaviors/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
  await jsonOrThrow<unknown>(r);
}

// ── v2 Audience API ───────────────────────────────────────────────────────────

/**
 * 從 behaviors 表聚合出 sidebar 用的 audience 清單。
 * 呼叫 GET /api/behaviors/audience-summary，前端依 audienceKind + userId/groupName DISTINCT。
 */
export async function listAudiences(): Promise<AudienceEntry[]> {
  const r = await authedFetch("/api/behaviors/audience-summary");
  const body = await jsonOrThrow<{
    summary: Array<{
      id: number;
      audienceKind: string;
      audienceUserId: string | null;
      audienceGroupName: string | null;
      source: string;
      enabled: boolean;
    }>;
  }>(r);

  const map = new Map<string, AudienceEntry>();

  // 確保 all 永遠在清單中（即使沒有任何 behavior）
  map.set("all", {
    key: "all",
    kind: "all",
    behaviorCount: 0,
  });

  for (const row of body.summary) {
    if (row.audienceKind === "all") {
      const entry = map.get("all")!;
      entry.behaviorCount++;
    } else if (row.audienceKind === "user" && row.audienceUserId) {
      const key = `user:${row.audienceUserId}`;
      const existing = map.get(key);
      if (existing) {
        existing.behaviorCount++;
      } else {
        map.set(key, {
          key,
          kind: "user",
          userId: row.audienceUserId,
          behaviorCount: 1,
        });
      }
    } else if (row.audienceKind === "group" && row.audienceGroupName) {
      const key = `group:${row.audienceGroupName}`;
      const existing = map.get(key);
      if (existing) {
        existing.behaviorCount++;
      } else {
        map.set(key, {
          key,
          kind: "group",
          groupName: row.audienceGroupName,
          behaviorCount: 1,
        });
      }
    }
  }

  // all 排第一，其餘依序
  const all = map.get("all")!;
  const rest = Array.from(map.values()).filter((e) => e.kind !== "all");
  return [all, ...rest];
}

/**
 * 刪除某 audience 下的所有 behaviors（等同 v1 deleteTarget）。
 * 依序呼叫 DELETE /api/behaviors/:id。
 */
export async function deleteBehaviorsByAudience(
  behaviorIds: number[],
): Promise<void> {
  await Promise.all(behaviorIds.map((id) => deleteBehavior(id)));
}

// ── v1 Target API（@deprecated — 已無元件使用，保留型別宣告）────────────────
// 以下 API 呼叫已不存在的 /api/behaviors/targets 路徑（v2 schema 已廢棄）。
// BehaviorsPage / BehaviorWorkspace / BehaviorSidebar / AddTargetModal 已全數移除 v1 依賴。
// 保留函數宣告，避免未來誤引用時 tsc 報錯不夠明確。待確認無其他引用後可整批移除。

/** @deprecated v1 API。M2 重構後移除。 */
export async function listTargets(): Promise<BehaviorTargetSummary[]> {
  const r = await authedFetch("/api/behaviors/targets");
  const body = await jsonOrThrow<{ targets: BehaviorTargetSummary[] }>(r);
  return body.targets;
}

/** @deprecated v1 API。M2 重構後移除。 */
export async function createUserTarget(
  userId: string,
): Promise<BehaviorTargetSummary> {
  const r = await authedFetch("/api/behaviors/targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "user", userId }),
  });
  const body = await jsonOrThrow<{ target: BehaviorTargetSummary }>(r);
  return body.target;
}

/** @deprecated v1 API。M2 重構後移除。 */
export async function createGroupTarget(
  groupName: string,
): Promise<BehaviorTargetSummary> {
  const r = await authedFetch("/api/behaviors/targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "group", groupName }),
  });
  const body = await jsonOrThrow<{ target: BehaviorTargetSummary }>(r);
  return body.target;
}

/** @deprecated v1 API。M2 重構後移除。 */
export async function renameGroupTarget(
  id: number,
  groupName: string,
): Promise<void> {
  const r = await authedFetch(`/api/behaviors/targets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupName }),
  });
  await jsonOrThrow<unknown>(r);
}

/** @deprecated v1 API。M2 重構後移除。 */
export async function deleteTarget(id: number): Promise<void> {
  const r = await authedFetch(`/api/behaviors/targets/${id}`, {
    method: "DELETE",
  });
  await jsonOrThrow<unknown>(r);
}

/** @deprecated v1 API。M2 重構後移除。 */
export async function listGroupMembers(
  id: number,
): Promise<BehaviorGroupMember[]> {
  const r = await authedFetch(`/api/behaviors/targets/${id}/members`);
  const body = await jsonOrThrow<{ members: BehaviorGroupMember[] }>(r);
  return body.members;
}

/** @deprecated v1 API。M2 重構後移除。 */
export async function addGroupMember(
  id: number,
  userId: string,
): Promise<BehaviorGroupMember> {
  const r = await authedFetch(`/api/behaviors/targets/${id}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const body = await jsonOrThrow<{ member: BehaviorGroupMember }>(r);
  return body.member;
}

/** @deprecated v1 API。M2 重構後移除。 */
export async function removeGroupMember(
  id: number,
  userId: string,
): Promise<void> {
  const r = await authedFetch(
    `/api/behaviors/targets/${id}/members/${userId}`,
    { method: "DELETE" },
  );
  await jsonOrThrow<unknown>(r);
}
