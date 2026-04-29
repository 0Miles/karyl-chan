import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { Umzug, SequelizeStorage, type MigrationMeta } from "umzug";
import { QueryInterface, Sequelize } from "sequelize";
import { sequelize } from "../db.js";

/**
 * Sequelize's `sync()` won't alter existing tables, so post-bootstrap
 * schema changes need a real migration framework. Umzug is the
 * sequelize-flavored choice: runs ordered files, tracks applied ones
 * in a `SequelizeMeta` table, supports forward + rollback.
 *
 * Migration files live beside this runner and must export `up(qi)` and
 * `down(qi)` default members. Ordering is by filename — prefix with a
 * UTC timestamp `YYYYMMDDHHMMSS-describe.ts` so history stays linear.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Migration {
  up(context: {
    queryInterface: QueryInterface;
    sequelize: Sequelize;
  }): Promise<void>;
  down(context: {
    queryInterface: QueryInterface;
    sequelize: Sequelize;
  }): Promise<void>;
}

export function createMigrator(): Umzug<{
  queryInterface: QueryInterface;
  sequelize: Sequelize;
}> {
  return new Umzug({
    migrations: {
      // .ts when running via ts-node (dev), .js when running the
      // compiled build/ output (prod). Accept both so `npm run dev`
      // and `npm run serve` behave identically.
      glob: [
        resolve(__dirname, "*.{ts,js}"),
        { ignore: [resolve(__dirname, "runner.*")] },
      ],
      resolve: ({ name, path: migrationPath, context }) => {
        if (!migrationPath) throw new Error(`migration ${name} has no path`);
        return {
          name,
          up: async () => {
            const mod = (await import(migrationPath)) as {
              default?: Migration;
            } & Partial<Migration>;
            const migration = mod.default ?? (mod as Migration);
            await migration.up(context);
          },
          down: async () => {
            const mod = (await import(migrationPath)) as {
              default?: Migration;
            } & Partial<Migration>;
            const migration = mod.default ?? (mod as Migration);
            await migration.down(context);
          },
        };
      },
    },
    context: {
      queryInterface: sequelize.getQueryInterface(),
      sequelize,
    },
    storage: new SequelizeStorage({ sequelize, tableName: "sequelize_meta" }),
    logger: console,
  });
}

export async function runPendingMigrations(): Promise<MigrationMeta[]> {
  const migrator = createMigrator();
  return migrator.up();
}
