import type { FastifyInstance } from "fastify";
import { requireGuildCapability } from "../web-core/route-guards.js";
import { isSnowflake } from "../web-core/validators.js";
import type { GuildManagementRoutesOptions } from "./guild-management-shared.js";

// ── AutoMod helpers ───────────────────────────────────────────────────

interface AutoModRuleBody {
  name?: unknown;
  enabled?: unknown;
  eventType?: unknown; // discord.js AutoModerationRuleEventType (1 = MessageSend)
  triggerType?: unknown; // 1=Keyword, 3=Spam, 4=KeywordPreset, 5=MentionSpam, 6=MemberProfile
  triggerMetadata?: {
    keywordFilter?: unknown; // string[]
    regexPatterns?: unknown; // string[]
    presets?: unknown; // number[] (1=Profanity, 2=SexualContent, 3=Slurs)
    allowList?: unknown; // string[]
    mentionTotalLimit?: unknown; // number
    mentionRaidProtectionEnabled?: unknown; // boolean
  };
  actions?: unknown; // array of { type, metadata? }
  exemptRoles?: unknown; // string[]
  exemptChannels?: unknown; // string[]
  reason?: unknown;
}

function asStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.filter((s): s is string => typeof s === "string");
}
function asNumberArray(input: unknown): number[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n),
  );
}

function parseAutoModBody(
  body: AutoModRuleBody,
  partial = false,
): { value: Record<string, unknown> } | { error: string } {
  const out: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim())
    out.name = body.name.slice(0, 100);
  else if (!partial) return { error: "name required" };
  if (typeof body.enabled === "boolean") out.enabled = body.enabled;
  if (typeof body.eventType === "number" && Number.isFinite(body.eventType))
    out.eventType = body.eventType;
  else if (!partial) out.eventType = 1; // MessageSend
  if (typeof body.triggerType === "number" && Number.isFinite(body.triggerType))
    out.triggerType = body.triggerType;
  else if (!partial) return { error: "triggerType required" };
  if (body.triggerMetadata) {
    const meta: Record<string, unknown> = {};
    const m = body.triggerMetadata;
    const kw = asStringArray(m.keywordFilter);
    if (kw) meta.keywordFilter = kw;
    const re = asStringArray(m.regexPatterns);
    if (re) meta.regexPatterns = re;
    const pr = asNumberArray(m.presets);
    if (pr) meta.presets = pr;
    const al = asStringArray(m.allowList);
    if (al) meta.allowList = al;
    if (typeof m.mentionTotalLimit === "number")
      meta.mentionTotalLimit = m.mentionTotalLimit;
    if (typeof m.mentionRaidProtectionEnabled === "boolean")
      meta.mentionRaidProtectionEnabled = m.mentionRaidProtectionEnabled;
    if (Object.keys(meta).length > 0) out.triggerMetadata = meta;
  }
  if (Array.isArray(body.actions)) {
    const actions = (
      body.actions as Array<{
        type?: unknown;
        metadata?: Record<string, unknown>;
      }>
    )
      .filter((a) => typeof a.type === "number" && Number.isFinite(a.type))
      .map((a) => ({ type: a.type as number, metadata: a.metadata }));
    if (actions.length > 0) out.actions = actions;
  } else if (!partial) {
    return { error: "actions required (1+ entry)" };
  }
  const exemptRoles = asStringArray(body.exemptRoles);
  if (exemptRoles) out.exemptRoles = exemptRoles;
  const exemptChannels = asStringArray(body.exemptChannels);
  if (exemptChannels) out.exemptChannels = exemptChannels;
  if (typeof body.reason === "string") out.reason = body.reason;
  return { value: out };
}

function serializeAutoModRule(rule: import("discord.js").AutoModerationRule) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    eventType: Number(rule.eventType),
    triggerType: Number(rule.triggerType),
    triggerMetadata: {
      keywordFilter: rule.triggerMetadata.keywordFilter,
      regexPatterns: rule.triggerMetadata.regexPatterns,
      presets: rule.triggerMetadata.presets.map((p) => Number(p)),
      allowList: rule.triggerMetadata.allowList,
      mentionTotalLimit: rule.triggerMetadata.mentionTotalLimit,
      mentionRaidProtectionEnabled:
        rule.triggerMetadata.mentionRaidProtectionEnabled,
    },
    actions: rule.actions.map((a) => ({
      type: Number(a.type),
      metadata: a.metadata,
    })),
    exemptRoles: [...rule.exemptRoles.keys()],
    exemptChannels: [...rule.exemptChannels.keys()],
    creatorId: rule.creatorId,
  };
}

export async function registerGuildAutomodRoutes(
  server: FastifyInstance,
  options: GuildManagementRoutesOptions,
): Promise<void> {
  const { bot } = options;

  // ── AutoMod rules ──────────────────────────────────────────────────

  server.get<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId/automod/rules",
    async (request, reply) => {
      if (
        !requireGuildCapability(
          request,
          reply,
          request.params.guildId,
          "manage",
        )
      )
        return;
      const guild = bot.guilds.cache.get(request.params.guildId);
      if (!guild) {
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      try {
        const rules = await guild.autoModerationRules.fetch();
        return { rules: [...rules.values()].map(serializeAutoModRule) };
      } catch (err) {
        request.log.error({ err }, "failed to list automod rules");
        reply.code(502).send({ error: "Failed to list AutoMod rules" });
      }
    },
  );

  server.post<{ Params: { guildId: string }; Body: AutoModRuleBody }>(
    "/api/guilds/:guildId/automod/rules",
    async (request, reply) => {
      if (
        !requireGuildCapability(
          request,
          reply,
          request.params.guildId,
          "manage",
        )
      )
        return;
      const guild = bot.guilds.cache.get(request.params.guildId);
      if (!guild) {
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      const opts = parseAutoModBody(request.body ?? {});
      if ("error" in opts) {
        reply.code(400).send({ error: opts.error });
        return;
      }
      try {
        const rule = await guild.autoModerationRules.create(
          opts.value as unknown as Parameters<
            typeof guild.autoModerationRules.create
          >[0],
        );
        return { rule: serializeAutoModRule(rule) };
      } catch (err) {
        request.log.error({ err }, "failed to create automod rule");
        reply.code(502).send({ error: "Failed to create AutoMod rule" });
      }
    },
  );

  server.patch<{
    Params: { guildId: string; ruleId: string };
    Body: AutoModRuleBody;
  }>("/api/guilds/:guildId/automod/rules/:ruleId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, ruleId } = request.params;
    if (!isSnowflake(ruleId)) {
      reply.code(400).send({ error: "invalid ruleId" });
      return;
    }
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const opts = parseAutoModBody(request.body ?? {}, true);
    if ("error" in opts) {
      reply.code(400).send({ error: opts.error });
      return;
    }
    try {
      const rule = await guild.autoModerationRules.edit(
        ruleId,
        opts.value as Parameters<typeof guild.autoModerationRules.edit>[1],
      );
      return { rule: serializeAutoModRule(rule) };
    } catch (err) {
      request.log.error({ err }, "failed to edit automod rule");
      reply.code(502).send({ error: "Failed to edit AutoMod rule" });
    }
  });

  server.delete<{
    Params: { guildId: string; ruleId: string };
    Body: { reason?: unknown };
  }>("/api/guilds/:guildId/automod/rules/:ruleId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, ruleId } = request.params;
    if (!isSnowflake(ruleId)) {
      reply.code(400).send({ error: "invalid ruleId" });
      return;
    }
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const reason =
      typeof request.body?.reason === "string"
        ? request.body.reason
        : undefined;
    try {
      await guild.autoModerationRules.delete(ruleId, reason);
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to delete automod rule");
      reply.code(502).send({ error: "Failed to delete AutoMod rule" });
    }
  });
}
