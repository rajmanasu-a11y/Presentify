# Phase 4 report — Wizard, display mode, presenter mode, live count

**Date:** 03-10-2026  **Branch:** `claude/admiring-thompson-36tpk3`

## Delivered

- **Create-meeting wizard** (Meetings → *New meeting*, and the dashboard's *Create meeting*), seven steps:
  1 Meeting details → 2 Presenters & sessions → 3 Presentations → 4 Supporting material → 5 Access & downloads →
  6 QR code → 7 Review & publish → **"Meeting Published Successfully"** with the QR code, the meeting link and
  **Display QR / Download QR / Print QR / Copy link**, plus *Start presentation*.
  - Every step saves at once; *Finish later* leaves a draft, and the meeting page offers **Continue setup**.
  - A new presenter can be added from inside the session form (no need to leave the wizard).
  - The review lists what must be fixed (no sessions → cannot publish) and warnings (session without presenter or
    presentation, file without a PDF copy for phones, session outside the meeting time).
  - The steps reuse the meeting page's own forms, so both behave the same.
- **QR code before publishing** — the QR step can create the code while the meeting is still a draft, so it can
  be printed in advance. Until the meeting is published, phones that scan it see *"This meeting has not opened
  yet"*. (Change from Phase 3, where codes were created only on publishing; see below.)
- **QR display mode** for a projector or hall TV, designed for **1920 × 1080** and fitting smaller screens
  (1366 × 768, 1280 × 720): organisation logo and name, meeting title, a large QR code, *"Scan to access
  presentation and supporting material"* and *"Open your mobile camera and scan the QR code"* in English and
  ಕನ್ನಡ, nothing else. Optional **live participant count** beside the code. Controls disappear after 3 seconds
  without mouse or keyboard use.
- **Presenter mode** (*Start presentation*): a clean full-screen view with **NOW** (session, presenter, time
  slot, countdown that turns amber in the last 5 minutes and red when over time, progress bar), **NEXT**, the
  clock, the **meeting timer** (elapsed / left), the QR code and optionally the participant count. Before the
  first session it shows *Starts in …*, between sessions *Break*, after the last *Thank you*. When the meeting
  runs early or late the presenter moves NOW/NEXT by hand (← →, or buttons), and returns to the timetable with T.
  Q shows/hides the QR code, C the count, F full screen. It does not interfere with PowerPoint, which runs
  separately.
- **Live participant count** — *Active now* (opened the meeting in the last 10 minutes), *Total participants*,
  current session and presenter on the meeting page, refreshing every 5 seconds; also on the display and
  presenter screens. **Numbers only, never names.** Administrators and organisers always see it; presenters only
  for meetings they present in, and only if the organisation allows it (new setting under Organisation →
  Participants, on by default). The Super Admin and other organisations cannot see it.
- **Help** — updated *How to create a meeting*, new *Presenter mode during the meeting*.
- Smaller improvements found while testing: pop-up messages no longer cover the page title (top right, at most
  two at a time); the step bar fits on laptop and phone screens.

## Change to an earlier rule (please confirm)

In Phase 3 a QR code existed only after publishing. The specification's wizard puts *Generate QR* before
*Review & publish*, so a code can now also be created for a draft (and printed early). It does not open
anything until the meeting is published. If you prefer the old rule, the QR step can instead say "created when
you publish" — a one-line change.

## Test results (fresh stack, 03-10-2026)

| Suite | Result |
|---|---|
| API / security / database (`tests/api`) | **131 / 131 passed** (122 Phases 1–3 + 9 Phase 4) |
| Browser end-to-end incl. accessibility (`tests/e2e`) | **24 / 24 passed**, twice in a row (16 Phases 1–3 + 8 Phase 4, at 1920 × 1080, laptop and phone sizes) |

Defects found and fixed during Phase 4 testing:
- the faded (25 % opacity) controls on the display/presenter screens failed the colour-contrast check — they are
  now fully visible while in use and hidden when idle;
- several "Changes saved" messages stacked over the page title during the wizard;
- the seven-step bar wrapped onto two uneven lines on a 1366-pixel laptop and on phones;
- an accessibility check in the new tests sometimes ran while a pop-up message was fading in or out (a test
  timing issue, not a contrast problem); fixed in the test.

## Requirement checklist (Phase 4 scope)

| Requirement | Implemented | Tested | Notes |
|---|:-:|:-:|---|
| §24 Meeting creation wizard: details, presenters, presentations, attachments, access & downloads, QR, review & publish | ✔ | ✔ | saves at each step; resumable |
| §24 "Meeting Published Successfully" with QR, link, Display / Download / Print / Copy | ✔ | ✔ | plus *Start presentation* |
| §11 QR display mode: logo, title, "Scan to access presentation and supporting material", large QR, camera hint, uncluttered | ✔ | ✔ | 1920 × 1080, 1366 × 768, 1280 × 720 |
| §35 Presenter mode: Start presentation, full screen, session info, QR, participant count, meeting timer, current and next session; does not interfere with PowerPoint | ✔ | ✔ | separate browser tab |
| §36 Live participant count for authorised users: currently registered / total, current session, presenter | ✔ | ✔ | "Active now" = opened in the last 10 minutes; refreshes every 5 s |
| §37 Session switching: NOW / NEXT | ✔ | ✔ | from the timetable, with manual override |
| Q-table: presenters see the count only if permitted | ✔ | ✔ | organisation setting |
| Kannada for all new screens | ✔ | ✔ (presenter mode, wizard labels) | native review still pending |

## Upgrading a Phase 3 installation

`docker compose up -d --build` applies migration `0004` automatically (adds one organisation setting and
replaces two database functions). No data changes.

## Not yet verified

- On a real projector / hall TV (only 1920 × 1080 and smaller browser windows were tested), including how
  readable the QR code is from the back of a large hall.
- Presenter mode on a second screen beside PowerPoint on the Windows laptop (works as a separate browser
  window; arrangement depends on the laptop's display settings).
- Kannada wording by a native reviewer; Windows installation steps (as in earlier reports).

## Next: Phase 5

Dashboards and reports: attendance and activity reports with filters, PDF / Excel / CSV export with the
organisation's logo, organisation and Super Admin dashboards.
