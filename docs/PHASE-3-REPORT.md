# Phase 3 report — QR codes and participants

**Date:** 03-10-2026  **Branch:** `claude/admiring-thompson-36tpk3`

## Delivered

- **QR codes** — created automatically when a meeting is published; one working code per meeting; random
  144-bit token with no IDs or personal data inside. Organisers and administrators can **replace** the code
  (the old one stops working immediately, with a warning first), **switch it off**, and set an **expiry**.
  Copy link, download the image (PNG, 1024 px), print, and a **full-screen display page** for a projector or TV
  (checks every minute for a replaced code; scan instruction in English and ಕನ್ನಡ). Presenters can display the
  code but not change it.
- **Access settings** per meeting — participant details *required / optional / not asked*; when the code works
  (*around the meeting time*: opens N minutes before, closes 0–365 days after or when archived; *between chosen
  dates*; *at any time*); optional **passcode** (stored bcrypt-hashed, never shown to staff).
- **Participant page** (`/m/<code>`, English ⇄ ಕನ್ನಡ, no account, no app): organisation logo and name,
  meeting, sessions with *Now* / *Next*; registration form built from the organisation's field settings with
  the privacy notice and "I agree"; "remember my details on this phone" (opt-in, 90 days, same organisation);
  plain-language messages for invalid, replaced, not-yet-open, ended and unavailable links, wrong passcode,
  participant limit and network problems. Returning on the same phone goes straight to the material.
- **Phone PDF viewer** — pages fit the phone's width; **full screen shows one page at a time fitted to the
  screen in any orientation and on any size** (checked at 320 × 568, 412 × 915, 915 × 412 landscape, and a
  1024 × 1366 tablet); swipe, tap the sides, buttons or keys to turn pages; zoom up to 4×; sharp on high-density
  screens; pages render only when near the screen. Images and MP4 video open in the same viewer.
- **Download control** — the Download button appears only where allowed (meeting setting with per-file
  override); the server refuses downloads that are not allowed. Documents that cannot be downloaded show a light
  **watermark** with the participant's name and time (organisation setting, on by default).
- **Session release** — with *each session when it starts*, later sessions show "Available from …" and their
  files are refused by the server until then.
- **Attendance** — *Participants* tab: who registered, when, contact details if collected, last opened, how many
  documents they viewed/downloaded; search; refreshed every 30 s. Dashboard: active QR codes, participants
  today and in the last 30 days. Every page opening, view and download is recorded (with IP and browser).
- **Data retention (DPDP)** — a nightly job (02:00 India time) removes participant details when the
  organisation's retention period has passed after the meeting (counts stay), removes "remember me" entries,
  and blanks IP addresses and browser details in access records and the audit log after 90 days (system
  setting). Each run is audited. The privacy notice tells participants when their details are deleted.
- **Help** topics for showing the QR code, access settings, attendance, and what participants see.

### Security of the participant side

| Rule | Where it is enforced |
|---|---|
| Participants never sign in and never reach database tables; all requests go through the `public` server function | gateway, server function, database grants |
| QR code valid, not replaced/switched off/expired, meeting published, organisation active, within the availability window | database (`resolve_qr`) |
| Passcode, required fields, mobile/e-mail format, consent, participant limit (no overshoot under a rush) | database (`public_register`, meeting row locked) |
| Access token per participant and meeting (random, 288 bits; only its SHA-256 stored) | database |
| Item belongs to this meeting, is visible, its session is released; download permitted | database (`public_file_access`) |
| Files opened only through signed links valid for 60 seconds (3 hours for video) | server function + storage |
| Participant data visible only to administrators and organisers of the organisation — not presenters, not other organisations, not the Super Admin | Row-Level Security |
| Many phones behind one venue Wi-Fi address are not blocked | gateway: participant requests and file links 100/s each per address with a burst of 3000 (`PUBLIC_RATE_PER_SECOND`); the page retries by itself when told "busy" |

## Test results (fresh stack, 03-10-2026)

| Suite | Result |
|---|---|
| API / security / database (`tests/api`) | **122 / 122 passed** (49 Phase 1 + 34 Phase 2 + 38 Phase 3 + 1 rate-limit) |
| Browser end-to-end incl. accessibility (`tests/e2e`) | **16 / 16 passed** (10 Phase 1–2 + 6 Phase 3, of which 3 on a phone screen) |

### Load check — many phones scanning at once

`tests/load/qr-rush.mjs`: each simulated participant opens the page, loads the meeting, registers, lists the
material, asks for a document and downloads the 20-page PDF — all from **one network address** (as at a venue).
Run on the test stack in the development container (not the Windows laptop; laptop figures will differ):

| Phones (at a time) | Total time | Register: median / 95 % | Open document link: median / 95 % | Failures |
|---|---|---|---|---|
| 300 (60) | 4.4 s | 0.17 s / 0.46 s | 0.19 s / 0.44 s | none |
| 500 (100) — the agreed target is 500 within ~2 minutes | 6.9 s | 0.28 s / 0.92 s | 0.26 s / 0.77 s | none (1 automatic retry) |
| 1000 (200) | 15.9 s | 0.62 s / 2.25 s | 0.50 s / 2.20 s | none |

The first 500-phone run exposed a real limit: with all requests from one address the gateway refused 232 of them
("too many requests"), and 1000 phones also hit the limit when downloading the document. Fixed by raising the
participant allowance (100/s, burst 3000, separate counters for requests and file downloads, configurable) and by
making the page wait and retry by itself when the server says it is busy. All participants then completed.

Participant page size (measured in the browser): **129 KB** to show the registration form (target < 150 KB),
316 KB after opening the first document (the PDF viewer loads only then).

Defects found and fixed during Phase 3 testing:
- the PDF viewer used a JavaScript feature only the newest browsers have, so pages stayed blank on many phones —
  now uses PDF.js's compatibility build (found because the test checks real pixels on the page);
- a NUL character typed in a form field made registration fail — form values are now cleaned first;
- a repeat registration with a mobile number was counted twice when the organisation's directory is off;
- the QR tab still said "no QR code" right after publishing until the page was reloaded;
- access choices only changed after the server answered (felt unresponsive) — now change at once and go back if
  saving fails;
- two colour-contrast failures (status badge, replace button) found by the accessibility check;
- the PDF viewer's background worker was served with the wrong file type and would not start;
- under a 500-phone rush from one Wi-Fi address the gateway refused requests (see the load check);
- meetings published before the upgrade would have had no QR code — the upgrade now creates them (rehearsed:
  Phase 2 database with a published meeting → upgrade → code works, material opens on a phone);
- signed links for documents lasted 5 minutes; now 60 seconds as specified.

## Requirement checklist (Phase 3 scope)

| Requirement | Implemented | Tested | Notes |
|---|:-:|:-:|---|
| §10 QR per meeting; generate, regenerate (old one revoked), revoke, expiry; display, download, print, copy link | ✔ | ✔ | QR made inside Presentify (no external service) |
| §6.2 QR token ≥ 128-bit random, no IDs, plain-language messages for invalid/expired/revoked | ✔ | ✔ | 144-bit |
| §11 Participant registration without accounts; configurable fields; consent; Kannada | ✔ | ✔ | Kannada wording needs native review |
| §12 Access settings: registration required/optional/none, availability window, passcode | ✔ | ✔ | |
| Q6 "Remember me" opt-in, 90 days, same organisation; directory links by mobile/e-mail only | ✔ | ✔ | |
| Q8 Link after the meeting: 0/7/30/90 days or until archived; regenerating revokes at once | ✔ | ✔ | also 1/3/15/180/365 days |
| §4.1 PDF fits the full screen of any phone | ✔ | ✔ | four screen sizes/orientations checked |
| §15 Download control enforced on the participant side | ✔ | ✔ | server refuses; button hidden |
| §16 Session release at session start | ✔ | ✔ | |
| §17 Attendance list per meeting; view/download activity recorded | ✔ | ✔ | exports in Phase 5 |
| §6.2 Short-lived signed links (~60 s) issued only after checks | ✔ | ✔ | video 3 h (streams in pieces) |
| Q14/Q15 DPDP: consent notice, retention of participant data, IP data 90 days | ✔ | ✔ | nightly job |
| Q20 500 participants scanning one QR within ~2 minutes | ✔ | ✔ | 500 in 6.9 s and 1000 in 15.9 s from one address (development container) |
| §3 Participant page small (target < 150 KB) | ✔ | ✔ | 129 KB measured; English uses the phone's own font; the PDF viewer loads on first *Open* |
| §40 Honesty: no DRM, no offline mode claimed | ✔ | — | watermark is a deterrent only |
| §21 Dashboard: active QR codes, participants | ✔ | ✔ | |
| §44 Help for QR, access, attendance, participant view | ✔ | — | |

## Upgrading a Phase 2 installation

`docker compose up -d --build` applies the new database migration automatically (it also enables the
database's built-in scheduler for the nightly retention job). No data is lost. Meetings that are already
published get their QR code during the upgrade, with *participant details required* and the link open from 30
minutes before the meeting until 7 days after it — check these in each meeting's *QR code & access* tab.

## Not yet verified

- Real phones (only phone-sized Chromium was tested): older iPhones/Safari and low-end Android phones should be
  checked with a real PDF from your organisation, including Kannada text inside PDFs.
- Very large PDFs (hundreds of pages, scanned documents of 50–100 MB) on phones with little memory.
- Load figures on the Windows laptop and over real Wi-Fi.
- Kannada wording by a native reviewer; Windows installation steps (as noted in earlier reports).

## Next: Phase 4

Create-meeting wizard, QR display mode for 1920 × 1080 screens with live participant count, presenter mode
(NOW/NEXT, timer).
