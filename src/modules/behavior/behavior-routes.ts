import type { FastifyInstance } from "fastify";
import { isBoundedString, isNonEmptyString } from "../web-core/validators.js";
import { recordAudit } from "../admin/admin-audit.service.js";
import { encryptSecret } from "../../utils/crypto.js";
import {
  ALL_DMS_TARGET_ID,
  findBehaviorTargetById,
} from "./models/behavior-target.model.js";
import {
  createBehavior,
  deleteBehavior,
  findBehaviorById,
  findBehaviorsByTarget,
  reorderBehaviors,
  updateBehavior,
  type BehaviorForwardType,
  type BehaviorTriggerType,
} from "./models/behavior.model.js";
import { endSessionsForBehavior } from "./models/behavior-session.model.js";
import { findPluginById } from "../plugin-system/models/plugin.model.js";
import type { PluginManifest } from "../plugin-system/plugin-registry.service.js";
import {
  type BehaviorRoutesOptions,
  createResyncSlash,
  decryptedView,
  isValidRegex,
  isValidWebhookUrl,
  requireBehaviorTarget,
} from "./behavior-helpers.js";
import { registerBehaviorTargetRoutes } from "./target-routes.js";
import { registerBehaviorGroupMemberRoutes } from "./group-member-routes.js";

export type { BehaviorRoutesOptions };

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const TRIGGER_VALUE_MAX = 2000;
const WEBHOOK_URL_MAX = 1000;
const WEBHOOK_SECRET_MAX = 200;

const TRIGGER_TYPES: BehaviorTriggerType[] = [
  "startswith",
  "endswith",
  "regex",
  "slash_command",
];
const FORWARD_TYPES: BehaviorForwardType[] = ["one_time", "continuous"];

export async function registerBehaviorRoutes(
  server: FastifyInstance,
  options: BehaviorRoutesOptions = {},
): Promise<void> {
  const { bot } = options;

  await registerBehaviorTargetRoutes(server, options);
  await registerBehaviorGroupMemberRoutes(server, options);

  const resyncSlash = createResyncSlash(bot);

  // ───────────────────────── behaviors ─────────────────────────

  server.get<{ Params: { id: string } }>(
    "/api/behaviors/targets/:id/behaviors",
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      if (!requireBehaviorTarget(request, reply, id)) return;
      const target = await findBehaviorTargetById(id);
      if (!target) {
        reply.code(404).send({ error: "target not found" });
        return;
      }
      const rows = await findBehaviorsByTarget(id);
      return { behaviors: rows.map(decryptedView) };
    },
  );

  server.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/behaviors/targets/:id/behaviors",
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      if (!requireBehaviorTarget(request, reply, id)) return;
      const target = await findBehaviorTargetById(id);
      if (!target) {
        reply.code(404).send({ error: "target not found" });
        return;
      }
      const body = request.body ?? {};
      const title = body.title;
      const description = body.description;
      const triggerType = body.triggerType;
      const triggerValue = body.triggerValue;
      const forwardType = body.forwardType;
      const webhookUrl = body.webhookUrl;
      const webhookSecret = body.webhookSecret;
      const stopOnMatch = body.stopOnMatch;
      const enabled = body.enabled;
      // Plugin discriminator. Default 'webhook' keeps every existing
      // create-call working. type='plugin' switches the dispatch path
      // and ignores webhookUrl/webhookSecret in favour of pluginId +
      // pluginBehaviorKey.
      const rawType = body.type;
      const behaviorType: "webhook" | "plugin" =
        rawType === "plugin" ? "plugin" : "webhook";
      const pluginIdInput = body.pluginId;
      const pluginBehaviorKeyInput = body.pluginBehaviorKey;

      if (!isBoundedString(title, TITLE_MAX)) {
        reply
          .code(400)
          .send({ error: `title required (max ${TITLE_MAX} chars)` });
        return;
      }
      if (
        description !== undefined &&
        (typeof description !== "string" ||
          description.length > DESCRIPTION_MAX)
      ) {
        reply
          .code(400)
          .send({ error: `description max ${DESCRIPTION_MAX} chars` });
        return;
      }
      if (
        typeof triggerType !== "string" ||
        !TRIGGER_TYPES.includes(triggerType as BehaviorTriggerType)
      ) {
        reply.code(400).send({
          error: `triggerType must be one of ${TRIGGER_TYPES.join("|")}`,
        });
        return;
      }
      if (!isBoundedString(triggerValue, TRIGGER_VALUE_MAX)) {
        reply.code(400).send({
          error: `triggerValue required (max ${TRIGGER_VALUE_MAX} chars)`,
        });
        return;
      }
      if (triggerType === "regex" && !isValidRegex(triggerValue)) {
        reply.code(400).send({ error: "triggerValue is not a valid regex" });
        return;
      }
      // Discord DM commands are inherently global — there is no API
      // for "register this DM command for a specific user only". So
      // slash_command behaviors only make sense on the all_dms target,
      // where every user seeing the command in their picker is the
      // intended audience anyway. user / group targets that would
      // create a name visible to non-target users get rejected.
      //
      // Both type='webhook' and type='plugin' are valid here. Plugin
      // routing flows through the same user-slash-behavior dispatcher
      // that webhook does — admin maps `/foo` to a plugin's existing
      // dm_behavior key, distinct from the plugin's own
      // manifest.commands[] (which register globally and run their
      // own command-payload pipeline).
      if (triggerType === "slash_command" && id !== ALL_DMS_TARGET_ID) {
        reply.code(400).send({
          error:
            "triggerType='slash_command' only valid on the all_dms target — Discord DM commands have no per-user visibility scope",
        });
        return;
      }
      if (
        typeof forwardType !== "string" ||
        !FORWARD_TYPES.includes(forwardType as BehaviorForwardType)
      ) {
        reply.code(400).send({
          error: `forwardType must be one of ${FORWARD_TYPES.join("|")}`,
        });
        return;
      }
      // Per-type validation. Webhook rows need a real URL + optional
      // HMAC secret. Plugin rows need pluginId + pluginBehaviorKey
      // and ignore webhookUrl/secret entirely (a placeholder URL is
      // synthesized to satisfy the NOT NULL column).
      let encryptedUrlField: string;
      let encryptedSecret: string | null = null;
      let resolvedPluginId: number | null = null;
      let resolvedPluginBehaviorKey: string | null = null;
      if (behaviorType === "webhook") {
        const webhookValidation =
          isNonEmptyString(webhookUrl) && webhookUrl.length <= WEBHOOK_URL_MAX
            ? await isValidWebhookUrl(webhookUrl)
            : {
                ok: false as const,
                reason: "webhookUrl required (must be a valid http/https URL)",
              };
        if (!webhookValidation.ok) {
          reply.code(400).send({
            error: webhookValidation.reason,
          });
          return;
        }
        if (typeof webhookSecret === "string" && webhookSecret.length > 0) {
          if (webhookSecret.length > WEBHOOK_SECRET_MAX) {
            reply.code(400).send({
              error: `webhookSecret max ${WEBHOOK_SECRET_MAX} chars`,
            });
            return;
          }
          encryptedSecret = encryptSecret(webhookSecret);
        }
        encryptedUrlField = encryptSecret(webhookUrl as string);
      } else {
        // type === 'plugin'
        const pluginId = Number(pluginIdInput);
        if (!Number.isInteger(pluginId) || pluginId <= 0) {
          reply.code(400).send({ error: "pluginId required for type=plugin" });
          return;
        }
        if (
          typeof pluginBehaviorKeyInput !== "string" ||
          pluginBehaviorKeyInput.length === 0 ||
          pluginBehaviorKeyInput.length > 80
        ) {
          reply
            .code(400)
            .send({ error: "pluginBehaviorKey required for type=plugin" });
          return;
        }
        // Verify the plugin exists and exposes the requested
        // dm_behavior. Do this upfront so a misconfigured behavior
        // never reaches the dispatcher.
        const plugin = await findPluginById(pluginId);
        if (!plugin) {
          reply.code(404).send({ error: `plugin id=${pluginId} not found` });
          return;
        }
        let manifest: PluginManifest | null = null;
        try {
          manifest = JSON.parse(plugin.manifestJson) as PluginManifest;
        } catch {
          /* malformed manifest — fall through to behavior_key check fail */
        }
        const declared = manifest?.dm_behaviors?.some(
          (b) => b.key === pluginBehaviorKeyInput,
        );
        if (!declared) {
          reply.code(400).send({
            error: `plugin '${plugin.pluginKey}' does not declare dm_behavior key='${pluginBehaviorKeyInput}'`,
          });
          return;
        }
        resolvedPluginId = pluginId;
        resolvedPluginBehaviorKey = pluginBehaviorKeyInput;
        // Synthesize a non-functional placeholder for the NOT NULL
        // webhookUrl column. The dispatcher reads plugins.url at
        // dispatch time and never decrypts this placeholder.
        encryptedUrlField = encryptSecret(
          `plugin://${plugin.pluginKey}/${pluginBehaviorKeyInput}`,
        );
      }
      const created = await createBehavior({
        targetId: id,
        title: title.trim(),
        description: typeof description === "string" ? description : "",
        triggerType: triggerType as BehaviorTriggerType,
        triggerValue,
        forwardType: forwardType as BehaviorForwardType,
        webhookUrl: encryptedUrlField,
        webhookSecret: encryptedSecret,
        stopOnMatch: !!stopOnMatch,
        enabled: enabled === undefined ? true : !!enabled,
        type: behaviorType,
        pluginId: resolvedPluginId,
        pluginBehaviorKey: resolvedPluginBehaviorKey,
      });
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.create",
        String(created.id),
        {
          targetId: id,
          triggerType,
          forwardType,
          stopOnMatch: !!stopOnMatch,
          signed: !!encryptedSecret,
          type: behaviorType,
          pluginId: resolvedPluginId,
          pluginBehaviorKey: resolvedPluginBehaviorKey,
        },
      );
      // A new slash_command + all_dms row needs to surface in
      // Discord — no-op for any other shape (the service walks the
      // current desired set and shrugs when nothing changed).
      if (
        created.triggerType === "slash_command" &&
        created.targetId === ALL_DMS_TARGET_ID
      ) {
        resyncSlash();
      }
      return { behavior: decryptedView(created) };
    },
  );

  server.patch<{
    Params: { behaviorId: string };
    Body: Record<string, unknown>;
  }>("/api/behaviors/behaviors/:behaviorId", async (request, reply) => {
    const behaviorId = Number(request.params.behaviorId);
    if (!Number.isInteger(behaviorId) || behaviorId <= 0) {
      reply.code(400).send({ error: "invalid behavior id" });
      return;
    }
    const existing = await findBehaviorById(behaviorId);
    if (!existing) {
      reply.code(404).send({ error: "behavior not found" });
      return;
    }
    // Scoped users may CRUD behaviors UNDER targets they have a token
    // for. The check uses the existing behavior's targetId (not the
    // body's, which is the proposed new home — that's verified
    // separately below if the move is requested).
    if (!requireBehaviorTarget(request, reply, existing.targetId)) return;

    const body = request.body ?? {};
    const update: Parameters<typeof updateBehavior>[1] = {};

    // System behaviors are bot-built-in fixtures with locked-down
    // edits: only triggerType / triggerValue may change. `enabled`
    // is locked to true — these flows (e.g. admin-login) are part of
    // bot infrastructure and disabling them would lock admins out.
    // Refuse anything else loudly so the UI's read-only fields can't
    // be bypassed by hand-crafting the patch body.
    if (existing.type === "system") {
      const allowed = new Set(["triggerType", "triggerValue"]);
      const offending = Object.keys(body).filter((k) => !allowed.has(k));
      if (offending.length > 0) {
        reply.code(400).send({
          error: `system behavior fields locked: cannot modify ${offending.join(", ")}`,
        });
        return;
      }
    }

    if (body.title !== undefined) {
      if (!isBoundedString(body.title, TITLE_MAX)) {
        reply.code(400).send({ error: `title max ${TITLE_MAX} chars` });
        return;
      }
      update.title = (body.title as string).trim();
    }
    if (body.description !== undefined) {
      if (
        typeof body.description !== "string" ||
        body.description.length > DESCRIPTION_MAX
      ) {
        reply
          .code(400)
          .send({ error: `description max ${DESCRIPTION_MAX} chars` });
        return;
      }
      update.description = body.description;
    }
    if (body.triggerType !== undefined) {
      if (
        typeof body.triggerType !== "string" ||
        !TRIGGER_TYPES.includes(body.triggerType as BehaviorTriggerType)
      ) {
        reply.code(400).send({
          error: `triggerType must be one of ${TRIGGER_TYPES.join("|")}`,
        });
        return;
      }
      update.triggerType = body.triggerType as BehaviorTriggerType;
    }
    if (body.triggerValue !== undefined) {
      if (!isBoundedString(body.triggerValue, TRIGGER_VALUE_MAX)) {
        reply
          .code(400)
          .send({ error: `triggerValue max ${TRIGGER_VALUE_MAX} chars` });
        return;
      }
      update.triggerValue = body.triggerValue as string;
    }
    // Validate regex against the resulting (post-patch) state so a
    // type-only or value-only change still gets checked.
    const finalType = (update.triggerType ??
      existing.triggerType) as BehaviorTriggerType;
    const finalValue = (update.triggerValue ?? existing.triggerValue) as string;
    if (finalType === "regex" && !isValidRegex(finalValue)) {
      reply.code(400).send({ error: "triggerValue is not a valid regex" });
      return;
    }
    // Same all_dms-only gate as POST: slash_command behaviors can't
    // sit on a user / group target because DM commands have no per-
    // user visibility on Discord's side. System rows are exempt
    // because their target is locked to all_dms anyway, and the
    // earlier system-edit allowlist already prevents targetId edits.
    const finalTargetId =
      typeof update.targetId === "number" ? update.targetId : existing.targetId;
    if (
      finalType === "slash_command" &&
      finalTargetId !== ALL_DMS_TARGET_ID &&
      existing.type !== "system"
    ) {
      reply.code(400).send({
        error:
          "triggerType='slash_command' only valid on the all_dms target — Discord DM commands have no per-user visibility scope",
      });
      return;
    }
    if (body.forwardType !== undefined) {
      if (
        typeof body.forwardType !== "string" ||
        !FORWARD_TYPES.includes(body.forwardType as BehaviorForwardType)
      ) {
        reply.code(400).send({
          error: `forwardType must be one of ${FORWARD_TYPES.join("|")}`,
        });
        return;
      }
      update.forwardType = body.forwardType as BehaviorForwardType;
    }
    if (body.webhookUrl !== undefined) {
      // URL is required on the row, so no "clear" semantics —
      // only "set to a new value". Empty string is rejected;
      // omit the field to leave it untouched.
      const patchWebhookValidation =
        typeof body.webhookUrl === "string" &&
        body.webhookUrl.length > 0 &&
        body.webhookUrl.length <= WEBHOOK_URL_MAX
          ? await isValidWebhookUrl(body.webhookUrl)
          : {
              ok: false as const,
              reason: "webhookUrl must be a valid http/https URL",
            };
      if (!patchWebhookValidation.ok) {
        reply.code(400).send({ error: patchWebhookValidation.reason });
        return;
      }
      update.webhookUrl = encryptSecret(body.webhookUrl as string);
    }
    if (body.webhookSecret !== undefined) {
      // null OR empty string = clear the secret (disable signing).
      // Non-empty string = encrypt + set. Field omitted = no change.
      if (body.webhookSecret === null || body.webhookSecret === "") {
        update.webhookSecret = null;
      } else if (
        typeof body.webhookSecret === "string" &&
        body.webhookSecret.length <= WEBHOOK_SECRET_MAX
      ) {
        update.webhookSecret = encryptSecret(body.webhookSecret);
      } else {
        reply
          .code(400)
          .send({ error: `webhookSecret max ${WEBHOOK_SECRET_MAX} chars` });
        return;
      }
    }
    if (body.stopOnMatch !== undefined) {
      update.stopOnMatch = !!body.stopOnMatch;
    }
    if (body.enabled !== undefined) {
      update.enabled = !!body.enabled;
    }
    if (body.targetId !== undefined) {
      const newTargetId = Number(body.targetId);
      if (!Number.isInteger(newTargetId) || newTargetId <= 0) {
        reply.code(400).send({ error: "invalid targetId" });
        return;
      }
      const newTarget = await findBehaviorTargetById(newTargetId);
      if (!newTarget) {
        reply.code(404).send({ error: "new target not found" });
        return;
      }
      // Moving a behavior requires permission on BOTH the source
      // (already checked above against existing.targetId) AND the
      // destination — otherwise a scoped user could push behaviors
      // out of their lane into one they don't manage.
      if (
        newTargetId !== existing.targetId &&
        !requireBehaviorTarget(request, reply, newTargetId)
      ) {
        return;
      }
      update.targetId = newTargetId;
    }

    // Type / plugin switch. Allowed on PATCH because the UX pattern
    // is "edit type in the card, save". When switching:
    //   webhook → plugin: clear webhookSecret, replace webhookUrl
    //                     with the placeholder, set pluginId / key
    //   plugin → webhook: clear pluginId / pluginBehaviorKey, require
    //                     a real webhookUrl (use update.webhookUrl
    //                     above), webhookSecret optional
    // We do this LAST so all other field updates above are already
    // accumulated in `update`.
    if (body.type !== undefined) {
      const nextType: "webhook" | "plugin" =
        body.type === "plugin" ? "plugin" : "webhook";
      if (nextType === "plugin") {
        const pid = Number(body.pluginId);
        if (!Number.isInteger(pid) || pid <= 0) {
          reply.code(400).send({ error: "pluginId required for type=plugin" });
          return;
        }
        const bk = body.pluginBehaviorKey;
        if (typeof bk !== "string" || bk.length === 0 || bk.length > 80) {
          reply
            .code(400)
            .send({ error: "pluginBehaviorKey required for type=plugin" });
          return;
        }
        const plugin = await findPluginById(pid);
        if (!plugin) {
          reply.code(404).send({ error: `plugin id=${pid} not found` });
          return;
        }
        let manifest: PluginManifest | null = null;
        try {
          manifest = JSON.parse(plugin.manifestJson) as PluginManifest;
        } catch {
          /* manifest parse fail → behavior_key check below fails */
        }
        if (!manifest?.dm_behaviors?.some((b) => b.key === bk)) {
          reply.code(400).send({
            error: `plugin '${plugin.pluginKey}' does not declare dm_behavior key='${bk}'`,
          });
          return;
        }
        // type=plugin + triggerType=slash_command is now allowed on
        // ALL_DMS_TARGET — the user-slash-behavior dispatcher routes
        // these through dispatchPluginDmBehavior. The all_dms-only
        // gate above (shared with the POST path) already enforces
        // the target restriction; nothing else to check here.
        update.type = "plugin";
        update.pluginId = pid;
        update.pluginBehaviorKey = bk;
        // Replace webhookUrl with a placeholder; a real URL on a
        // plugin row is dead weight and could mislead future
        // operators. webhookSecret cleared because the plugin path
        // uses KARYL_PLUGIN_SECRET, not a per-behavior secret.
        update.webhookUrl = encryptSecret(`plugin://${plugin.pluginKey}/${bk}`);
        update.webhookSecret = null;
      } else {
        // webhook: caller must supply webhookUrl (already validated
        // above if they passed body.webhookUrl). If the existing row
        // is a plugin row and they didn't pass a URL, refuse — we'd
        // be left with a "plugin://" placeholder masquerading as a
        // real webhook URL.
        if (
          existing.type === "plugin" &&
          update.webhookUrl === undefined &&
          body.webhookUrl === undefined
        ) {
          reply.code(400).send({
            error: "switching from plugin to webhook requires a webhookUrl",
          });
          return;
        }
        update.type = "webhook";
        update.pluginId = null;
        update.pluginBehaviorKey = null;
      }
    }

    const updated = await updateBehavior(behaviorId, update);
    // Editing webhookUrl / webhookSecret / target / trigger /
    // forwardType mid-stream invalidates any active continuous
    // session bound to this behavior — drop the session so the
    // user re-enters via the new flow rather than continuing to
    // feed messages into stale config (or, in the case of
    // webhookSecret, signing with a key the server no longer
    // recognises).
    if (
      update.webhookUrl !== undefined ||
      update.webhookSecret !== undefined ||
      update.targetId !== undefined ||
      update.triggerType !== undefined ||
      update.triggerValue !== undefined ||
      update.forwardType !== undefined ||
      update.enabled === false
    ) {
      await endSessionsForBehavior(behaviorId);
    }
    await recordAudit(
      request.authUserId ?? "unknown",
      "behavior.update",
      String(behaviorId),
      {
        fields: Object.keys(update),
      },
    );
    // Re-sync DM globals if the patch could plausibly touch the
    // desired set: any field on a slash_command + all_dms row
    // (triggerValue rename, enabled flip), OR a triggerType /
    // targetId edit that turns a row into / out of a slash_command +
    // all_dms shape. Cheap to over-call; the service is idempotent.
    const finalTrigger =
      (update.triggerType as BehaviorTriggerType | undefined) ??
      existing.triggerType;
    const finalTarget =
      typeof update.targetId === "number" ? update.targetId : existing.targetId;
    const wasSlashAllDms =
      existing.triggerType === "slash_command" &&
      existing.targetId === ALL_DMS_TARGET_ID;
    const isSlashAllDms =
      finalTrigger === "slash_command" && finalTarget === ALL_DMS_TARGET_ID;
    if (wasSlashAllDms || isSlashAllDms) {
      resyncSlash();
    }
    return { behavior: updated ? decryptedView(updated) : null };
  });

  server.delete<{ Params: { behaviorId: string } }>(
    "/api/behaviors/behaviors/:behaviorId",
    async (request, reply) => {
      const behaviorId = Number(request.params.behaviorId);
      if (!Number.isInteger(behaviorId) || behaviorId <= 0) {
        reply.code(400).send({ error: "invalid behavior id" });
        return;
      }
      const existing = await findBehaviorById(behaviorId);
      if (!existing) {
        reply.code(404).send({ error: "behavior not found" });
        return;
      }
      if (!requireBehaviorTarget(request, reply, existing.targetId)) return;
      if (existing.type === "system") {
        reply.code(400).send({
          error: "system behaviors cannot be deleted",
        });
        return;
      }
      await deleteBehavior(behaviorId);
      // CASCADE on behavior_sessions takes care of session cleanup,
      // but log it explicitly for the audit trail.
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.delete",
        String(behaviorId),
        {
          targetId: existing.targetId,
        },
      );
      // If the deleted row was a slash_command + all_dms behavior,
      // its global Discord command needs to come down too.
      if (
        existing.triggerType === "slash_command" &&
        existing.targetId === ALL_DMS_TARGET_ID
      ) {
        resyncSlash();
      }
      return { ok: true };
    },
  );

  server.patch<{ Params: { id: string }; Body: { orderedIds?: unknown } }>(
    "/api/behaviors/targets/:id/behaviors/reorder",
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid target id" });
        return;
      }
      if (!requireBehaviorTarget(request, reply, id)) return;
      const target = await findBehaviorTargetById(id);
      if (!target) {
        reply.code(404).send({ error: "target not found" });
        return;
      }
      const orderedIds = request.body?.orderedIds;
      if (
        !Array.isArray(orderedIds) ||
        !orderedIds.every((n) => Number.isInteger(n) && (n as number) > 0)
      ) {
        reply
          .code(400)
          .send({ error: "orderedIds must be an array of positive integers" });
        return;
      }
      // Validate that the supplied set matches the target's current
      // behavior set exactly — protects against stale UI state
      // resequencing the wrong rows. System behaviors are excluded
      // from reorder (they pin to a fixed sortOrder=-1000 above
      // user rows).
      const current = (await findBehaviorsByTarget(id)).filter(
        (b) => b.type !== "system",
      );
      const currentIds = new Set(current.map((b) => b.id));
      const submittedIds = new Set(orderedIds as number[]);
      if (
        currentIds.size !== submittedIds.size ||
        [...currentIds].some((cid) => !submittedIds.has(cid))
      ) {
        reply.code(409).send({
          error:
            "orderedIds does not match the current behavior set; refresh and retry",
        });
        return;
      }
      await reorderBehaviors(id, orderedIds as number[]);
      await recordAudit(
        request.authUserId ?? "unknown",
        "behavior.reorder",
        String(id),
        {
          count: orderedIds.length,
        },
      );
      return { ok: true };
    },
  );
}
