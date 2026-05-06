/**
 * @deprecated M1-A1：v2 破壞性遷移後，behavior_target_members 表已 DROP。
 * 此檔僅保留 stub 讓現有 import 能 compile；M1-C 接管後整檔刪除。
 *
 * v2 改用 behavior_audience_members 表（BehaviorAudienceMember model）。
 */

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const findGroupMembers = async (_targetId: number): Promise<string[]> =>
  [];

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const findGroupTargetIdsForUser = async (
  _userId: string,
): Promise<number[]> => [];

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const addGroupMember = async (
  _targetId: number,
  _userId: string,
): Promise<void> => {
  throw new Error(
    "M1-A1: addGroupMember deprecated (v1 API). Table behavior_target_members does not exist in v2.",
  );
};

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const removeGroupMember = async (
  _targetId: number,
  _userId: string,
): Promise<void> => {
  throw new Error(
    "M1-A1: removeGroupMember deprecated (v1 API). Table behavior_target_members does not exist in v2.",
  );
};

/** @deprecated v1 stub。M1-C 接管後移除。 */
export const replaceGroupMembers = async (
  _targetId: number,
  _userIds: string[],
): Promise<void> => {
  throw new Error(
    "M1-A1: replaceGroupMembers deprecated (v1 API). Table behavior_target_members does not exist in v2.",
  );
};
