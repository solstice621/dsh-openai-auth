# Validation

Validated on 2026-10-08 with macOS, DeepSeek Harness Desktop 0.2.0-rc.2, the bundled Node.js 24.18.1 runtime, and official Codex CLI 0.154.0.

| Check | Result |
| --- | --- |
| Local unit tests | 18 passed: authentication, cache reload, refresh concurrency, cancellation, sanitized errors, account identity, quota windows, sign-in tracking and system-proxy changes |
| Native bundle loader | Enabled successfully in the Desktop profile |
| Native settings page | Account state, quota, expiry and connection toggle displayed |
| Native API lifecycle | Safe state request succeeded; withdrawn plugin route returned 404 |
| Authorization refresh | Official app-server renewal succeeded; Desktop button displayed success and updated expiry |
| Official browser sign-in | Start and cancellation tested in an isolated Codex directory; existing account was preserved |
| Subscription quota | Official account/rateLimits/read succeeded and Desktop displayed available windows |
| Connection preference | Desktop disable saved false; enable saved true and restored the connection |
| Native inference | GPT-6 Sol returned the requested desktop probe response |
| Tools and replay | GPT-5.6 Sol made a tool call and consumed its response through the native adapter |
| Account hiding | Desktop screenshot control hid the email without changing authentication |

Screenshots were captured from the Desktop app; the account email was hidden and private workspace names were removed from the visible background before capture.

Full browser sign-in completion remains an account-holder action. Its completion notification, failed outcome and unrelated login-id behavior are covered by local simulated RPC tests. Other Harness versions, Windows/Linux Desktop, Keychain-only auth and untested model permissions are not claimed as validated.

These are author-side checks. They do not constitute marketplace verification or endorsement.
