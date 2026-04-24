import { Sequelize } from 'sequelize';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = resolve(dirname(__dirname), '../data/database.sqlite');

export const sequelize = new Sequelize({
    storage: process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH,
    dialect: 'sqlite',
    logging: false,
    // SQLite enforces FK constraints only when the connection has the
    // PRAGMA set. afterConnect runs once per underlying connection in the
    // pool, covering the standard single-connection SQLite case plus any
    // future pool expansion.
    hooks: {
        afterConnect: async (connection: unknown) => {
            const conn = connection as { run?: (sql: string, cb?: (err: Error | null) => void) => void };
            if (typeof conn.run === 'function') {
                await new Promise<void>((resolveHook, reject) => {
                    conn.run!('PRAGMA foreign_keys = ON;', (err) => err ? reject(err) : resolveHook());
                });
            }
        }
    }
});
