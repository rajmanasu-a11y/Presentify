# Phase 2 report — Meetings and content

**Date:** 01-10-2026  **Branch:** `claude/admiring-thompson-36tpk3`

## Delivered

- **Presenter directory** — presenters need no login; optionally linked to a Presenter login of the same
  organisation so they can upload their own material.
- **Meetings** — title, automatic reference (MTG-2026-0001) or own number, date and time (India time), venue,
  organiser, chairperson, unit/branch, description. Draft → Published → Archived; Scheduled / Active now /
  Completed shown from the times. Publishing requires at least one session; archived meetings are read-only and
  can be restored; empty drafts can be deleted.
- **Sessions** — several presenters per meeting, each with a topic and time slot; warnings for sessions outside
  the meeting time or overlapping another session.
- **Presentations** — every upload is a new version (with "what changed" notes); the version history keeps
  every file; an administrator can make an earlier version current again (recorded as a new version).
- **PDF copies for phones** — PDFs and images are viewable as they are; for PowerPoint/Word/Excel Presentify asks
  for a PDF copy and shows "No viewable copy yet" until it is uploaded.
- **Supporting material** — several documents per session, each with its own PDF copy and download setting.
- **Sharing settings** — meeting-level "allow downloads" (with per-file override) and session release
  (all at once / each session when it starts). These settings are stored now and take effect on the participant
  pages in Phase 3.
- **Uploads** — with a progress bar; type, size, quota and **content** checks on the server (see below).
- **Screens** (English + ಕನ್ನಡ) — Meetings list with filters and search, meeting page (sessions & material,
  details, sharing settings), Presenters, Presentations library, dashboard (today's and upcoming meetings,
  recent presentations, usage of meetings / presentations / storage against limits, quick actions), Help.

### File safety

| Check | Where |
|---|---|
| Who may upload to this session; meeting not archived | database (as the signed-in person) |
| File type on the organisation's allow-list and on Presentify's fixed list (no HTML, SVG, scripts, programs) | database |
| File size ≤ organisation limit; storage quota | database, before and after the upload |
| Real size, content type and signature bytes match the declared type (e.g. a web page renamed to .pdf is rejected) | upload function, then database |
| Rejected files are deleted at once; removed material frees its space | upload function |
| Files are never public; opened through 5-minute links; served with `nosniff` | storage rules, gateway |

## Test results (fresh stack, 01-10-2026)

| Suite | Result |
|---|---|
| API / security / database (`tests/api`) | **84 / 84 passed** (49 Phase 1 + 34 Phase 2 + 1 rate-limit) |
| Browser end-to-end incl. accessibility (`tests/e2e`) | **10 / 10 passed** |

Defects found and fixed during testing:
- new meetings were refused by the visibility rule (it looked the new row up before it existed);
- an upload rejected for its content showed "Something went wrong" instead of the reason;
- unlabelled close buttons on pop-up messages (screen readers);
- on phones in Kannada, supporting-material rows were cramped and the "PDF ready" label was cut off;
- the sign-in rate limit is now configurable (`SIGNIN_RATE_PER_MINUTE`, default 30) and answers with a clear
  message instead of a bare error page.

## Requirement checklist (Phase 2 scope)

| Requirement | Implemented | Tested | Notes |
|---|:-:|:-:|---|
| §6 Meeting fields (title, number, date, start/end, venue, organisation, organiser, chairperson, description, status, presenters, presentations, attachments) | ✔ | ✔ | access settings & QR in Phase 3 |
| §7 Multiple presenters / sequential sessions in one meeting | ✔ | ✔ | |
| §8 Upload PPT/PPTX, PDF, images, Word, Excel; video and ZIP if enabled | ✔ | ✔ | MP4/ZIP selectable per organisation |
| §8 Presentation fields (title, description, presenter, meeting, category, date, version, uploaded/modified, status, download permission, visibility) | ✔ | ✔ | |
| §8 Original file preserved | ✔ | ✔ | never converted or overwritten |
| §9 Supporting documents per session | ✔ | ✔ | |
| §15 Download control (meeting + per file) | Stored | ✔ (settings) | enforced on participant pages, Phase 3 |
| §25 Statuses Draft / Scheduled / Published / Active / Completed / Archived | ✔ | ✔ | |
| §26 Version control: uploaded by, date/time, file name, version, change notes, restore | ✔ | ✔ | |
| §27 File type validation, size validation, content checks | ✔ | ✔ | malware scanning not included (agreed) |
| §29 Audit: meeting creation, presentation upload/modification, attachment upload | ✔ | ✔ | |
| §31 Files outside the database, metadata in PostgreSQL, storage replaceable | ✔ | — | local disk now; S3-compatible possible |
| §40 "Preview not available" honesty | ✔ | ✔ | "No viewable copy yet — upload a PDF copy" |
| §51 Limits: meetings, presentations, storage, file size — enforced by the backend | ✔ | ✔ | |
| §21 Dashboard: today's/upcoming meetings, recent presentations, storage, presentation limit, quick actions | ✔ | ✔ | active QR codes / participants in Phase 3 |
| §44 Help: creating a meeting, uploading, managing presenters | ✔ | — | |

## Upgrading a Phase 1 installation

`docker compose up -d --build` applies the new database migration automatically. No data is lost.

## Not yet verified

- Windows installation steps (as noted in the Phase 1 report).
- Very large files (hundreds of MB) over slow Wi-Fi — tested here only up to 1.5 MB per file.

## Next: Phase 3

QR codes (generate, regenerate, revoke, expiry), participant registration (English/Kannada), access settings,
the full-screen mobile PDF viewer, and download control on the participant pages.
