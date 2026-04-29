/**
 * Readiness state for the bot's "fully booted" signal.
 *
 * Liveness ("am I still alive?") is trivially true if the process can
 * answer an HTTP request — checked by /api/health/live.
 *
 * Readiness ("am I ready to serve real traffic?") is gated on three
 * boot-phase signals:
 *   - migrations:  schema migrations finished
 *   - db:          sequelize can authenticate (cheap roundtrip)
 *   - bot:         Discord client emitted 'ready' (gateway up,
 *                  guild snapshot fetched)
 *
 * Each signal is set once during boot. Readiness probes
 * (/api/health/ready and /api/health for backwards compatibility)
 * return 503 until all three flip true. This lets sibling containers
 * use `depends_on: { condition: service_healthy }` and trust that
 * the bot is genuinely ready to handle their requests.
 */

export type ReadinessSignal = "migrations" | "db" | "bot";

const state: Record<ReadinessSignal, boolean> = {
  migrations: false,
  db: false,
  bot: false,
};

export function setReady(signal: ReadinessSignal, value: boolean): void {
  state[signal] = value;
}

export function getReadiness(): {
  migrations: boolean;
  db: boolean;
  bot: boolean;
  ready: boolean;
} {
  return {
    migrations: state.migrations,
    db: state.db,
    bot: state.bot,
    ready: state.migrations && state.db && state.bot,
  };
}
