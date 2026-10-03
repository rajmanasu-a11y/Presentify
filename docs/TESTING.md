# Testing

All tests run against a **separate, disposable stack** (Docker project `presentify-test`,
port 8090, its own database). Real data is never touched.

```bash
scripts/test.sh          # API/security tests, then browser tests
scripts/test.sh api      # API/security tests only
KEEP_STACK=1 scripts/test.sh   # leave the test stack running afterwards
```

A load check of many phones scanning at once (run while the test stack is up, e.g. with `KEEP_STACK=1`):

```bash
cd tests && PRESENTIFY_ENV_FILE=../.env.test npm run test:load -- 300 60   # 300 participants, 60 at a time
```

Browser tests need Chromium: `cd tests && npx playwright install chromium` once, or set
`PW_CHROMIUM_PATH` to an installed Chromium.

## What is tested (Phases 1–4)

**API / security / database** (`tests/api`, 134 tests)

| File | Covers |
|---|---|
| `00-repository` | Windows scripts are plain ASCII (Windows PowerShell 5.1 misreads other characters); line endings LF for Linux files and CRLF for Windows scripts; no `.env` or certificates committed |
| `01-gateway` | security headers, SPA routing, no secrets in runtime config, Auth admin blocked, sign-up disabled, forged/missing tokens rejected, anonymous access to every table and RPC refused |
| `02-tenancy` | organisation admins see/change only their organisation (organisations, settings, profiles, limits, usage, staff); cannot create organisations or change package/limits/status/expiry; organisers' restrictions; no direct writes to profiles/audit/system settings; Super Admin sees all; Super Admin without MFA sees nothing |
| `03-users-and-limits` | temporary password and forced change; password policy; duplicate e-mail; input validation; administrator and user limits enforced by the server (no orphan logins); Super Admin raises limits; no self-deactivation/self-demotion; deactivation blocks sign-in and existing tokens; temporary password reset; role changes; own-profile updates; deactivated organisation; grace period; view-only after grace; retention vs package |
| `04-signin-audit-storage` | lockout after 5 failures (even with the right password) and login events; MFA reset; audit actor/old-new values/IP; audit records immutable (update/delete/truncate); audit visibility per organisation; actor header cannot be spoofed; branding upload/read limited to own organisation; only images accepted; usage reporting |
| `05-meetings-content` | presenter directory isolation; automatic meeting numbers; time validation; organiser/admin/presenter rights; no hand-over by organisers; cross-organisation invisibility; no publishing without sessions; archive is read-only and restorable; deleting only empty drafts; PDF and PowerPoint uploads, PDF copies, versions and restore; presenters cannot restore; supporting material; presenters upload only to their own sessions; disallowed types (exe, html, svg, js, no extension); disguised web page rejected and deleted; wrong content type; file-size limit (declared and actual); storage quota; removal frees space; upload acceptance not callable from browsers; no direct storage uploads; file access by organisation and by meeting; meeting/presentation limits; audit attribution |
| `06-qr-participants` | QR created on publishing (one active); who may read, replace and switch it off; unknown, malformed and missing tokens; landing page without internal identifiers; availability (not yet open, custom window, days after the meeting, until archived, archived); setting validation; `has_passcode` only through the passcode function; required fields, consent, text-only values, anonymous entry only where allowed; access token (only its hash stored); same person not counted twice; trimming, control characters, length cap, unknown fields dropped; mobile/e-mail validation; directory linking across meetings; "remember me" in the same organisation only; passcode (bcrypt, case-sensitive, never shown to staff); optional / no registration; participant limit, including 20 simultaneous registrations against 10 places; registrations audited; content needs a valid access token for this meeting; visible items with view/download rights; short-lived signed links (tampered link refused); downloads only where allowed (with `Content-Disposition: attachment`); no preview for PowerPoint without a PDF copy; hidden items, wrong kind and other meetings' items refused; "release at session start"; events recorded with IP; replaced / expired / switched-off codes; view-only and deactivated organisations; who can see participant data (admins and organisers yes; presenters, other organisations, Super Admin, public no); no direct changes; participant functions not callable from browsers; retention (details removed after the period, counts kept, remembered devices removed; IP/browser blanked in events, attendance and audit log without opening the audit log to other changes; nightly schedule) |
| `07-display-live` | QR code made for a draft (audited, "not open yet", no registration), kept on publishing; presenters, other organisations and the public cannot make one; archived meetings refused; a meeting moved back to draft hides its material; live figures (total, registered, active now, joined recently, views, downloads — no names); who may see them (administrators, organisers, the meeting's presenter; presenters lose them when the organisation switches the setting off; other presenters, other organisations, Super Admin, public refused); only administrators change the setting |
| `99-rate-limit` | rapid sign-in attempts are refused with a JSON message and `Retry-After` (runs last) |

**Browser** (`tests/e2e`, Playwright, 30 tests)

- sign-in page: accessibility (axe, WCAG 2 A/AA, no serious/critical issues), English ⇄ Kannada
- wrong password message
- Super Admin first sign-in: forced password change → authenticator set-up (real TOTP) → console
- Super Admin creates an organisation, adds its administrator (temporary password), changes limits
- Organisation Admin: first sign-in, console blocked, profile, logo upload, registration fields, add organiser, audit log, Kannada interface
- dashboard accessibility
- phone layout (Pixel 7): no sideways scrolling, touch-size buttons
- meeting journey: presenter directory, meeting from the dashboard, publishing refused without sessions, session with presenter, PowerPoint upload + PDF copy, disguised file refused with a plain message, supporting document, new version with notes, version history and restore, publish, accessibility of the meeting page
- the meeting appears on the dashboard, in Presentations and in Meetings
- **phone (Pixel 7)**: scan link → form with plain-language errors → register → sessions with "Now" →
  view-only and downloadable items → PDF renders on canvases that fit the phone width (pixels checked) →
  watermark with the participant's name → full screen, next page, swipe → fits and fills the screen turned
  sideways, on a 320 px phone, on a tablet → download only where allowed → reopening goes straight to the material
  → views and downloads recorded; Kannada registration; invalid, ended and not-yet-open links; accessibility
- **QR code & access**: publish → QR appears → open at any time → passcode → replace the code (warning; old code
  refused on a phone) → full-screen display with the current code → participant with wrong then right passcode →
  Participants tab shows the person and what they opened → dashboard count; presenters can display but not change
  the code or see participants; Kannada; accessibility
- **wizard**: Create meeting → details → session with a new presenter added from inside the session form →
  second session → presentation upload → supporting document → access settings → QR code created before
  publishing ("not open yet" for phones) → review with warnings → publish → "Meeting Published Successfully"
  with the same QR code, link and Display / Download / Print / Copy; continuing a draft later (publishing blocked
  without sessions); the wizard on a phone; accessibility
- **QR display at 1920 × 1080**: bilingual instruction, QR taller than 550 px, nothing below the screen (also at
  1366 × 768 and 1280 × 720), live count off by default, on → updates by itself when a phone registers
- **presenter mode at 1920 × 1080**: NOW with presenter and countdown, NEXT, meeting timer, QR; → / T / Q / C
  keys; controls hide when idle; the meeting's presenter can use it and the count follows the organisation
  setting; Kannada; accessibility
- **live panel** on the meeting page updates by itself
- **hostile input** (`security.spec`): script-like text in every displayed field is shown as plain text on all
  staff screens, presenter mode, QR display and the phone page; an injected script is blocked by the CSP
- **sign-out after inactivity** (`session.spec`): warning, sign-out with explanation; activity and *Stay signed
  in* keep the session; QR display and presenter screens stay on

**Installation check** (`tests/acceptance`, run against a real installation — see
[TESTING-GUIDE.md](TESTING-GUIDE.md)): Super Admin first sign-in with authenticator → organisation →
administrator → wizard → publish → phone registers and reads the PDF → attendance, presenter mode, QR display.

## Results

See [TEST-REPORT-2026-10-03.md](TEST-REPORT-2026-10-03.md) for the latest full run, and
[TESTING-GUIDE.md](TESTING-GUIDE.md) for prerequisites and the manual acceptance checklist.
