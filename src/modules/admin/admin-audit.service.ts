import { createHash } from "crypto";
import { Op, Transaction } from "sequelize";
import { AdminAuditLog } from "./models/admin-audit-log.model.js";
import { sequelize } from "../../db.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { moduleLogger } from "../../logger.js";

const log = moduleLogger("admin-audit");

/**
 * Stable (canonical) JSON serialisation for use in hash-chain inputs.
 *
 * Guarantees:
 *   - Object keys are sorted recursively so key-ordering differences in
 *     the caller do not produce different byte sequences.
 *   - Date objects are serialised as their ISO-8601 string so
 *     `new Date("2026-01-01")` and an already-serialised ISO string both
 *     produce the same bytes.
 *   - `undefined` values are stripped (JSON.stringify already drops them
 *     silently; we make the stripping explicit and log a warning so the
 *     caller knows the field was omitted from the hash input).
 *
 * This helper is intentionally ~20 lines with no external dependencies.
 * It replaces bare JSON.stringify in every site that contributes bytes to
 * the audit hash chain.
 */
function stableStringify(value: unknown, path = ""): string {
  if (value === undefined) {
    log.warn({ path }, "audit stableStringify: undefined value stripped from hash input");
    return "null";
  }
  if (value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return "[" + value.map((v, i) => stableStringify(v, `${path}[${i}]`)).join(",") + "]";
  }
  if (typeof value === "object") {
    const sorted = Object.keys(value as Record<string, unknown>)
      .filter((k) => {
        if ((value as Record<string, unknown>)[k] === undefined) {
          log.warn({ path: path ? `${path}.${k}` : k }, "audit stableStringify: undefined value stripped from hash input");
          return false;
        }
        return true;
      })
      .sort();
    return (
      "{" +
      sorted
        .map((k) => {
          const v = stableStringify((value as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
          return `${JSON.stringify(k)}:${v}`;
        })
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

/**
 * Exported for unit-testing only.  Not part of the public API.
 * Prefixed with underscore to signal test-internal usage.
 */
export const _stableStringifyForTest = stableStringify;

export interface AdminAuditEntry {
  id: number;
  actorUserId: string;
  action: string;
  target: string | null;
  context: Record<string, unknown> | null;
  createdAt: string;
  previousHash: string | null;
  hash: string;
}

/**
 * Canonical serialization for chain hashing. The exact byte sequence
 * matters — any future change here breaks every existing chain link, so
 * if we ever need to evolve the schema (e.g. add a column to the hash
 * input) introduce a new "v2" canonicaliser and dispatch on a column
 * rather than rewriting this one in place.
 *
 * Context is fed in as the JSON.stringify form (or null) — even though
 * the column itself is now DataTypes.JSON, the chain still hashes the
 * stringified bytes so that pre-migration rows whose hashes were
 * computed against the raw string verify identically.
 */
function canonicalPayload(
  actorUserId: string,
  action: string,
  target: string | null,
  contextJson: string | null,
  createdAtMs: number,
): string {
  // Keys are already in a fixed, alphabetical order here, but we use
  // stableStringify for consistency — any nested value (e.g. a Date
  // buried inside contextJson is already a string at this point, so the
  // main benefit is the consistent serialisation contract).
  return stableStringify({
    action,
    actorUserId,
    context: contextJson,
    createdAt: createdAtMs,
    target,
  });
}

/**
 * The audit table is now a JSON column, but the chain hash was
 * originally computed from the string form (and pre-migration rows
 * remain that way). This helper produces the canonical string from
 * whatever shape Sequelize hands back so both write-time and
 * verify-time hashing see the same bytes for the same logical content.
 */
function contextToCanonicalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  // Pre-migration rows stored the context as a raw JSON string in a TEXT
  // column.  Those rows were hashed against that exact string at write
  // time, so we must NOT re-encode them — returning the string verbatim
  // preserves backward compatibility for existing chain links.
  if (typeof value === "string") return value;
  // Post-migration rows: the column is DataTypes.JSON and Sequelize
  // returns a parsed object.  Re-serialise with stableStringify so that
  // key-ordering differences between write-time and verify-time do not
  // produce false positives.
  return stableStringify(value);
}

function chainHash(previousHash: string | null, payload: string): string {
  return createHash("sha256")
    .update(previousHash ?? "")
    .update("|")
    .update(payload)
    .digest("hex");
}

/**
 * Append a single audit row. Each insert reads the most-recent row's
 * `hash`, computes `sha256(previousHash || canonical(this row))`, and
 * stores both. SQLite serialises writes via a single writer lock so a
 * BEGIN IMMEDIATE transaction guarantees no two inserts can claim the
 * same predecessor concurrently.
 *
 * Failure semantics: if the audit write throws (DB unavailable, hash
 * collision impossible, etc.) we DO NOT silently swallow it — the
 * operation that triggered the audit has already succeeded by the time
 * we get here, but a missing audit row is exactly the case the
 * tamper-evident chain is supposed to catch. We surface to the system
 * event log so an admin can see the gap and investigate.
 */
export async function recordAudit(
  actorUserId: string,
  action: string,
  target: string | null = null,
  context: Record<string, unknown> | null = null,
): Promise<void> {
  const contextJson = context ? stableStringify(context) : null;
  const createdAt = new Date();
  try {
    await sequelize.transaction(async (tx: Transaction) => {
      const last = await AdminAuditLog.findOne({
        order: [["id", "DESC"]],
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      const previousHash =
        (last?.getDataValue("hash") as string | null) ?? null;
      const payload = canonicalPayload(
        actorUserId,
        action,
        target,
        contextJson,
        createdAt.getTime(),
      );
      const hash = chainHash(previousHash, payload);
      await AdminAuditLog.create(
        {
          actorUserId,
          action,
          target,
          // Pass the object form — Sequelize re-stringifies via the
          // JSON column. The bytes match contextJson because
          // JSON.stringify is deterministic for plain objects with
          // string keys (which is all we ever pass in here), so
          // the hash we just computed remains valid.
          context,
          previousHash,
          hash,
          createdAt,
        },
        { transaction: tx },
      );
    });
    // Successful chain append — bump the prom counter. Setter-injected
    // by main.ts to avoid an ESM circular (metrics.ts → plugin-system
    // → bot-event-log; admin-audit lives downstream of audit consumers).
    try {
      auditLogMetricRef?.inc({ action });
    } catch {
      /* metrics-failure must never affect audit semantics */
    }
  } catch (err) {
    // Loud failure: surface to system events so a human notices the
    // chain has a hole, even if the original mutation already
    // committed. We don't rethrow to avoid 500ing a request whose
    // primary work succeeded — the audit is meant to observe, not
    // veto. (See file-level note for the trade-off.)
    const msg = err instanceof Error ? err.message : String(err);
    botEventLog.record(
      "error",
      "error",
      `admin audit write failed: ${action} target=${target ?? "∅"} (${msg})`,
    );
    log.error({ err }, "admin audit write failed");
  }
}

let auditLogMetricRef: { inc: (labels: { action: string }) => void } | null =
  null;

export function setAuditLogMetric(
  counter: { inc: (labels: { action: string }) => void } | null,
): void {
  auditLogMetricRef = counter;
}

export interface ListAuditOptions {
  limit?: number;
  before?: number;
}

export async function listAudit(
  options: ListAuditOptions = {},
): Promise<AdminAuditEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const where =
    typeof options.before === "number"
      ? { id: { [Op.lt]: options.before } }
      : undefined;
  const rows = await AdminAuditLog.findAll({
    where,
    order: [["id", "DESC"]],
    limit,
  });
  return rows.map((row) => {
    // DataTypes.JSON returns the parsed object, but pre-migration
    // rows that were written via TEXT may still come back as a
    // string. Normalise both shapes to a Record (or null).
    const raw = row.getDataValue("context") as unknown;
    let context: Record<string, unknown> | null = null;
    if (raw && typeof raw === "object") {
      context = raw as Record<string, unknown>;
    } else if (typeof raw === "string" && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object")
          context = parsed as Record<string, unknown>;
      } catch {
        // Malformed context — skip rather than 500 the whole list.
      }
    }
    return {
      id: row.getDataValue("id") as number,
      actorUserId: row.getDataValue("actorUserId") as string,
      action: row.getDataValue("action") as string,
      target: (row.getDataValue("target") as string | null) ?? null,
      context,
      createdAt: (row.getDataValue("createdAt") as Date).toISOString(),
      previousHash: (row.getDataValue("previousHash") as string | null) ?? null,
      hash: row.getDataValue("hash") as string,
    };
  });
}

export interface AuditChainVerification {
  valid: boolean;
  rowsChecked: number;
  /** id of the first row whose stored hash didn't match the recomputed value. */
  firstBrokenId: number | null;
}

/**
 * Walk the chain ascending, recompute each row's hash from its
 * predecessor + payload, and stop at the first mismatch. Cheap enough
 * to run on demand for a few thousand rows; for very large logs run
 * with a `since` window. Designed for human-triggered audits — this is
 * not on a hot path.
 */
export async function verifyAuditChain(): Promise<AuditChainVerification> {
  const rows = await AdminAuditLog.findAll({ order: [["id", "ASC"]] });
  let previousHash: string | null = null;
  for (const row of rows) {
    const id = row.getDataValue("id") as number;
    const storedHash = row.getDataValue("hash") as string;
    const storedPrev =
      (row.getDataValue("previousHash") as string | null) ?? null;
    if (storedPrev !== previousHash) {
      return { valid: false, rowsChecked: rows.length, firstBrokenId: id };
    }
    const payload = canonicalPayload(
      row.getDataValue("actorUserId") as string,
      row.getDataValue("action") as string,
      (row.getDataValue("target") as string | null) ?? null,
      contextToCanonicalString(row.getDataValue("context")),
      (row.getDataValue("createdAt") as Date).getTime(),
    );
    const expected = chainHash(previousHash, payload);
    if (expected !== storedHash) {
      return { valid: false, rowsChecked: rows.length, firstBrokenId: id };
    }
    previousHash = storedHash;
  }
  return { valid: true, rowsChecked: rows.length, firstBrokenId: null };
}
