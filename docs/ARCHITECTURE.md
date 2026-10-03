# Presentify — technical architecture (as implemented)

Status: **Phases 1–3** (foundation; meetings and content; QR codes and participants). Later phases extend this document.

## Services

```
Browser / phone ──HTTP(S)──▶ web (nginx :8080) ─┬─ /            Presentify screens (React build)
                                               ├─ /m/<token>  participant page (separate small build, no sign-in)
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
| `supabase/functions/` | `main` router, `_shared` helpers, `manage-users`, `uploads`, `public` (participants) |
| `tools/` | migration runner and Super Admin creation (Node) |
| `web/` | React + TypeScript + Mantine screens; `web/src/participant/` the phone page (no Mantine, PDF.js); `web/nginx/` gateway config |
| `tests/api/` | API / security / database tests (node:test) |
| `tests/e2e/` | browser tests (Playwright + axe accessibility checks) |
| `tests/load/` | QR-rush load check |

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

## Data model (Phase 3)

```
meetings ── access settings: registration_mode, availability_mode, open_before_minutes, access_after_days,
            custom_from/until, has_passcode            app.meeting_secrets (bcrypt passcode hash, not readable by staff)
meetings 1─* qr_codes (one ACTIVE at a time; token = 144-bit random, URL-safe; optional expiry)
participants (organisation directory; matched by mobile / e-mail when the directory is on)
meetings 1─* attendance *─0..1 participants   (anonymous rows for "no details" entry)
attendance 1─* app.attendance_tokens (SHA-256 of the participant's access token)
app.participant_devices ("remember me", SHA-256, 90 days)       access_events (OPEN_MEETING / VIEW / DOWNLOAD)
```

### Participant flow

```
phone ── GET /m/<qr token> ──▶ participant page (static)
      ── POST /functions/v1/public {action:"info"} ──▶ public fn ──rpc public_meeting_info (service)──▶ resolve_qr:
              token active and not expired · meeting published · organisation not inactive/view-only ·
              availability window (opens N minutes before / closes N days after / custom / always)
      ── register {fields, consent, passcode?} ──▶ public_register: passcode (bcrypt), required fields, mobile/e-mail
              format, consent, participant limit (meeting row locked, so a rush cannot overshoot), directory match,
              same-meeting de-duplication → returns a random access token (only its hash is stored)
      ── content {access} ──▶ public_meeting_content: released sessions, visible items, view/download rights
      ── file {kind, id, mode} ──▶ public_file_access: item belongs to this meeting, visible, released, download
              permitted → event logged → public fn signs a storage link (60 s; 3 h for video, which streams in pieces)
      ── GET /storage/v1/object/sign/… ──▶ PDF bytes → PDF.js renders on canvases on the phone
```

Participants never sign in and never reach database tables: the `public_*` functions run only with the service
key inside the `public` server function. Every decision is made in the database. Staff manage QR codes through
`regenerate_qr`, `revoke_qr`, `set_qr_expiry` and `set_meeting_passcode` (permission-checked, audited).

| Who | QR code | Access settings | Participant data |
|---|---|---|---|
| Organisation Admin / meeting's organiser | show, replace, switch off, expiry | change | see |
| Other organisers | show | — | see |
| Presenter in the meeting | show / display | — | — |
| Super Admin | — | — | — (not visible) |

### Phone viewer

PDF.js (legacy build, for phones a few years old) renders each page on a canvas sized to the screen (device-pixel
ratio aware, capped at 12 million pixels per page); pages render only when near the screen. *Full screen* shows one
page at a time fitted inside the screen in any orientation, with swipe, edge taps, buttons and keys; zoom 1–4×.
Documents that cannot be downloaded carry a light watermark with the participant's name and time (organisation
setting). There is **no offline mode** and **no copy protection (DRM)**: the phone needs the network to open a
document, and viewing in a browser cannot prevent screenshots or photographs of the screen.

### Retention job

`app.apply_retention()` runs every night at 02:00 India time (`pg_cron`): attendance details are removed when the
organisation's retention period has passed after the meeting; a directory entry goes when none of the person's
attendance records keep details; IP addresses and browser details in access events, attendance and the audit log
are blanked after `security.ip_retention_days` (default 90). Counts are kept. Each run that changes anything writes
an audit record.

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
| Participants | No accounts; QR, access and remember-me tokens are random (144–288 bits); only hashes of access and remember-me tokens are stored; passcodes are bcrypt-hashed; participant tables are readable only by staff with *View participants* in the same organisation; every view and download is logged. |
| Gateway | CSP (`script-src 'self' 'wasm-unsafe-eval'` for the PDF decoder), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; `/auth/v1/admin` blocked; rate limits (sign-in 30/min/IP — `SIGNIN_RATE_PER_MINUTE` — API 50 r/s, functions 20 r/s, participant requests and signed file links each `PUBLIC_RATE_PER_SECOND` (100 r/s) with a burst of 3000, since a whole hall may share one Wi-Fi address) answered with a JSON message; the participant page waits and retries by itself when told the server is busy. |
| Files | Private buckets only; branding accepts PNG/JPEG/WebP ≤ 2 MB; content uploads only through the upload workflow above (type allow-list, size and quota limits, content-signature and content-type checks); reading requires the meeting to be visible to the person; stored files are served with `nosniff`. |
| Accessibility | WCAG 2.1 AA colour contrast enforced by automated axe checks; skip link; keyboard focus rings; labelled controls. |

## Known limitations (Phase 1)

- IP addresses are recorded for actions made through the API and functions; failed-password
  events come from the Auth hook, which does not receive the client IP (nginx rate-limits by IP).
- Password-reset e-mails are not available until an e-mail server is configured; administrators
  issue temporary passwords instead.
- Laptop test mode uses HTTP; HTTPS is part of the State Data Centre installation.
