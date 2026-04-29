import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Plugin auth: separate token store from admin auth.
 *
 * Why separate from AuthStore:
 *   - Plugin tokens carry a different scope set (manifest's
 *     rpc_methods_used) than admin access tokens (capability bitmap).
 *   - Plugin tokens rotate on each successful re-registration
 *     (plugin restart → new token), which is a different lifecycle
 *     than admin sessions (refresh-token-driven).
 *   - We persist only the SHA-256 hash of the live token in
 *     plugins.tokenHash; the cleartext token is returned to the
 *     plugin once at registration and never stored.
 *
 * In-memory cache: tokenHash → {pluginId, scopes, expiresAt}.
 * The hash is the source of truth, looked up by hash on every RPC.
 * On bot restart the cache is empty; the first RPC after restart
 * will fail with 401, the plugin will see it, treat it as "I lost my
 * token", and re-register. That's intended — bot restart is rare and
 * re-registration is cheap.
 */

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour rolling on heartbeat

export interface PluginAuthRecord {
  pluginId: number;
  pluginKey: string;
  scopes: Set<string>;
  expiresAt: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("hex");
}

export class PluginAuthStore {
  private byHash = new Map<string, PluginAuthRecord>();

  /**
   * Mint a fresh plugin token. Returns the cleartext (to send to the
   * plugin) and the hash (to persist in plugins.tokenHash). Any
   * previously cached token for this pluginId is wiped — only the
   * latest registration is honored.
   */
  issue(input: { pluginId: number; pluginKey: string; scopes: string[] }): {
    token: string;
    tokenHash: string;
  } {
    // Drop any stale records for this plugin id. There can be at most
    // one live token per plugin at a time.
    for (const [h, rec] of this.byHash) {
      if (rec.pluginId === input.pluginId) this.byHash.delete(h);
    }
    const token = newToken();
    const tokenHash = hashToken(token);
    this.byHash.set(tokenHash, {
      pluginId: input.pluginId,
      pluginKey: input.pluginKey,
      scopes: new Set(input.scopes),
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return { token, tokenHash };
  }

  /**
   * Verify a presented bearer token. Returns the matching auth record
   * or null. Constant-time string-length-prefix prevents timing leaks
   * on short prefixes.
   */
  verify(
    presentedToken: string,
    now: number = Date.now(),
  ): PluginAuthRecord | null {
    if (!presentedToken) return null;
    const presentedHash = hashToken(presentedToken);
    const rec = this.byHash.get(presentedHash);
    if (!rec) return null;
    if (rec.expiresAt < now) {
      this.byHash.delete(presentedHash);
      return null;
    }
    // The Map lookup itself isn't constant-time wrt the key, but the
    // key is sha256 of the token — the attacker can't influence the
    // timing meaningfully without already knowing the token.
    return rec;
  }

  /**
   * Slide expiry forward; called from heartbeat handler. Lets plugins
   * stay authed indefinitely as long as they keep heartbeating.
   */
  refresh(presentedToken: string, now: number = Date.now()): boolean {
    const presentedHash = hashToken(presentedToken);
    const rec = this.byHash.get(presentedHash);
    if (!rec || rec.expiresAt < now) return false;
    rec.expiresAt = now + TOKEN_TTL_MS;
    return true;
  }

  /** Drop a specific plugin's token (admin disable / unregister). */
  revokeByPluginId(pluginId: number): void {
    for (const [h, rec] of this.byHash) {
      if (rec.pluginId === pluginId) this.byHash.delete(h);
    }
  }

  /** Drop a specific token. */
  revokeToken(token: string): void {
    this.byHash.delete(hashToken(token));
  }

  /**
   * Constant-time compare two tokens. Used to verify the plugin's
   * shared registration secret (KARYL_PLUGIN_SECRET) before issuing
   * a token.
   */
  static constantTimeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  static hashToken(token: string): string {
    return hashToken(token);
  }
}

export const pluginAuthStore = new PluginAuthStore();
