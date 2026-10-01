# Presentify — technical architecture (as implemented)

Status: **Phases 1–2** (foundation; meetings and content). Later phases extend this document.

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
| `supabase/functions/` | `main` router, `_shared` helpers, `manage-users`, `uploads` |
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

## Data model (Phase 2)

```
presenters ─┐ (optional link to a PRESENTER login of the same organisation)
meetings 1─* meeting_sessions *─1 presenters        meeting_counters (MTG-<year>-0001 per organisation)
meeting_sessions 1─* presentations 1─* presentation_versions ─▶ stored_files (original, PDF viewing copy)
meeting_sessions 1─* attachments ─▶ stored_files (file, PDF viewing copy)
stored_files: metadata of every upload; bytes in the private "content" bucket
```

Child tables carry `organisation_id` and use **composite foreign keys** `(organisation_id, parent_id)`, so a row can
never point at another organisation's record. Statuses: `DRAFT → PUBLISHED → ARCHIVED`; *Scheduled / Active /
Completed* are derived from the meeting times. Archived meetings are read-only until restored.

| Who | Sees | Changes |
|---|---|---|
| Organisation Admin | all meetings of the organisation | all meetings, sessions, material; restores versions |
| Organiser | all meetings of the organisation | meetings they organise (if allowed to create meetings) |
| Presenter (login) | only meetings in which they present | uploads material to their own sessions |

### Upload workflow

```
browser ──start──▶ uploads fn ──rpc begin_upload (as the person)──▶ DB: permission, archived?, file type
                                                                      (organisation allow-list), size limit,
                                                                      storage quota → reserve (PENDING)
        ◀── signed upload link (60 s) ──
browser ──PUT bytes──▶ storage (private bucket; direct uploads by users are not allowed)
browser ──finish──▶ uploads fn: reads first 4 KB → real size, stored content type, signature bytes
                    (%PDF, ZIP/OOXML, OLE, JPEG, PNG, MP4) ──rpc finalize_upload (service)──▶ DB re-checks
                    size & quota, records version / attachment / PDF copy, or REJECTS
                    rejected bytes are deleted immediately
```

Replacing a file never overwrites: each upload is a new version; *restore* records a new version that points to the
earlier files. Removing a presentation or document deletes its files and frees storage (audit record kept).

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
| Gateway | CSP (`script-src 'self'`), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; `/auth/v1/admin` blocked; rate limits (sign-in 30/min/IP — `SIGNIN_RATE_PER_MINUTE` — API 50 r/s, functions 20 r/s) answered with a JSON message. |
| Files | Private buckets only; branding accepts PNG/JPEG/WebP ≤ 2 MB; content uploads only through the upload workflow above (type allow-list, size and quota limits, content-signature and content-type checks); reading requires the meeting to be visible to the person; stored files are served with `nosniff`. |
| Accessibility | WCAG 2.1 AA colour contrast enforced by automated axe checks; skip link; keyboard focus rings; labelled controls. |

## Known limitations (Phase 1)

- IP addresses are recorded for actions made through the API and functions; failed-password
  events come from the Auth hook, which does not receive the client IP (nginx rate-limits by IP).
- Password-reset e-mails are not available until an e-mail server is configured; administrators
  issue temporary passwords instead.
- Laptop test mode uses HTTP; HTTPS is part of the State Data Centre installation.
