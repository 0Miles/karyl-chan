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

// ── v1 target 型別（@deprecated — M2 重構後刪除）────────────────────────────
// BehaviorsPage / BehaviorWorkspace / BehaviorSidebar / AddTargetModal /
// RoleCapabilityModal 仍使用下列型別與 API，待 M2 sidebar v2 重構完成後整批移除。

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

// ── v1 Target API（@deprecated — M2 重構後刪除）────────────────────────────
// 以下 API 呼叫已不存在的 /api/behaviors/targets 路徑（v2 schema 已廢棄）。
// 仍在 BehaviorsPage / BehaviorWorkspace / AddTargetModal / RoleCapabilityModal 使用中。
// TODO(M2): 用 /api/behaviors?audienceKind=... 取代，整批移除。

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
