/**
 * @deprecated M1-A1：v2 破壞性遷移後，behavior_targets 表已 DROP。
 * 此檔僅保留 stub 讓現有 import 能 compile；M1-C 接管後整檔刪除。
 *
 * v2 schema 改用 behaviors.audienceKind / audienceUserId / audienceGroupName 欄位，
 * 以及 behavior_audience_members 表（BehaviorAudienceMember model）取代此表。
 */

// ALL_DMS_TARGET_ID 沿用作為 stub 常數，讓 behavior-routes.ts 的 compile 通過。
// v2 無 targetId 概念；M1-C 接管後此常數應移除。
/** @deprecated v1 常數。M1-C 接管後移除。 */
export const ALL_DMS_TARGET_ID = 1;

/** @deprecated v1 型別。M1-C 接管後移除。 */
export type BehaviorTargetKind = "all_dms" | "user" | "group";

/** @deprecated v1 型別。M1-C 接管後移除。 */
export interface BehaviorTargetRow {
  id: number;
  kind: BehaviorTargetKind;
  userId: string | null;
  groupName: string | null;
}

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const findAllBehaviorTargets = async (): Promise<BehaviorTargetRow[]> =>
  [];

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const findBehaviorTargetById = async (
  _id: number,
): Promise<BehaviorTargetRow | null> => null;

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const findUserTarget = async (
  _userId: string,
): Promise<BehaviorTargetRow | null> => null;

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const findGroupTargetByName = async (
  _groupName: string,
): Promise<BehaviorTargetRow | null> => null;

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const createUserTarget = async (
  _userId: string,
): Promise<BehaviorTargetRow> => {
  throw new Error(
    "M1-A1: createUserTarget deprecated (v1 API). Table behavior_targets does not exist in v2.",
  );
};

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const createGroupTarget = async (
  _groupName: string,
): Promise<BehaviorTargetRow> => {
  throw new Error(
    "M1-A1: createGroupTarget deprecated (v1 API). Table behavior_targets does not exist in v2.",
  );
};

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const renameGroupTarget = async (
  _id: number,
  _newName: string,
): Promise<void> => {
  throw new Error(
    "M1-A1: renameGroupTarget deprecated (v1 API). Table behavior_targets does not exist in v2.",
  );
};

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const deleteBehaviorTarget = async (_id: number): Promise<void> => {
  throw new Error(
    "M1-A1: deleteBehaviorTarget deprecated (v1 API). Table behavior_targets does not exist in v2.",
  );
};

/**
 * @deprecated v1 stub。v2 無 all_dms target；ensureAllDmsTarget 為 no-op。
 * main.ts 呼叫此函式會安全跳過。M1-C 接管後移除。
 */
export const ensureAllDmsTarget = async (): Promise<void> => {
  // M1-A1: no-op。v2 schema 無 behavior_targets 表，all_dms 概念已廢棄。
};
