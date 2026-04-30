import { authedFetch } from "./client";
import { ApiError } from "./client";

// ── Type definitions ──────────────────────────────────────────────────────────

export type GroupKey =
  | "bot"
  | "web"
  | "db"
  | "crypto"
  | "jwt"
  | "plugin"
  | "behavior"
  | "admin"
  | "rcon"
  | "botEvents"
  | "dm";

export type Sensitivity = "sensitive" | "semi-sensitive" | "public";
export type Editability = "env-only" | "runtime-capable" | "runtime-editable";

/** Sensitive fields — no `value` key, only `status` (backend invariant). */
export interface SensitiveField {
  path: string;
  envVar: string;
  sensitivity: "sensitive";
  editability: Editability;
  productionRequired: boolean;
  descriptionKey: string;
  status: "configured" | "unset";
}

/** Non-sensitive fields — carry a `value`. */
export interface NonSensitiveField {
  path: string;
  envVar: string;
  sensitivity: "semi-sensitive" | "public";
  editability: Editability;
  productionRequired: boolean;
  descriptionKey: string;
  value: unknown;
}

export type SettingsField = SensitiveField | NonSensitiveField;

export interface SettingsGroup {
  group: GroupKey;
  fields: SettingsField[];
}

export interface ProductionReadiness {
  currentEnv: "production" | "development" | "test";
  requiredKeys: string[];
  missingKeys: string[];
  allSet: boolean;
}

export interface SystemSettingsResponse {
  groups: SettingsGroup[];
  productionReadiness: ProductionReadiness;
  runtimeEditable: {
    fields: SettingsField[];
    noteKey: string;
  };
}

// ── Type guard ────────────────────────────────────────────────────────────────

export function isSensitiveField(f: SettingsField): f is SensitiveField {
  return f.sensitivity === "sensitive";
}

// ── API call ──────────────────────────────────────────────────────────────────

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // non-JSON body
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export async function getSystemSettings(): Promise<SystemSettingsResponse> {
  const response = await authedFetch("/api/admin/system-settings");
  return json<SystemSettingsResponse>(response);
}
