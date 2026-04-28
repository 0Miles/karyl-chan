import type { Migration } from "./runner.js";

/**
 * Add `webhookSecret` to the `behaviors` table for HMAC signing /
 * verification of the webhook round-trip:
 *
 *   - Outbound: when set, the bot signs each POST so the receiving
 *     server can verify the request actually came from this bot.
 *   - Inbound:  when set, the bot expects the webhook's response to
 *     carry a matching signature header — without it the relay drops
 *     and the dispatch is treated as failed.
 *
 * NULL means "no signing/verification" — older rows keep working with
 * the unauthenticated round-trip they've been using.
 *
 * Idempotent: skips when the column already exists, so re-running
 * after a sync()'d add is a no-op.
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tableInfo = (await queryInterface
      .describeTable("behaviors")
      .catch(() => null)) as Record<string, unknown> | null;
    if (!tableInfo) return;
    if (Object.prototype.hasOwnProperty.call(tableInfo, "webhookSecret"))
      return;
    await queryInterface.sequelize.query(`
      ALTER TABLE behaviors ADD COLUMN webhookSecret TEXT NULL;
    `);
  },

  down: async ({ queryInterface }) => {
    // SQLite did not support DROP COLUMN until 3.35; the project's
    // current builds do, but DROP is destructive and we don't gain
    // anything by reversing this exactly. Leave the column in place
    // on rollback — keeping a NULL column is forward-compatible with
    // the prior code path.
    await queryInterface.sequelize.query(
      `-- intentional no-op: webhookSecret remains in place on rollback`,
    );
  },
};

export default migration;
