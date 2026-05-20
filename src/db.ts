import { Sequelize, Transaction } from "sequelize";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = resolve(dirname(__dirname), "../data/database.sqlite");

export const sequelize = new Sequelize({
  storage: config.db.sqlitePath ?? DEFAULT_DB_PATH,
  dialect: "sqlite",
  logging: false,
  // BEGIN IMMEDIATE for every managed transaction. SQLite's default
  // DEFERRED takes the write lock lazily, so a transaction that reads
  // then writes — e.g. Sequelize `findOrCreate` — can deadlock a
  // concurrent one: both hold SHARED, both fail to upgrade, and
  // `busy_timeout` can't help because waiting would deadlock, so it
  // surfaces SQLITE_BUSY immediately. IMMEDIATE grabs the write lock
  // up front, so concurrent writers queue on busy_timeout instead.
  transactionType: Transaction.TYPES.IMMEDIATE,
  // SQLite needs per-connection PRAGMA tuning that doesn't survive the
  // raw open. afterConnect runs once per underlying connection in the
  // pool — single-connection today, but the hook is also correct for
  // any future pool expansion.
  //   foreign_keys = ON    : enforce FK constraints (off by default)
  //   journal_mode = WAL   : concurrent reader + single writer instead
  //                          of full-DB lock; massively reduces SQLITE_BUSY
  //                          when SSE handlers race audit writes.
  //   busy_timeout = 3000  : when a writer collides anyway, wait up to
  //                          3s for the lock instead of immediately
  //                          surfacing SQLITE_BUSY to the caller. The
  //                          default is 0 (fail instantly).
  hooks: {
    afterConnect: async (connection: unknown) => {
      const conn = connection as {
        run?: (sql: string, cb?: (err: Error | null) => void) => void;
      };
      if (typeof conn.run !== "function") return;
      const exec = (sql: string) =>
        new Promise<void>((resolveHook, reject) => {
          conn.run!(sql, (err) => (err ? reject(err) : resolveHook()));
        });
      await exec("PRAGMA foreign_keys = ON;");
      await exec("PRAGMA journal_mode = WAL;");
      await exec("PRAGMA busy_timeout = 3000;");
      await exec("PRAGMA synchronous = NORMAL;");
    },
  },
});

/**
 * Retry a DB operation that still surfaces SQLITE_BUSY. With WAL +
 * busy_timeout + IMMEDIATE transactions a genuine BUSY is rare — only
 * a writer holding the lock past busy_timeout produces one — so this
 * is the last line of defence for writes that must not be silently
 * dropped (e.g. plugin-capability reconcile on concurrent register).
 */
export async function withBusyRetry<T>(
  op: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      const text =
        err instanceof Error
          ? `${err.message} ${(err as { parent?: Error }).parent?.message ?? ""}`
          : String(err);
      const busy =
        text.includes("SQLITE_BUSY") || text.includes("database is locked");
      if (!busy || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}
