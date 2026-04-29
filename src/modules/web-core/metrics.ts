/**
 * Prometheus metrics registry for the bot.
 *
 * Exposed at /api/metrics (auth-bypassed, scrape from internal network
 * only — assume the LB / firewall blocks public access). Default
 * Node.js metrics (process_cpu_seconds, nodejs_eventloop_lag, heap)
 * are always on; business metrics are added incrementally as they
 * justify the cardinality.
 *
 * Cardinality discipline: never label by user id, guild id, channel
 * id, or message id — those are unbounded and explode Prom
 * storage. Path-template labels (e.g. /api/guilds/:guildId/...) are
 * fine because they're bounded by the route table.
 */
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import type { Client } from "discord.js";
import { dmEventBus } from "../dm-inbox/dm-event-bus.js";
import { guildChannelEventBus } from "../guild-management/guild-channel-event-bus.js";
import { pluginRegistry } from "../plugin-system/plugin-registry.service.js";

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
  prefix: "karyl_",
});

// HTTP request counter — labelled by method + status + matched route
// template (Fastify exposes request.routerPath / request.routeOptions.url).
export const httpRequestsTotal = new Counter({
  name: "karyl_http_requests_total",
  help: "Total HTTP requests handled by Fastify",
  labelNames: ["method", "status_code", "route"] as const,
  registers: [metricsRegistry],
});

export const httpRequestDuration = new Histogram({
  name: "karyl_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "status_code", "route"] as const,
  // Buckets tuned for an admin/bot-internal API: most requests should
  // be sub-100ms; anything past 1s is interesting.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

// Plugin event dispatch counter — counts every fanout from
// plugin-event-bridge to a plugin endpoint. Labelled by event_type
// only (plugin_id is unbounded as plugins can register / unregister
// freely; would explode cardinality).
export const pluginEventDispatchTotal = new Counter({
  name: "karyl_plugin_event_dispatch_total",
  help: "Plugin event dispatches fanned out from plugin-event-bridge",
  labelNames: ["event_type", "outcome"] as const,
  registers: [metricsRegistry],
});

// Audit log write counter — admin actions written to admin_audit_log.
// Labelled by action category (canonical token like 'admin.create').
export const auditLogWritesTotal = new Counter({
  name: "karyl_audit_log_writes_total",
  help: "Admin audit log entries written",
  labelNames: ["action"] as const,
  registers: [metricsRegistry],
});

// Bot event log write counter — labelled by level + category. Mirrors
// botEventLog.record(level, category, ...) without echoing the message.
export const botEventLogWritesTotal = new Counter({
  name: "karyl_bot_event_log_writes_total",
  help: "Structured bot event log entries written",
  labelNames: ["level", "category"] as const,
  registers: [metricsRegistry],
});

// Gauges read at scrape time via collect() callbacks so we never
// double-write or drift.
let botRef: Client | null = null;

export function setMetricsBotClient(bot: Client): void {
  botRef = bot;
}

new Gauge({
  name: "karyl_bot_guild_count",
  help: "Number of guilds the bot is currently in",
  registers: [metricsRegistry],
  collect() {
    this.set(botRef?.guilds.cache.size ?? 0);
  },
});

new Gauge({
  name: "karyl_bot_user_cache_size",
  help: "Number of users currently in the bot's user cache",
  registers: [metricsRegistry],
  collect() {
    this.set(botRef?.users.cache.size ?? 0);
  },
});

new Gauge({
  name: "karyl_dm_sse_connections",
  help: "Active DM event-bus subscribers (SSE connections + others)",
  registers: [metricsRegistry],
  collect() {
    // EventEmitter exposes listenerCount; dm-event-bus uses 'event'
    // as its single channel.
    const count = (dmEventBus as unknown as { emitter?: { listenerCount: (e: string) => number } })
      .emitter?.listenerCount("event") ?? 0;
    this.set(count);
  },
});

new Gauge({
  name: "karyl_guild_channel_sse_connections",
  help: "Active guild-channel event-bus subscribers",
  registers: [metricsRegistry],
  collect() {
    const count = (guildChannelEventBus as unknown as { emitter?: { listenerCount: (e: string) => number } })
      .emitter?.listenerCount("event") ?? 0;
    this.set(count);
  },
});

new Gauge({
  name: "karyl_plugin_active_count",
  help: "Plugins currently registered and (best-effort) alive",
  registers: [metricsRegistry],
  async collect() {
    try {
      const list = await pluginRegistry.list();
      const active = list.filter((p) => p.status === "active").length;
      this.set(active);
    } catch {
      this.set(0);
    }
  },
});
