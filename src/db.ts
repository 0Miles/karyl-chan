import { Sequelize } from "sequelize";
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
