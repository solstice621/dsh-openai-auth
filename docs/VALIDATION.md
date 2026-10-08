# Validation

Validated on 2026-10-08 with macOS, DeepSeek Harness Desktop 0.2.0-rc.2, the bundled Node.js 24.18.1 runtime, official Codex CLI 0.154.0 for account operations, and Desktop-bundled official Codex 0.162.0-alpha.2 for model discovery.

| Check | Result |
| --- | --- |
| Local unit tests | 32 passed: model catalog supplementation, upstream preference, supported reasoning levels, authentication, cache reload, refresh concurrency, cancellation, sanitized errors, account identity, quota windows, sign-in tracking and system-proxy changes |
| Desktop model picker | Officially discovered GPT-6.1 Sol and the merged catalog visible after installing 0.3.0 and fully restarting; current model and Xhigh effort retained |
| Model discovery | Official model/list returned 7 models including GPT-6.1 Sol; merged native catalog held 9 entries |
| Dynamic adapter | A synthetic future entry became resolvable without rebuilding the adapter; prepared request metadata stayed unchanged |
| Sync regression tests | Startup, timed refresh, pagination, concurrent requests, cache recovery, account changes, disabled connection and late disposal verified |
| Native sync UI | Startup showed the official directory; manual refresh updated the success timestamp and displayed 9 models; disable paused sync and enable restored it |
| Native bundle loader | Enabled successfully in the Desktop profile |
| Native settings page | Account state, quota, expiry and connection toggle displayed |
| Native API lifecycle | Safe state request succeeded; withdrawn plugin route returned 404 |
| Authorization refresh | Official app-server renewal succeeded; Desktop button displayed success and updated expiry |
| Official browser sign-in | Start and cancellation tested in an isolated Codex directory; existing account was preserved |
| Subscription quota | Official account/rateLimits/read succeeded and Desktop displayed available windows |
| Connection preference | Desktop disable saved false; enable saved true and restored the connection |
| Native inference | GPT-6 Sol returned the requested desktop probe response |
| GPT-6.1 Sol | Exact model ID returned the requested response after one tool call; native streaming and replay passed without fallback |
| Tools and replay | GPT-5.6 Sol made a tool call and consumed its response through the native adapter |
| Account hiding | Desktop screenshot control hid the email without changing authentication |

Screenshots were captured from the Desktop app; the account email was hidden and private workspace names were removed from the visible background before capture.

Full browser sign-in completion remains an account-holder action. Its completion notification, failed outcome and unrelated login-id behavior are covered by local simulated RPC tests. Other Harness versions, Windows/Linux Desktop, Keychain-only auth and untested model permissions are not claimed as validated.

These are author-side checks. They do not constitute marketplace verification or endorsement.
