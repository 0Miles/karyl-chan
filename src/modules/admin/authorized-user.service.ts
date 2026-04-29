import { AuthorizedUser } from "./models/authorized-user.model.js";
import { AdminRole } from "./models/admin-role.model.js";
import { AdminRoleCapability } from "./models/admin-role-capability.model.js";
import {
  GLOBAL_CAPABILITY_DESCRIPTIONS,
  GLOBAL_CAPABILITY_KEYS,
  DEFAULT_ROLES,
  isAdminCapability,
  type AdminCapability,
  type GlobalCapability,
} from "./admin-capabilities.js";
import { botEventLog } from "../../web/bot-event-log.js";

export {
  GLOBAL_CAPABILITY_DESCRIPTIONS,
  GLOBAL_CAPABILITY_KEYS,
  isAdminCapability,
  type AdminCapability,
  type GlobalCapability,
};

export interface AuthorizedUserRecord {
  userId: string;
  role: string;
  note: string | null;
}

export interface AdminRoleRecord {
  name: string;
  description: string | null;
  capabilities: AdminCapability[];
}

function readOwnerId(): string | null {
  return process.env.BOT_OWNER_ID?.trim() || null;
}

// ── User-session cache ────────────────────────────────────────────────────
//
// The auth hook runs resolveUserCapabilities on every authenticated request;
// without caching a chatty page (e.g., DiscordConversation polling + SSE +
// reactions) pays two DB queries per call. A short TTL gives us bounded
// staleness so a role change still takes effect within seconds, and every
// write path explicitly invalidates the touched user(s) for instant cuts.
//
// The cache holds both the role name and the resolved capability set so
// the DM login handler (which wants the role label for its reply) reads
// from the same source instead of doing its own near-identical lookup.

interface UserSession {
  role: string | null;
  caps: Set<AdminCapability>;
}

const SESSION_CACHE_TTL_MS = 30_000;
const sessionCache = new Map<string, UserSession & { expiresAt: number }>();

export function invalidateCapabilityCache(userId?: string): void {
  if (userId === undefined) sessionCache.clear();
  else sessionCache.delete(userId);
}

function toUserRecord(
  row: InstanceType<typeof AuthorizedUser>,
): AuthorizedUserRecord {
  return {
    userId: row.getDataValue("userId") as string,
    role: row.getDataValue("role") as string,
    note: (row.getDataValue("note") as string | null) ?? null,
  };
}

// ── Seeding ────────────────────────────────────────────────────────────────
// Runs on boot so a fresh DB has at least an `admin` role granting every
// current capability. Existing rows are left alone — seeding only adds
// missing defaults.

export async function seedDefaultRoles(): Promise<void> {
  for (const def of DEFAULT_ROLES) {
    await AdminRole.findOrCreate({
      where: { name: def.name },
      defaults: { name: def.name, description: def.description },
    });
    for (const cap of def.capabilities) {
      await AdminRoleCapability.findOrCreate({
        where: { role: def.name, capability: cap },
        defaults: { role: def.name, capability: cap },
      });
    }
  }
}

/**
 * Warn the operator about capability tokens persisted in the DB that
 * the current code doesn't know about — typically a rename or removal
 * that left rows stranded. Those rows are silently filtered out of the
 * capability set at resolve time, so users assigned them effectively
 * lose capabilities without any explanation.
 */
export async function auditStoredCapabilities(
  logger: { warn: (msg: string) => void } = console,
): Promise<void> {
  const rows = await AdminRoleCapability.findAll();
  const unknown = new Set<string>();
  for (const row of rows) {
    const cap = row.getDataValue("capability") as string;
    if (!isAdminCapability(cap)) unknown.add(cap);
  }
  if (unknown.size > 0) {
    const unknownTokens = [...unknown];
    logger.warn(
      `admin_role_capabilities contains unknown tokens (silently ignored): ${unknownTokens.join(", ")}`,
    );
    botEventLog.record(
      "warn",
      "auth",
      `Stranded capability tokens in DB: ${unknownTokens.join(",")}`,
      { unknownTokens, count: unknownTokens.length },
    );
  }
}

// ── Capability resolution ─────────────────────────────────────────────────

async function capabilitiesForRole(
  role: string,
): Promise<Set<AdminCapability>> {
  const rows = await AdminRoleCapability.findAll({ where: { role } });
  const result = new Set<AdminCapability>();
  for (const row of rows) {
    const cap = row.getDataValue("capability") as string;
    if (isAdminCapability(cap)) result.add(cap);
  }
  return result;
}

/**
 * Single source of truth for "who is this token-bearer and what can they do?".
 * Owner → every capability, role label 'owner'. Anyone else → their
 * authorized_users row + the role's granted capabilities. Unknown user →
 * empty set, null role. Cached by userId with a short TTL.
 */
export async function resolveUserSession(
  userId: string,
  ownerId: string | null = readOwnerId(),
  now: number = Date.now(),
): Promise<UserSession> {
  // Owner bypass is constant-time — no DB work, no caching needed.
  // Owner gets `admin` (which short-circuits every capability check
  // including per-guild scoped ones); listing every global token here
  // would still leave per-guild scopes unhandled, so the bypass token
  // is the only honest representation.
  if (ownerId && userId === ownerId) {
    return { role: "owner", caps: new Set<AdminCapability>(["admin"]) };
  }
  const cached = sessionCache.get(userId);
  if (cached && cached.expiresAt > now)
    return { role: cached.role, caps: cached.caps };
  const user = await AuthorizedUser.findByPk(userId);
  const role = user ? (user.getDataValue("role") as string) : null;
  const caps = role
    ? await capabilitiesForRole(role)
    : new Set<AdminCapability>();
  sessionCache.set(userId, {
    role,
    caps,
    expiresAt: now + SESSION_CACHE_TTL_MS,
  });
  return { role, caps };
}

/**
 * Combined resolution: bot owner gets every capability; any other user gets
 * the set defined by their assigned role. Returns an empty set (caller should
 * treat as unauthorized) for users with no entry in authorized_users.
 */
export async function resolveUserCapabilities(
  userId: string,
  ownerId: string | null = readOwnerId(),
  now: number = Date.now(),
): Promise<Set<AdminCapability>> {
  return (await resolveUserSession(userId, ownerId, now)).caps;
}

/**
 * Lightweight "can this user log in?" check. Owner is always allowed; any
 * other user needs a row in authorized_users AND at least one capability
 * granted via their role. The returned role name is what we put in the
 * login-link message and (optionally) the session context.
 */
export async function resolveLoginRole(
  userId: string,
  ownerId: string | null = readOwnerId(),
): Promise<string | null> {
  const session = await resolveUserSession(userId, ownerId);
  if (session.caps.size === 0) return null;
  return session.role;
}

// ── Authorized-user CRUD ──────────────────────────────────────────────────

export async function listAuthorizedUsers(): Promise<AuthorizedUserRecord[]> {
  const rows = await AuthorizedUser.findAll({ order: [["userId", "ASC"]] });
  return rows.map(toUserRecord);
}

export async function findAuthorizedUser(
  userId: string,
): Promise<AuthorizedUserRecord | null> {
  const row = await AuthorizedUser.findByPk(userId);
  return row ? toUserRecord(row) : null;
}

export async function addAuthorizedUser(
  userId: string,
  role: string,
  note: string | null = null,
): Promise<AuthorizedUserRecord> {
  // Caller is expected to pre-validate that the role exists; we don't
  // enforce a FK so listing a user against an undefined role leaves them
  // harmless (capabilities set resolves to empty → no access).
  const [row] = await AuthorizedUser.upsert({ userId, role, note });
  invalidateCapabilityCache(userId);
  return toUserRecord(row);
}

export async function removeAuthorizedUser(userId: string): Promise<boolean> {
  const deleted = await AuthorizedUser.destroy({ where: { userId } });
  invalidateCapabilityCache(userId);
  return deleted > 0;
}

// ── Role CRUD ─────────────────────────────────────────────────────────────

export async function listAdminRoles(): Promise<AdminRoleRecord[]> {
  // Two SELECTs + in-memory group-by, regardless of role count. The old
  // shape did one SELECT + one per role (N+1).
  const [roles, capRows] = await Promise.all([
    AdminRole.findAll({ order: [["name", "ASC"]] }),
    AdminRoleCapability.findAll(),
  ]);
  const capsByRole = new Map<string, AdminCapability[]>();
  for (const row of capRows) {
    const role = row.getDataValue("role") as string;
    const cap = row.getDataValue("capability") as string;
    if (!isAdminCapability(cap)) continue;
    const list = capsByRole.get(role);
    if (list) list.push(cap);
    else capsByRole.set(role, [cap]);
  }
  return roles.map((role) => {
    const name = role.getDataValue("name") as string;
    return {
      name,
      description: (role.getDataValue("description") as string | null) ?? null,
      capabilities: capsByRole.get(name) ?? [],
    };
  });
}

export async function createAdminRole(
  name: string,
  description: string | null = null,
): Promise<AdminRoleRecord> {
  await AdminRole.upsert({ name, description });
  const caps = await capabilitiesForRole(name);
  return { name, description, capabilities: [...caps] };
}

export async function deleteAdminRole(name: string): Promise<boolean> {
  // Cap rows cascade manually — sequelize doesn't enforce FKs on SQLite by
  // default here. Any AuthorizedUser still referencing this role will
  // resolve to an empty capability set and be treated as unauthorized.
  await AdminRoleCapability.destroy({ where: { role: name } });
  const removed = await AdminRole.destroy({ where: { name } });
  // Role-level mutations can affect any number of users — clearing the
  // whole cache is simpler and still cheap (we rebuild on next request).
  invalidateCapabilityCache();
  return removed > 0;
}

export async function grantRoleCapability(
  role: string,
  capability: AdminCapability,
): Promise<void> {
  await AdminRoleCapability.findOrCreate({
    where: { role, capability },
    defaults: { role, capability },
  });
  invalidateCapabilityCache();
}

export async function revokeRoleCapability(
  role: string,
  capability: AdminCapability,
): Promise<void> {
  await AdminRoleCapability.destroy({ where: { role, capability } });
  invalidateCapabilityCache();
}
