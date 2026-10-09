# Changelog

## 0.3.3-local.1 (local enhancement, not published)

- Refresh quota every five minutes in the backend, regardless of whether settings are open; configure with `quotaRefreshMinutes`.
- Reuse account-scoped snapshots across restarts, coalesce manual/background requests, and stop timers/CLI on unload.
- Preserve the last successful reading on errors and prevent stale account or disposed requests from committing cache data.
- Observe newer backend snapshots on the settings page without extra quota network calls.

## 0.3.2

- Move the model-catalog card below the quota card, so the account and quota are what the page opens on.
- Add `showModelSync` (default `true`); set it to `false` to drop the model-catalog card entirely. The preference is reported through `state` rather than read from raw configuration.

## 0.3.1

- Show the last successful quota reading immediately when the settings page opens, then refresh it behind the user instead of leaving the card empty while the Codex app-server starts.
- Persist a sanitized, account-scoped rate-limit snapshot; a snapshot belonging to another account is never reused.
- Label a restored reading as `上次更新` and keep it on screen when a refresh fails, with the failure reported beside it rather than replacing the numbers.
- Add `quotaCachePath` and a `cached` RPC that answers from disk without starting Codex.

## 0.3.0

- Discover models through official Codex app-server model/list at startup and every six hours by default.
- Add a native settings card with sync state, timestamps, model counts and a manual refresh button.
- Publish catalog changes to the native picker without resetting the current model or in-flight request metadata.
- Persist sanitized, account-scoped model metadata; restore it on startup and keep the successful catalog when refresh fails.
- Validate pagination, input modalities and supported reasoning efforts; pause discovery while the connection is disabled.
- Allow a separate current official Codex executable for model discovery without changing account-operation configuration.

## 0.2.4

- Supplement older Harness catalogs with GPT-6.1 Sol using the native Codex Responses transport.
- Expose only its supported reasoning levels: low, medium, high, xhigh and max.
- Prefer upstream model metadata once Harness includes GPT-6.1 Sol; preserve existing models and defaults.
- Verify exact GPT-6.1 Sol subscription inference, tool calls and history replay without model fallback.

## 0.2.3

- Add Chinese and English plugin display metadata and a self-contained icon.
- Add an account-hiding control for screen sharing and screenshots.
- Document Desktop installation, shared login behavior, permission boundaries, proxy handling and current limitations.
- Include actual Desktop screenshots with personal account information hidden.

## 0.2.2

- Add native Desktop settings UI with account state, browser sign-in, authorization refresh, quota windows and a persistent connection toggle.
- Use official Codex app-server RPC for sign-in and quota reads.
- Validate quota account identity and expose only display-safe data to the client.

## 0.1.1

- Add a local Codex subscription provider using the Harness native adapter.
- Refresh expiring login credentials through the official Codex CLI.
- Honor active macOS HTTP/HTTPS system proxies when the Desktop Host has no explicit proxy.
