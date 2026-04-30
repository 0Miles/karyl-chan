import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import {
  CONFIG_METADATA,
  type ConfigGroup,
} from "../../config-metadata.js";
import { requireCapability } from "../web-core/route-guards.js";

// ── constants ────────────────────────────────────────────────────────────────

/**
 * Explicit ordering of config groups in the response. This keeps the
 * snapshot stable across deploys even if Object.keys() iteration order
 * shifts. The list must cover every ConfigGroup value used in
 * CONFIG_METADATA; any group not listed here is appended at the end
 * in encounter order (fail-open for future groups, not fail-closed).
 */
const GROUP_ORDER: ConfigGroup[] = [
  "bot",
  "web",
  "db",
  "crypto",
  "jwt",
  "plugin",
  "behavior",
  "admin",
  "rcon",
  "botEvents",
  "dm",
];

// ── types ────────────────────────────────────────────────────────────────────

type SensitiveField = {
  path: string;
  envVar: string;
  sensitivity: "sensitive";
  editability: string;
  productionRequired: boolean;
  descriptionKey: string;
  status: "configured" | "unset";
};

type PublicField = {
  path: string;
  envVar: string;
  sensitivity: "semi-sensitive" | "public";
  editability: string;
  productionRequired: boolean;
  descriptionKey: string;
  value: unknown;
};

type SettingsField = SensitiveField | PublicField;

interface SettingsGroup {
  group: ConfigGroup;
  fields: SettingsField[];
}

interface ProductionReadiness {
  currentEnv: "development" | "production" | "test";
  requiredKeys: string[];
  missingKeys: string[];
  allSet: boolean;
}

interface RuntimeEditable {
  fields: never[];
  noteKey: string;
}

interface SystemSettingsSnapshot {
  groups: SettingsGroup[];
  productionReadiness: ProductionReadiness;
  runtimeEditable: RuntimeEditable;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a dot-notation path (e.g. "bot.token") against a plain object.
 * Returns undefined if any segment is missing. Arrays are treated as
 * leaf values and returned directly.
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Build the complete system-settings snapshot from the live config
 * object and CONFIG_METADATA. This function contains the security
 * invariant: if a sensitive field leaks a value key the function
 * throws (fail-closed) rather than silently serving the secret.
 */
export function buildSystemSettingsSnapshot(): SystemSettingsSnapshot {
  // ── 1. Group fields by ConfigGroup ────────────────────────────────────────
  const groupMap = new Map<ConfigGroup, SettingsField[]>();

  for (const [path, meta] of Object.entries(CONFIG_METADATA)) {
    const raw = getByPath(config as unknown as Record<string, unknown>, path);

    let field: SettingsField;

    if (meta.sensitivity === "sensitive") {
      // Sensitive fields: only expose configured/unset status.
      // "truthy" means non-null, non-empty-string, non-undefined.
      const isConfigured =
        raw !== null && raw !== undefined && raw !== "" && raw !== false;
      field = {
        path,
        envVar: meta.envVar,
        sensitivity: "sensitive",
        editability: meta.editability,
        productionRequired: meta.productionRequired,
        descriptionKey: meta.descriptionKey,
        status: isConfigured ? "configured" : "unset",
      };
    } else {
      field = {
        path,
        envVar: meta.envVar,
        sensitivity: meta.sensitivity,
        editability: meta.editability,
        productionRequired: meta.productionRequired,
        descriptionKey: meta.descriptionKey,
        value: raw ?? null,
      };
    }

    const existing = groupMap.get(meta.group);
    if (existing) {
      existing.push(field);
    } else {
      groupMap.set(meta.group, [field]);
    }
  }

  // ── 2. Sort groups by GROUP_ORDER, append unknown groups at the end ────────
  const orderedGroups: SettingsGroup[] = [];
  for (const groupName of GROUP_ORDER) {
    const fields = groupMap.get(groupName);
    if (fields) {
      orderedGroups.push({ group: groupName, fields });
      groupMap.delete(groupName);
    }
  }
  // Append any remaining groups not in GROUP_ORDER (future-proofing).
  for (const [groupName, fields] of groupMap) {
    orderedGroups.push({ group: groupName, fields });
  }

  // ── 3. Security invariant: sensitive fields must NOT carry a value key ─────
  for (const { group, fields } of orderedGroups) {
    for (const field of fields) {
      if (field.sensitivity === "sensitive" && Object.hasOwn(field, "value")) {
        // Fail-closed: throw rather than silently leaking a secret.
        throw new Error(
          `[SECURITY] sensitive field "${field.path}" in group "${group}" has a value key — refusing to serve`,
        );
      }
    }
  }

  // ── 4. Production readiness ────────────────────────────────────────────────
  const requiredKeys = Object.entries(CONFIG_METADATA)
    .filter(([, meta]) => meta.productionRequired)
    .map(([path]) => path);

  const missingKeys = requiredKeys.filter((path) => {
    const raw = getByPath(config as unknown as Record<string, unknown>, path);
    return raw === null || raw === undefined || raw === "";
  });

  const productionReadiness: ProductionReadiness = {
    currentEnv: config.env,
    requiredKeys,
    missingKeys,
    allSet: missingKeys.length === 0,
  };

  // ── 5. Runtime-editable (placeholder for future task) ─────────────────────
  const runtimeEditable: RuntimeEditable = {
    fields: [],
    noteKey: "admin.systemSettings.runtime.empty",
  };

  return { groups: orderedGroups, productionReadiness, runtimeEditable };
}

// ── route registration ────────────────────────────────────────────────────────

const requireAdmin = (request: FastifyRequest, reply: FastifyReply): boolean =>
  requireCapability(request, reply, "admin");

/**
 * Registers GET /api/admin/system-settings.
 *
 * Returns a redacted snapshot of the current runtime configuration:
 * - Sensitive fields expose only "configured" | "unset" status.
 * - All fields are classified by group, sensitivity, and editability.
 * - Production readiness summary lists which required keys are unset.
 *
 * Security guarantees:
 *   1. Sensitive field values are NEVER included (enforced by invariant).
 *   2. No query parameters are accepted (no ?include=value footgun).
 *   3. Requires the "admin" capability.
 *   4. No audit log (read-only endpoint, no side-effects).
 */
export async function registerAdminSystemSettingsRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.get(
    "/api/admin/system-settings",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      return buildSystemSettingsSnapshot();
    },
  );
}
