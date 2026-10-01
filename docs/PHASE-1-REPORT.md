# Phase 1 report — Foundation

**Date:** 01-10-2026  **Branch:** `claude/admiring-thompson-36tpk3`

## Delivered

- Self-hosted Supabase stack (trimmed to the six services Presentify needs) with nginx as the
  single gateway; setup scripts for Windows (PowerShell) and Linux; optional organisation root
  certificates for networks that inspect HTTPS.
- Database foundation: packages, organisations, settings, staff profiles, permissions, limits,
  subscription states, audit log, sign-in events, system settings, private branding storage —
  all protected by Row-Level Security.
- Sign-in: no public sign-up, password policy, forced change of temporary passwords,
  authenticator-app MFA (mandatory for Super Admin, optional/enforceable for organisation admins),
  lockout after repeated failures, inactivity timeout, deactivated users/organisations blocked.
- `manage-users` server function: create staff, edit, change role, deactivate/activate,
  temporary password, remove authenticator app — with limits enforced by the database.
- Screens (English + ಕನ್ನಡ): sign-in, MFA, password change; Super Admin console (dashboard,
  organisations, organisation detail with profile/limits/status/staff/settings/usage, packages,
  system settings, audit); Organisation Admin (dashboard, organisation profile & branding with
  logo/emblem upload, participant/file/security settings, users, audit); My account; Help.
- Documentation: Windows laptop installation, architecture & security model, testing.

## Test results (fresh stack, 01-10-2026)

| Suite | Result |
|---|---|
| API / security / database (`tests/api`) | **49 / 49 passed** |
| Browser end-to-end incl. accessibility (`tests/e2e`) | **8 / 8 passed** |
| Mutation check (isolation policy deliberately weakened) | tests **failed as expected** (3 failures), passed again after restoring |

Defects found and fixed during testing: Supabase first-boot role script aborted on a role
Presentify does not use (broke Auth); secondary-text and status-badge colours below WCAG AA
contrast; Kannada quick-action labels cut off; language switch could erase a saved phone number.

## Requirement checklist (Phase 1 scope)

"Implemented" means it works end-to-end; "Tested" means an automated test covers it.

| Requirement | Implemented | Tested | Notes |
|---|:-:|:-:|---|
| §3 Organisation profile: name, logo, emblem/seal, tagline, address, contact | ✔ | ✔ | logo upload tested in browser |
| §3 Primary administrator, number of administrators | ✔ | ✔ | |
| §3 Limits: presentations, storage, max file size | Stored & editable | ✔ (editing) | enforced when uploads arrive (Phase 2) |
| §3 Allowed file types, download default, registration fields | Stored & editable | ✔ (editing) | applied in Phases 2–3 |
| §3 Branding/theme, account status, package, expiry | ✔ | ✔ | brand colour stored; used on participant pages (Phase 3) |
| §3 Usage statistics | Partial | ✔ | users, admins, storage; meetings/presentations in Phase 2 |
| §3 Increase/decrease limits at any time | ✔ | ✔ | |
| §4 Multi-tenant isolation at database level | ✔ | ✔ | RLS + composite rules; mutation-checked |
| §5 Roles: Super Admin, Org Admin, Organiser, Presenter | ✔ (foundation) | ✔ | meeting-related rights arrive with meetings |
| §22 Simple interface, large buttons, clear messages | ✔ | ✔ (partly) | reviewed via screenshots |
| §27 Secure authentication, password hashing, sessions | ✔ | ✔ | Supabase Auth (bcrypt) |
| §27 RBAC, tenant isolation | ✔ | ✔ | |
| §27 Rate limiting | ✔ | — | configured in nginx; not load-tested yet |
| §27 Audit log, login activity, failed-login monitoring | ✔ | ✔ | |
| §27 Secure password reset | ✔ (admin-issued) | ✔ | e-mail reset when an e-mail server is configured |
| §27 MFA for administrators | ✔ | ✔ | |
| §27 XSS / SQL injection / CSRF | ✔ | ✔ (headers) | CSP; parameterised API; tokens sent in headers, not cookies |
| §29 Audit: organisation/user creation, settings, activation, logins | ✔ | ✔ | logout events not yet shown |
| §34 Branding (logo, emblem, name, tagline) | ✔ | ✔ | |
| §42 Accessibility (contrast, keyboard, labels) | ✔ | ✔ | axe WCAG 2 A/AA on sign-in and dashboard |
| §43 Responsive (phone) | ✔ | ✔ (sign-in) | dashboard checked visually on a phone viewport |
| §49 Super Admin area protected | ✔ | ✔ | server-side checks + MFA; route not linked publicly |
| §51 Limits enforced by the backend | ✔ (admins, users) | ✔ | others as their features arrive |
| §52 Packages | ✔ | ✔ | |
| §44 Help | Partial | — | Phase 1 topics; full guide in Phase 6 |
| Kannada interface | ✔ | ✔ | **needs review by a native Kannada speaker** |

## Not yet verified

- **Windows:** the PowerShell setup script and the Windows installation steps have **not been run on
  Windows** (no Windows machine here). Everything else was run on Linux with Docker, the same
  containers Docker Desktop runs. Please treat your first laptop installation as the acceptance
  test for these steps and tell me about any message you see.
- Session inactivity timeout (30 min) and maximum session lifetime (12 h) are configured in
  Supabase Auth but not covered by an automated test (it would need a 30-minute wait).
- Load (500 simultaneous participants) — Phase 3, when the participant pages exist.

## Next: Phase 2

Presenter directory, meetings and sessions, presentation and attachment uploads (file checks,
quotas, versions), PDF copies for phone viewing.
