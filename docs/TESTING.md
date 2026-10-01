# Testing

All tests run against a **separate, disposable stack** (Docker project `presentify-test`,
port 8090, its own database). Real data is never touched.

```bash
scripts/test.sh          # API/security tests, then browser tests
scripts/test.sh api      # API/security tests only
KEEP_STACK=1 scripts/test.sh   # leave the test stack running afterwards
```

Browser tests need Chromium: `cd tests && npx playwright install chromium` once, or set
`PW_CHROMIUM_PATH` to an installed Chromium.

## What is tested (Phase 1)

**API / security / database** (`tests/api`, 49 tests)

| File | Covers |
|---|---|
| `01-gateway` | security headers, SPA routing, no secrets in runtime config, Auth admin blocked, sign-up disabled, forged/missing tokens rejected, anonymous access to every table and RPC refused |
| `02-tenancy` | organisation admins see/change only their organisation (organisations, settings, profiles, limits, usage, staff); cannot create organisations or change package/limits/status/expiry; organisers' restrictions; no direct writes to profiles/audit/system settings; Super Admin sees all; Super Admin without MFA sees nothing |
| `03-users-and-limits` | temporary password and forced change; password policy; duplicate e-mail; input validation; administrator and user limits enforced by the server (no orphan logins); Super Admin raises limits; no self-deactivation/self-demotion; deactivation blocks sign-in and existing tokens; temporary password reset; role changes; own-profile updates; deactivated organisation; grace period; view-only after grace; retention vs package |
| `04-signin-audit-storage` | lockout after 5 failures (even with the right password) and login events; MFA reset; audit actor/old-new values/IP; audit records immutable (update/delete/truncate); audit visibility per organisation; actor header cannot be spoofed; branding upload/read limited to own organisation; only images accepted; usage reporting |

**Browser** (`tests/e2e`, Playwright, 8 tests)

- sign-in page: accessibility (axe, WCAG 2 A/AA, no serious/critical issues), English ⇄ Kannada
- wrong password message
- Super Admin first sign-in: forced password change → authenticator set-up (real TOTP) → console
- Super Admin creates an organisation, adds its administrator (temporary password), changes limits
- Organisation Admin: first sign-in, console blocked, profile, logo upload, registration fields, add organiser, audit log, Kannada interface
- dashboard accessibility
- phone layout (Pixel 7): no sideways scrolling, touch-size buttons

## Results

See [PHASE-1-REPORT.md](PHASE-1-REPORT.md) for the latest run.
