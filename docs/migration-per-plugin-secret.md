# Per-plugin secret migration runbook

A-1 (bot dual-mode) and A-2 (plugin SDK dual-mode) are deployed.
Every plugin still uses the global `KARYL_PLUGIN_SECRET` fallback —
this document is the operator-facing checklist for completing the
final phase (A-3) where each plugin moves to its own secret and the
global one stops being honored.

Refers to security-robustness-report 2.2.

---

## Current state

- **Bot** accepts both per-plugin and global setup secrets at register;
  signs outbound dispatches with whichever is set on the plugin row.
- **Plugins** read `KARYL_PLUGIN_SETUP_SECRET` first, fall back to
  `KARYL_PLUGIN_SECRET`; verify inbound HMACs with the dispatch key
  the bot returned at register time, falling back to the global secret
  when no per-plugin key has been issued yet.
- **`DEPRECATE_GLOBAL_PLUGIN_SECRET`** defaults to `false`. While
  false, the global fallback is honored.

When DEPRECATE is flipped to `true`, the global fallback path
returns 401 at register and the dispatch path will not sign outbound
events with the global secret — you must have moved every plugin
to its own secret first.

---

## Migration steps

### Phase a — issue per-plugin secrets (one round per plugin)

Repeat for each plugin (the order doesn't matter; you can stagger).

1. **Open the admin plugins page** (`/admin/plugins`) and expand
   the target plugin's card.
2. **Click "Generate setup secret"**. A confirmation modal appears
   warning that the previous setup secret (if any) will be
   invalidated. Confirm.
3. **Copy the cleartext** shown in the result modal. The button
   does this for you. The dialog explicitly will not let you close
   it without acknowledging via checkbox so a misclick can't lose
   the value — once gone, you must regenerate (which invalidates
   the half you wrote down).
4. **Write the value into the plugin's `.env`** as

   ```
   KARYL_PLUGIN_SETUP_SECRET=<value>
   ```

   Plugin `.env` files live in each plugin's repo next to its
   `docker-compose.yml`. The plugin's `docker-compose.yml` already
   forwards both `KARYL_PLUGIN_SECRET` and
   `KARYL_PLUGIN_SETUP_SECRET` from host env, so you can also set
   the new one in the host's shell instead of the file — pick the
   convention you've been using for the other secrets.
5. **Restart the plugin** (`docker compose up -d --force-recreate`
   in that plugin's directory).
6. **Verify** the plugin is `healthy` (`docker ps`) and that the
   bot logs the per-plugin path on its first register after
   restart. The bot will overwrite the plugin row's
   `dispatch_hmac_key` with a fresh value on this register — that's
   normal; the plugin SDK reads it back from the response and will
   use it for the next dispatch.

Repeat until all plugins are on their own secrets.

#### How to tell which plugins still need migrating

`GET /api/admin/system-settings` returns `plugin.sharedSecret` as
`{ status: "configured" }` while `KARYL_PLUGIN_SECRET` is still
set; that doesn't tell you which plugins still rely on it.

Either:
- Inspect each plugin's `.env`. A plugin without
  `KARYL_PLUGIN_SETUP_SECRET` (or with an empty value) is still on
  the global path, **or**
- query the DB directly:

  ```sql
  SELECT pluginKey, setupSecretHash IS NOT NULL AS migrated
  FROM plugins
  ORDER BY pluginKey;
  ```

  When every row reports `migrated = 1`, you're ready for phase b.

### Phase b — flip DEPRECATE_GLOBAL_PLUGIN_SECRET to true

1. Set `DEPRECATE_GLOBAL_PLUGIN_SECRET=true` in karyl-chan's host
   `.env` (or the docker-compose `environment:` block, whichever
   you use to feed env into the bot).
2. Restart the bot:

   ```
   docker compose up --build -d bot
   ```

3. Watch each plugin's logs for the next register cycle. Successful
   registers should still use the per-plugin secret; if a plugin
   gets `401 invalid setup secret`, double-check its `.env` and
   restart it.
4. Soak for at least a day. Any plugin that didn't get migrated in
   phase a will fail to register and crashloop — that's the design.
   `docker ps` will show `Restarting (1)` for any straggler.

### Phase c — code cleanup (commit)

After at least a week of soak with no fallback usage:

1. Remove the global-secret fallback from the four bot dispatch
   paths:
   - `src/modules/plugin-system/plugin-dispatch.service.ts`
   - `src/modules/plugin-system/plugin-event-bridge.service.ts`
   - `src/modules/plugin-system/plugin-interaction-dispatch.service.ts`
     (two fetch sites)

   Replace `plugin.dispatchHmacKey ?? config.plugin.sharedSecret`
   with a hard requirement that `plugin.dispatchHmacKey` exists;
   when it doesn't, log + skip the dispatch (or 503 the request)
   instead of falling back.
2. Remove the global-secret read from each plugin's `src/index.ts`:

   ```ts
   const SETUP_SECRET =
     process.env.KARYL_PLUGIN_SETUP_SECRET || process.env.KARYL_PLUGIN_SECRET;
   ```

   becomes

   ```ts
   const SETUP_SECRET = process.env.KARYL_PLUGIN_SETUP_SECRET;
   ```

   plus the corresponding `KARYL_PLUGIN_SECRET=` lines in each
   `.env.example` and the pass-through in each `docker-compose.yml`
   `environment:` block.
3. Remove `KARYL_PLUGIN_SECRET=` from karyl-chan's host `.env` and
   docker-compose. Once nothing reads it, the env var disappearing
   has no effect — but also it's no longer floating around as a
   thing that could get exfiltrated.
4. Remove the `if (config.web.deprecateGlobalPluginSecret)` branch
   from `src/modules/plugin-system/plugin-routes.ts` (the register
   handler). With no fallback to deprecate, the flag and the
   branch are both dead.
5. Drop `web.deprecateGlobalPluginSecret` and
   `plugin.sharedSecret` from `src/config.ts`,
   `src/config-metadata.ts`, and the corresponding stub in
   `tests/config-metadata.test.ts`.
6. The `plugins.setupSecretHash` column becomes mandatory at the
   row level — consider tightening the model with `allowNull: false`
   in a follow-up migration. (Existing rows are guaranteed populated
   by the time you run this because the deprecation flag was on.)
7. Run the full test suite. Adjust the per-plugin-secret test that
   covers the global fallback to instead assert the fallback path
   is gone.

---

## Rollback

### During phase a

Trivial — revert the plugin's `.env` to drop
`KARYL_PLUGIN_SETUP_SECRET` and restart it. The plugin will fall
back to the global path; the per-plugin hash stays in the DB but
goes unused. To clean up, you can `UPDATE plugins SET
setupSecretHash = NULL, dispatchHmacKey = NULL WHERE pluginKey =
'…'` but it's not strictly necessary.

### During phase b

Set `DEPRECATE_GLOBAL_PLUGIN_SECRET=false` (or unset it — false is
the default) and restart the bot. Any plugin that was failing to
register will succeed again on the next attempt.

### During phase c

Standard `git revert` of the cleanup commit. Make sure the global
secret is back in the bot's env before deploying the revert,
otherwise plugins that haven't been re-registered yet will fail at
register time. (They might have anyway because phase b already ran,
so this should only ever be a real concern if you migrated phase b
and then changed your mind weeks later.)

---

## Done criteria

- Every plugin has `setupSecretHash` set in the DB.
- `DEPRECATE_GLOBAL_PLUGIN_SECRET=true` in production for at least
  a week with no plugin in restart-loop.
- Phase c cleanup commit merged.
- `grep KARYL_PLUGIN_SECRET` across the entire workspace returns
  only the comment-out lines in `.env.example` history (or zero
  hits, depending on how aggressive the cleanup pass was).
