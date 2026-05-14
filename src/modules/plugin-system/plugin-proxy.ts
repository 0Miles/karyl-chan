import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyReplyFrom from "@fastify/reply-from";
import { findPluginByKey } from "./models/plugin.model.js";
import {
  assertPluginTarget,
  HostPolicyError,
} from "../../utils/host-policy.js";

/** Regex that matches valid pluginKey values (same constraint as plugin.id at register time). */
const PLUGIN_KEY_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Register the `/plugin/<pluginKey>/*` reverse proxy.
 *
 * Design decisions:
 *
 * Upstream resolution: per-request, using `findPluginByKey` against the DB.
 * The plugin row must exist and `status === 'active'`. The `enabled` flag is
 * intentionally ignored here — `enabled` gates Discord command/event dispatch,
 * NOT the plugin's own HTTP surface; an admin may want to view a disabled
 * plugin's WebUI without re-enabling its Discord commands.
 *
 * Auth: /plugin/* is intentionally NOT behind the bot's admin auth hook.
 * The plugin does its own `plugin-session` JWT check; the Discord `?token=`
 * link lands here without a bot login session and must reach the plugin
 * server as-is. The global onRequest hook in server.ts only gates `/api/*`,
 * so /plugin/* is already unguarded at the hook level.
 *
 * Proxy approach: hand-rolled `server.all` + `@fastify/reply-from`. The
 * `@fastify/http-proxy` `getUpstream` option would be cleaner but requires
 * the upstream to be deterministic at plugin-register time. Here we need a
 * per-request async DB lookup, which `reply.from()` supports naturally when
 * called manually inside a route handler.
 *
 * Helmet / CSP: @fastify/helmet is wrapped with fastify-plugin so its
 * onRequest hooks propagate to the entire root scope, including /plugin/*.
 * Helmet's security headers (including Content-Security-Policy) ARE applied
 * to every /plugin/* response. However, @fastify/reply-from copies the
 * upstream response headers (including any CSP the upstream sends) back to
 * the client — when the upstream sends a CSP header it overwrites helmet's.
 * Plugin WebUIs MUST therefore send their own Content-Security-Policy; a
 * plugin that sends no CSP will be served with the bot's strict default CSP,
 * which will block most inline scripts and styles.
 *
 * Body / multipart: the proxy is registered inside an encapsulated scope
 * (see server.ts — `server.register(async (instance) => { registerPluginProxy(instance) })`).
 * A catch-all content-type parser (`'*'`) is registered on that encapsulated
 * instance, so the globally-registered @fastify/multipart parser (which
 * consumes multipart/form-data bodies and would otherwise empty them before
 * the proxy could forward them) is overridden within the proxy scope only.
 * Bodies are buffered as Buffer before forwarding — safe for the proxy's
 * upload payloads (radio cover-art is <=25 MiB, already enforced by the
 * bodyLimit Fastify option). The root scope's @fastify/multipart is
 * unaffected and continues to parse multipart bodies for /api/* routes.
 *
 * SSRF: the upstream URL is re-vetted via `assertPluginTarget()` on every
 * proxied request, mirroring the per-call pattern used in
 * plugin-interaction-dispatch.service.ts and plugin-event-bridge.service.ts.
 * This prevents a plugin operator from repointing the plugin's DNS after
 * registration to redirect the anonymous-accessible proxy to an internal
 * target. On policy violation the proxy returns 502 and does not connect.
 *
 * Header hygiene: hop-by-hop and sensitive forwarding headers are stripped
 * and replaced with canonical values before the request is forwarded. Any
 * set-cookie headers in the upstream response have their Path rewritten to
 * the plugin's proxy prefix and their Domain attribute stripped, so a plugin
 * cannot set cookies on the bot's root domain.
 *
 * SSE / WebSocket: long-lived text/event-stream responses will hit the
 * 30-second upstream timeout and be dropped. WebSocket Upgrade requests are
 * not proxied by @fastify/reply-from — a future plugin needing real-time
 * transport would require the proxy to be extended.
 */
export async function registerPluginProxy(
  server: FastifyInstance,
): Promise<void> {
  // Override any globally-registered content-type parser (including the
  // @fastify/multipart parser registered at the root scope) within this
  // encapsulated instance. Buffer the body so @fastify/reply-from can
  // forward it intact, regardless of Content-Type.
  server.addContentTypeParser(
    "*",
    { parseAs: "buffer" },
    (
      _req: FastifyRequest,
      payload: Buffer,
      done: (err: null, body: Buffer) => void,
    ) => {
      done(null, payload);
    },
  );

  // Register @fastify/reply-from without a base URL so that `reply.from()`
  // accepts fully-qualified upstream URLs constructed per-request.
  await server.register(fastifyReplyFrom, {
    disableRequestLogging: true,
  });

  // Redirect bare /plugin/:pluginKey (no trailing slash) to /plugin/:pluginKey/
  // so the plugin WebUI always loads under a canonical prefix.
  server.get<{ Params: { pluginKey: string } }>(
    "/plugin/:pluginKey",
    async (request, reply) => {
      const { pluginKey } = request.params;
      // Reject invalid key format immediately — prevents CRLF/odd chars from
      // reaching the Location header.
      if (!PLUGIN_KEY_RE.test(pluginKey)) {
        reply.code(404).send({ error: "unknown plugin" });
        return;
      }
      // Take the raw suffix from request.raw.url to preserve the original
      // query string exactly as received (no double-decoding).
      const prefix = "/plugin/" + pluginKey;
      const rest = (request.raw.url ?? "").slice(prefix.length); // "?tab=queue" or ""
      const qs = rest.startsWith("?") ? rest : "";
      reply.redirect(`/plugin/${pluginKey}/${qs}`, 301);
    },
  );

  // Proxy all methods on /plugin/:pluginKey/* to the plugin's stored URL,
  // stripping the /plugin/:pluginKey prefix from the forwarded path.
  //
  // Example: GET /plugin/karyl-radio/dashboard?tab=queue
  //  => plugin.url = "http://karyl-radio-plugin:3000"
  //  => forwards to http://karyl-radio-plugin:3000/dashboard?tab=queue
  server.all<{ Params: { pluginKey: string; "*": string } }>(
    "/plugin/:pluginKey/*",
    async (request, reply) => {
      const { pluginKey } = request.params;

      // Reject invalid key format immediately — prevents CRLF/odd chars from
      // reaching the DB lookup or any downstream header.
      if (!PLUGIN_KEY_RE.test(pluginKey)) {
        reply.code(404).send({ error: "unknown plugin" });
        return;
      }

      const plugin = await findPluginByKey(pluginKey);
      if (!plugin || plugin.status !== "active") {
        reply.code(404).send({ error: "unknown plugin" });
        return;
      }

      // Re-vet the upstream URL on every request. `plugin.url` may have been
      // valid at register time, but a plugin operator who repoints DNS
      // afterwards could redirect the anonymous-accessible proxy to an
      // internal target. This mirrors the per-call pattern in
      // plugin-interaction-dispatch.service.ts and plugin-event-bridge.service.ts.
      const parsedUrl = new URL(plugin.url);
      const upstreamPort = parsedUrl.port
        ? Number(parsedUrl.port)
        : parsedUrl.protocol === "https:"
          ? 443
          : 80;
      try {
        await assertPluginTarget(parsedUrl.hostname, upstreamPort);
      } catch (err) {
        if (err instanceof HostPolicyError) {
          reply.code(502).send({ error: "plugin target not allowed" });
          return;
        }
        throw err;
      }

      // Take the raw suffix directly from the raw request URL so that
      // percent-encoded characters and query strings are preserved exactly
      // as received — request.params["*"] is already URL-decoded by
      // find-my-way and would cause double-decode issues for paths containing
      // '%' or encoded '?'.
      const prefix = "/plugin/" + pluginKey;
      const rest = (request.raw.url ?? "/").slice(prefix.length) || "/";
      // rest starts with '/' and includes the undecoded path + query string.

      const target = plugin.url.replace(/\/+$/, "") + rest;

      return reply.from(target, {
        timeout: 30_000,

        rewriteRequestHeaders(_originalReq, headers) {
          // Strip hop-by-hop and trust-sensitive forwarding headers so a
          // downstream plugin cannot spoof the bot's forwarding chain or
          // observe session cookies from the bot's domain.
          delete headers["x-forwarded-for"];
          delete headers["x-forwarded-host"];
          delete headers["x-forwarded-proto"];
          delete headers["forwarded"];
          delete headers["x-real-ip"];
          delete headers["cookie"];
          // @fastify/reply-from hands us a content-type with media-type
          // parameters stripped (e.g. "multipart/form-data" without the
          // ; boundary=... part). Plugins that parse multipart uploads
          // (fastify-multipart's request.file()) need the boundary, so
          // restore the original header verbatim before forwarding.
          const originalCt = request.headers["content-type"];
          if (typeof originalCt === "string" && originalCt.length > 0) {
            headers["content-type"] = originalCt;
          }
          // Set canonical forwarding headers for the upstream. Authorization
          // is kept — a plugin may use it for its own API.
          headers["x-forwarded-for"] = request.ip;
          headers["x-forwarded-proto"] = request.protocol;
          headers["x-forwarded-host"] = request.headers.host ?? "";
          return headers;
        },

        rewriteHeaders(headers) {
          // Rewrite set-cookie headers from the upstream so a plugin cannot
          // set cookies on the bot's root domain. Path is scoped to the
          // plugin's proxy prefix; Domain attribute is stripped entirely.
          const setCookie = headers["set-cookie"];
          if (setCookie) {
            const rewrite = (c: string) =>
              c
                // Remove any existing Path= attribute.
                .replace(/;\s*Path=[^;]*/gi, "")
                // Strip Domain= so the cookie is scoped to the current host only.
                .replace(/;\s*Domain=[^;]*/gi, "") +
              `; Path=/plugin/${pluginKey}/`;
            const rawValues = Array.isArray(setCookie)
              ? setCookie
              : [setCookie as string];
            headers["set-cookie"] = rawValues.map(rewrite);
          }
          return headers;
        },

        onError(reply, { error }) {
          (reply.log ?? server.log).warn(
            { err: error, pluginKey },
            "plugin proxy upstream error",
          );
          reply.code(502).send({ error: "plugin unreachable" });
        },
      });
    },
  );
}
