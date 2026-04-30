import { ApiError, authedFetch } from "./client";

export type BehaviorTargetKind = "all_dms" | "user" | "group";
export type BehaviorTriggerType =
  | "startswith"
  | "endswith"
  | "regex"
  | "slash_command";
export type BehaviorForwardType = "one_time" | "continuous";

export interface BehaviorUserProfile {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
}

export interface BehaviorTargetSummary {
  id: number;
  kind: BehaviorTargetKind;
  userId: string | null;
  groupName: string | null;
  profile: BehaviorUserProfile | null;
  memberCount: number | null;
}

export interface BehaviorGroupMember {
  userId: string;
  profile: BehaviorUserProfile | null;
}

export type BehaviorType = "webhook" | "plugin" | "system";

export interface BehaviorRow {
  id: number;
  targetId: number;
  title: string;
  description: string;
  triggerType: BehaviorTriggerType;
  triggerValue: string;
  forwardType: BehaviorForwardType;
  sortOrder: number;
  stopOnMatch: boolean;
  enabled: boolean;
  /**
   * For type='webhook': plaintext URL — encrypted at rest, decrypted
   * for the UI.
   * For type='plugin':  placeholder string ("plugin://<key>/<bk>"),
   * not used at dispatch time — the live URL is read from the plugin
   * registry. Surfaced read-only in the UI as a debug aid.
   */
  webhookUrl: string;
  /**
   * Optional HMAC shared secret. Always null for type='plugin' rows
   * (plugin path uses the per-plugin dispatchHmacKey, not a per-behavior key).
   */
  webhookSecret: string | null;
  type: BehaviorType;
  /** Set when type='plugin'; references the plugins registry row. */
  pluginId: number | null;
  /** dm_behaviors[].key from the plugin's manifest. */
  pluginBehaviorKey: string | null;
}

export interface NewBehaviorPayload {
  title: string;
  description?: string;
  triggerType: BehaviorTriggerType;
  triggerValue: string;
  forwardType: BehaviorForwardType;
  /** Required for type='webhook' (default). Ignored when type='plugin'. */
  webhookUrl?: string;
  /** Empty / omitted = no signing. Non-empty = enable HMAC signing. */
  webhookSecret?: string;
  stopOnMatch?: boolean;
  enabled?: boolean;
  /** Defaults to 'webhook' on the bot side when omitted. */
  type?: BehaviorType;
  /** Required when type='plugin'. */
  pluginId?: number;
  /** Required when type='plugin'. */
  pluginBehaviorKey?: string;
}

export interface BehaviorPatch {
  title?: string;
  description?: string;
  triggerType?: BehaviorTriggerType;
  triggerValue?: string;
  forwardType?: BehaviorForwardType;
  /** Required-when-present: must be a valid http/https URL. Omit to leave untouched. */
  webhookUrl?: string;
  /**
   * Empty string / null = clear (disable signing). Non-empty = set.
   * Omit to leave untouched.
   */
  webhookSecret?: string | null;
  stopOnMatch?: boolean;
  enabled?: boolean;
  targetId?: number;
  /**
   * Switch the behavior between dispatch types. When changing TO
   * 'plugin' the patch MUST include pluginId + pluginBehaviorKey.
   * When changing TO 'webhook' from a plugin row the patch MUST
   * include webhookUrl (the existing field holds a "plugin://…"
   * placeholder that doesn't pass URL validation).
   */
  type?: BehaviorType;
  pluginId?: number | null;
  pluginBehaviorKey?: string | null;
}

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

export async function listTargets(): Promise<BehaviorTargetSummary[]> {
  const r = await authedFetch("/api/behaviors/targets");
  const body = await jsonOrThrow<{ targets: BehaviorTargetSummary[] }>(r);
  return body.targets;
}

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

export async function deleteTarget(id: number): Promise<void> {
  const r = await authedFetch(`/api/behaviors/targets/${id}`, {
    method: "DELETE",
  });
  await jsonOrThrow<unknown>(r);
}

export async function listGroupMembers(
  id: number,
): Promise<BehaviorGroupMember[]> {
  const r = await authedFetch(`/api/behaviors/targets/${id}/members`);
  const body = await jsonOrThrow<{ members: BehaviorGroupMember[] }>(r);
  return body.members;
}

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

export async function listBehaviors(targetId: number): Promise<BehaviorRow[]> {
  const r = await authedFetch(`/api/behaviors/targets/${targetId}/behaviors`);
  const body = await jsonOrThrow<{ behaviors: BehaviorRow[] }>(r);
  return body.behaviors;
}

export async function createBehavior(
  targetId: number,
  payload: NewBehaviorPayload,
): Promise<BehaviorRow> {
  const r = await authedFetch(`/api/behaviors/targets/${targetId}/behaviors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await jsonOrThrow<{ behavior: BehaviorRow }>(r);
  return body.behavior;
}

export async function updateBehavior(
  behaviorId: number,
  patch: BehaviorPatch,
): Promise<BehaviorRow> {
  const r = await authedFetch(`/api/behaviors/behaviors/${behaviorId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await jsonOrThrow<{ behavior: BehaviorRow }>(r);
  return body.behavior;
}

export async function deleteBehavior(behaviorId: number): Promise<void> {
  const r = await authedFetch(`/api/behaviors/behaviors/${behaviorId}`, {
    method: "DELETE",
  });
  await jsonOrThrow<unknown>(r);
}

export async function reorderBehaviors(
  targetId: number,
  orderedIds: number[],
): Promise<void> {
  const r = await authedFetch(
    `/api/behaviors/targets/${targetId}/behaviors/reorder`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    },
  );
  await jsonOrThrow<unknown>(r);
}
