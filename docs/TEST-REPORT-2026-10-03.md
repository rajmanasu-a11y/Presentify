# Thorough test report — 03-10-2026

Scope: everything delivered in Phases 1–4. All runs were done in the development container (Linux, Docker) on a fresh
copy of the code from GitHub, branch `claude/admiring-thompson-36tpk3`. How to repeat each check:
[TESTING-GUIDE.md](TESTING-GUIDE.md).

## Summary

| # | Check | Result |
|---|---|---|
| 1 | Fresh installation from GitHub, following the installation steps (setup script → start → create Super Admin) | ✔ all 4 database migrations applied; started in 20 s (images already downloaded) |
| 2 | **Installation check** (new): the whole journey through the real screens of that installation — Super Admin first sign-in with authenticator → organisation → administrator → meeting wizard with presenter, PDF, QR → publish → phone registers and reads the PDF → attendance, presenter mode, QR display | ✔ 5 / 5 steps, 23 s (run twice) |
| 3 | Automated server / security / database tests | ✔ **131 / 131** |
| 4 | Automated browser tests (laptop, phone, 1920 × 1080, Kannada, accessibility) | ✔ **30 / 30** (24 earlier + 6 new below) |
| 5 | **Hostile input** (new): script-like text in meeting, session, presenter, presentation, file name, participant details, tagline — on staff screens, presenter mode, QR display and the phone page | ✔ nothing ran; shown as plain text; an injected script is blocked by the Content-Security-Policy |
| 6 | **Sign-out after inactivity** (new) | ✘ **defect found and fixed** — see below; ✔ 3 new tests |
| 7 | Upgrade Phase 3 → Phase 4 with existing data (published meeting, QR code, registered participant, views) | ✔ no data lost; the participant kept access; live figures and draft QR codes work on old data |
| 8 | 100 MB file: upload with content checks, download through a signed link | ✔ 1.6 s up, 1.3 s down (local network) |
| 9 | 300-page PDF on a phone | ✔ first page in 1.0 s; only 7 pages drawn at start, 12 after scrolling to the middle (memory released); 20 page turns in 0.5 s |
| 10 | Load: phones scanning together from one Wi-Fi address | ✔ 500 in 8.0 s, 1000 in 17.5 s, no failures, no retries needed |
| 11 | Known vulnerabilities in third-party packages (`npm audit`: screens, tools, tests) | ✔ 0 found |
| 12 | Windows line endings (cloning on Windows must not break scripts that run in Linux containers) | ✔ already enforced by `.gitattributes` |

## Defect found: an open browser tab never signed out for inactivity

**What the specification says:** sign out after 30 minutes without activity.

**What the test showed** (timeouts shortened to 2 minutes for the test): the server correctly refused to renew a
session left alone (*"Session Expired (Inactivity)"*) and an expired access key was refused (HTTP 401). But a
browser **tab left open** stayed signed in, because the page renews its own session every few minutes in the
background — an unattended office computer would have stayed signed in for up to 12 hours.

**Fix:** the screens now watch for real use (mouse, keyboard, touch — in any tab of the browser). After the
configured time without use (`SESSION_INACTIVITY_TIMEOUT`, 30 minutes) they show *"Are you still there?"* with a
one-minute countdown and *Stay signed in*, then sign out and explain why on the sign-in page. The QR display and
presenter screens keep the browser signed in while they are open, because they run unattended during meetings
(the 12-hour maximum still applies).

**Tests added:** idle screen warns, signs out and explains; activity and *Stay signed in* keep the session;
display/presenter screens stay on (`tests/e2e/session.spec.mjs`).

## Other additions from this round

- `tests/acceptance/install-check.spec.mjs` + `npm run test:install` — the installation check (item 2), for use
  on the laptop and later at the State Data Centre.
- `tests/e2e/security.spec.mjs` — hostile input (item 5).
- `docs/TESTING-GUIDE.md` — prerequisites, how to run each level, and a 60-step manual acceptance checklist.

## Not covered by these checks

- **Real phones and real Wi-Fi** — phone tests used a phone-sized Chromium; iPhone/Safari, older Androids and
  hall Wi-Fi need the manual checklist (section E of the testing guide).
- **Windows** — the test commands are expected to work in Git Bash on Windows but were run here on Linux.
- **Firefox / Safari** automated tests — only Chromium is available in this environment.
- **Container image vulnerability scan** (operating-system packages inside the Docker images) — no scanner was
  available here; recommended before the State Data Centre installation.
- Reports/exports (Phase 5), backups (Phase 6), HTTPS (SDC installation).
