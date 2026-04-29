import pino, { type Logger } from "pino";
import { config } from "./config.js";

const isDev = config.env !== "production";

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  // pino-pretty in dev for human-readable output, raw JSON in prod for
  // log aggregators. The transport forks a worker thread in dev so the
  // main event loop isn't blocked by pretty-printing.
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

/**
 * Return a child logger bound to a module label. Each module creates one
 * at module-top-level:
 *
 *   const log = moduleLogger("rcon-connection");
 *
 * so all logs from that module carry `{ module: "rcon-connection" }` as a
 * structured field without repeating it at every callsite.
 */
export function moduleLogger(name: string): Logger {
  return logger.child({ module: name });
}
