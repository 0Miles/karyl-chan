# Per-plugin secret migration — COMPLETED (A-3)

A-1 (bot dual-mode), A-2 (plugin SDK dual-mode), and A-3 (global
fallback removed) are all deployed. Every plugin has its own
`KARYL_PLUGIN_SETUP_SECRET` and a `setupSecretHash` row in the DB.
The global `KARYL_PLUGIN_SECRET` mechanism no longer exists.

Refers to security-robustness-report 2.2.

---

## Current state (post A-3)

- **Bot** only accepts per-plugin setup secrets at register. No
  global fallback. Plugin rows without a `setupSecretHash` get 401.
- **Plugins** read only `KARYL_PLUGIN_SETUP_SECRET`; verify inbound
  HMACs with the `dispatchHmacKey` returned at register time.
- **`KARYL_PLUGIN_SECRET`** and **`DEPRECATE_GLOBAL_PLUGIN_SECRET`**
  have been removed from the codebase.

## Onboarding a new plugin

1. Call `POST /api/plugins/setup-secret` with `{ pluginKey: "<id>" }`.
   A placeholder DB row is auto-created if the plugin key is unknown.
   The response contains the cleartext `setupSecret` (shown once).
2. Set `KARYL_PLUGIN_SETUP_SECRET=<setupSecret>` in the plugin's `.env`.
3. Start the plugin. It will register with the bot using the per-plugin
   secret, receive a `dispatchHmacKey`, and use that for all subsequent
   dispatches.

## Rollback

Not applicable — the global fallback code has been deleted.
Re-introducing it requires a code change and a new deployment.
