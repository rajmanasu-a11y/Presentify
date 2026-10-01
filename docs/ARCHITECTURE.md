# Presentify — technical architecture (as implemented)

Status: **Phase 1** (foundation). Later phases extend this document.

## Services

```
Browser / phone ──HTTP(S)──▶ web (nginx :8080) ─┬─ /            Presentify screens (React build)
                                               ├─ /auth/v1/     → auth      (Supabase Auth / GoTrue)
                                               ├─ /rest/v1/     → rest      (PostgREST)
                                               ├─ /storage/v1/  → storage   (Supabase Storage, local disk)
                                               └─ /functions/v1/→ functions (Supabase Edge Runtime)
                                                         all ──▶ db (Supabase Postgres 17)
migrate  (one-shot)  applies supabase/migrations/*.sql
tools    (on demand) create-superadmin, migration-status
```

- A trimmed version of the official self-hosted Supabase stack: Realtime, Studio, image
  transformation, the connection pooler and the analytics stack are not run.
- **nginx is the only published port.** It also replaces Supabase's API gateway (Kong/Envoy):
  Presentify uses the legacy HS256 keys, which every service verifies itself.
- Edge Functions have **no third-party dependencies** (no downloads at run time): the router
  verifies tokens with Web Crypto, and functions call Auth/REST directly over the Docker network.
- Docker volumes: `db-data`, `db-config`, `storage-data`, `deno-cache`.

## Code layout

| Path | Contents |
|---|---|
| `docker-compose.yml` | the stack; `docker-compose.test.yml` adds test-only ports |
| `docker/db/` | first-boot database scripts (role passwords, JWT expiry) |
| `docker/certs/` | optional organisation root certificates for builds behind HTTPS inspection |
| `supabase/migrations/` | Presentify schema (append-only, checksummed) |
| `supabase/functions/` | `main` router, `_shared` helpers, `manage-users` |
| `tools/` | migration runner and Super Admin creation (Node) |
| `web/` | React + TypeScript + Mantine screens; `web/nginx/` gateway config |
| `tests/api/` | API / security / database tests (node:test) |
| `tests/e2e/` | browser tests (Playwright + axe accessibility checks) |

## Data model (Phase 1)

```
packages 1─* organisations 1─1 organisation_settings
organisations 1─* profiles *─1 auth.users            role_permissions *─1 permissions
organisation_limits  (view: organisation override ?? package value)
audit_logs (append-only)    login_events    system_settings    app.auth_failures (private)
storage bucket "branding": <organisation_id>/<file>
```

## Security model

| Concern | Implementation |
|---|---|
| Organisation isolation | Row-Level Security on every table. Policies use `app.current_org_id()`, which reads the caller's **active** profile and organisation on every statement (JWT claims are never trusted for authorisation). Automated tests attempt cross-organisation reads/writes through every route, and a mutation check confirms the tests fail if a policy is weakened. |
| Roles & permissions | `role_permissions` table; `app.has_perm()`; Organiser meeting rights togglable per person. |
| Super Admin | Role + **MFA-verified session (aal2)** required by `app.is_super_admin()`; created only from the server console. |
| Field-level protection | Trigger `organisations_guard`: only the Super Admin may change package, limits, status, expiry, grace period. Profiles are written only by the `manage-users` function or `update_my_profile()`. |
| Limits | Triggers enforce administrator and user-account limits inside the same transaction (row lock on the organisation). Retention may not exceed the package maximum. |
| Subscription state | `app.org_access()` → ACTIVE / GRACE / READ_ONLY / INACTIVE. Writes require ACTIVE or GRACE; INACTIVE blocks sign-in and existing sessions. |
| Sign-in | Supabase Auth with sign-up disabled; password policy (≥10, upper, lower, digit); session inactivity timeout (30 min) and maximum lifetime (12 h); refresh-token rotation. Database hooks: lockout after 5 failures for 15 minutes (configurable), MFA-code lockout, deactivated user/organisation blocking, login events. |
| Server functions | Router verifies the token signature; `manage-users` re-checks the session with Auth and the caller's role/organisation in the database; the service key never leaves the server. Actions are attributed to the real person via a header that the gateway strips from browser requests and the database trusts only for service-role calls. |
| Audit | Row-change triggers record old/new values, actor, IP and browser; records cannot be updated, deleted or truncated (only IP/browser blanking for retention). |
| Gateway | CSP (`script-src 'self'`), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; `/auth/v1/admin` blocked; rate limits (sign-in 30/min/IP, API 50 r/s, functions 20 r/s). |
| Files | Private buckets only; branding accepts PNG/JPEG/WebP ≤ 2 MB; storage policies restrict paths to the caller's organisation. |
| Accessibility | WCAG 2.1 AA colour contrast enforced by automated axe checks; skip link; keyboard focus rings; labelled controls. |

## Known limitations (Phase 1)

- IP addresses are recorded for actions made through the API and functions; failed-password
  events come from the Auth hook, which does not receive the client IP (nginx rate-limits by IP).
- Password-reset e-mails are not available until an e-mail server is configured; administrators
  issue temporary passwords instead.
- Laptop test mode uses HTTP; HTTPS is part of the State Data Centre installation.
