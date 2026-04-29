import { RoleEmojiGroup } from "./role-emoji-group.model.js";

export const EMOJI_REGEX =
  /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])|^<(a?:[^:>]+:)([^>]+)>$/;

// Resolve a posted groupId, rejecting non-numbers and cross-guild
// ids. Returns the validated number on success, or null when the
// caller should respond with a 400.
export async function validateGroupId(
  raw: unknown,
  guildId: string,
): Promise<number | null> {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const owned = await RoleEmojiGroup.findOne({ where: { guildId, id: n } });
  return owned ? n : null;
}
