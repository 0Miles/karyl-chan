import { authedFetch, jsonOrThrow } from "./client";

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

export async function getSystemSettings(): Promise<SystemSettingsResponse> {
  const response = await authedFetch("/api/admin/system-settings");
  return jsonOrThrow<SystemSettingsResponse>(response);
}

// ── JWT signing key ───────────────────────────────────────────────────────────

export interface JwtSigningKeyInfo {
  /** False when the bot is on an ephemeral in-memory key (no DB row). */
  persisted: boolean;
  algorithm?: string;
  publicKeyPem?: string;
  fingerprint?: string;
  /** ISO timestamp; null when running on the ephemeral fallback. */
  createdAt?: string | null;
}

export async function getJwtSigningKey(): Promise<JwtSigningKeyInfo> {
  const response = await authedFetch("/api/admin/jwt-signing-key");
  return jsonOrThrow<JwtSigningKeyInfo>(response);
}

export interface RotateJwtSigningKeyResult {
  ok: true;
  algorithm: string;
  publicKeyPem: string;
  fingerprint: string;
}

export async function rotateJwtSigningKey(): Promise<RotateJwtSigningKeyResult> {
  const response = await authedFetch("/api/admin/jwt-signing-key/rotate", {
    method: "POST",
  });
  return jsonOrThrow<RotateJwtSigningKeyResult>(response);
}
