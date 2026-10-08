# Changelog

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
