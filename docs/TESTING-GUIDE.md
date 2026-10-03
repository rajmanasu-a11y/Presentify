# Presentify — Testing guide

How to test Presentify yourself, at three levels:

| Level | What it tells you | Time | Who |
|---|---|---|---|
| **1. Automated tests** | The server rules, security and every screen still work exactly as designed | ~15 min (unattended) | anyone who can open a command window |
| **2. Installation check** | *This* installation works end to end: sign-in, a meeting, a phone reading the PDF | ~5 min | after every installation or upgrade |
| **3. Manual acceptance test** | It works for real people, on real phones, on your projector, in your hall | 2–3 hours | you and 2–3 colleagues |

> The laptop installation runs in **test mode** (plain `http://`, banner *"Test mode — not for official use"*).
> Use **DEMO names** only (e.g. "Ravi Kumar (DEMO)"); do not enter real personal data.

---

## 1. Prerequisites

### For every level

- Windows 11 laptop, 16 GB RAM recommended (8 GB minimum), about 30 GB free disk space.
- **Docker Desktop** installed and showing *"Engine running"*, and Presentify installed as described in
  [INSTALL-LAPTOP-WINDOWS.md](INSTALL-LAPTOP-WINDOWS.md).

### Additionally for levels 1 and 2 (automated tests, installation check)

| What | Why | Where |
|---|---|---|
| **Git for Windows** | provides *Git Bash*, the window in which the test commands run | <https://git-scm.com/download/win> (default options) |
| **Node.js 22 LTS** | runs the test programs | <https://nodejs.org> → LTS |
| Test tools and test browser (once, ~200 MB, needs internet) | | in Git Bash: `cd /c/Presentify/tests && npm ci && npx playwright install chromium` |
| Free ports **8090, 54322, 54399** | the automated tests start a separate, temporary copy of Presentify there | close other programs using them |
| ~3 GB of free memory while the tests run | the temporary copy runs beside your installation | close large programs |

The automated tests **never touch your data**: they use their own temporary copy (separate database and files)
and remove it at the end.

### Additionally for level 3 (manual acceptance test)

- **Phones:** at least one **Android** phone (Chrome) and one **iPhone** (Safari); if possible also an older
  or low-cost phone.
- **Network:** a **mobile hotspot** (best) or a Wi-Fi network on which phones can reach the laptop — many office
  networks block this. Laptop and phones on the same network. `PUBLIC_URL` in `.env` must be the laptop's
  address on that network (see the installation guide).
- **Authenticator app** on one phone (Google Authenticator or Microsoft Authenticator) for the Super Admin.
- **A projector or TV** with HDMI for the display and presenter screens (and the laptop's *Win + P → Extend*).
- **Sample files** (keep them in one folder):
  - a real **PowerPoint** (.pptx) of 15–40 slides **and** its PDF copy (*File → Save as → PDF*);
  - a **Word** document and its PDF copy;
  - a **long PDF** (50+ pages) and a **scanned PDF** (photos of pages);
  - a PDF containing **Kannada** text;
  - a **JPG/PNG** image; optionally a short **MP4** (only if video is enabled for the organisation);
  - a "fake" file: a text file renamed to `test.pdf` (must be refused).
- **Three test e-mail addresses** — they do not need real mailboxes (no e-mails are sent), e.g.
  `admin@test.local`, `organiser@test.local`, `presenter@test.local`.
- 2–3 colleagues for the participant tests, and a printout of the checklist in section 4 (or copy it into a
  spreadsheet) to tick results.

---

## 2. Level 1 — Automated tests

Open **Git Bash** and run:

```bash
cd /c/Presentify
scripts/test.sh              # everything (~15 minutes)
scripts/test.sh api          # only the server / security / database tests (~4 minutes)
KEEP_STACK=1 scripts/test.sh # keep the temporary copy running afterwards (needed for the load test)
```

**Reading the result.** At the end you should see two summaries:

```
# tests 134
# pass 134
# fail 0          ← server / security / database tests
...
  30 passed       ← browser tests (screens, phone, Kannada, accessibility, security, sign-out)
```

Any `fail`, `✘` or `failed` means something is wrong. For a failed browser test Playwright saves a screenshot and
a recording in `tests/test-results/`; open the recording with
`cd tests && npx playwright show-trace test-results/<folder>/trace.zip`. Send the folder with your report.

**What the automated tests cover** (details in [TESTING.md](TESTING.md)):

| Area | Examples of what is checked |
|---|---|
| Separation of organisations | every table and function is tried from another organisation and from outside — nothing leaks; the Super Admin sees no participant data |
| Sign-in security | password rules, lockout after 5 wrong passwords, authenticator codes, deactivated users and organisations, forged keys, sign-out after inactivity |
| Files | allowed types only, size and storage limits, disguised files (a web page renamed to .pdf) refused and deleted, files opened only through 60-second links |
| QR codes and participants | valid / replaced / expired / switched-off codes, opening times, passcode, required details and consent, participant limit under a rush, downloads only where allowed, retention (automatic deletion) |
| Screens | the full journeys of Phases 1–4 in a real browser (laptop, phone, 1920 × 1080 projector), English and Kannada, accessibility (WCAG 2 AA) |
| Hostile input | text that tries to run programs, typed into every field, is shown as plain text everywhere |

**Load test** (many phones scanning together from one Wi-Fi network). After `KEEP_STACK=1 scripts/test.sh`:

```bash
cd /c/Presentify/tests
PRESENTIFY_ENV_FILE=../.env.test npm run test:load -- 500 100   # 500 phones, 100 at a time
```

Expect `failures: none`. Then remove the temporary copy:
`docker compose -p presentify-test --env-file .env.test -f docker-compose.yml -f docker-compose.test.yml down -v`.

---

## 3. Level 2 — Installation check (after installing or upgrading)

It drives the real screens of **your** installation like a person would — Super Admin first sign-in with an
authenticator, an organisation and its administrator, a meeting through the wizard with a PDF and a QR code,
a phone registering and reading the PDF, attendance, presenter mode and the QR display.

1. Create a Super Admin just for the check (PowerShell, in `C:\Presentify`):
   ```powershell
   docker compose run --rm tools create-superadmin --email check@test.local --name "Installation Check"
   ```
   Note the temporary password it prints.
2. In Git Bash (use the same address as `PUBLIC_URL` in `.env`):
   ```bash
   cd /c/Presentify/tests
   PRESENTIFY_URL=http://192.168.1.20:8080 CHECK_SA_EMAIL=check@test.local CHECK_SA_PASSWORD=<temporary password> npm run test:install
   ```
3. Expect **`5 passed`** and *"Installation check passed"*. If step 4 fails with a `PUBLIC_URL` message, the QR
   codes point to a different address than the one you used — fix `PUBLIC_URL` in `.env` and run
   `docker compose up -d`.
4. The check leaves an organisation called *"Installation check DEMO …"*. To hide it, sign in as your own Super
   Admin → Organisations → that organisation → *Status & subscription* → *Deactivated*. Each run needs a new check Super
   Admin (step 1 with a different e-mail, e.g. `check2@test.local`).

---

## 4. Level 3 — Manual acceptance test (checklist)

Work through the tables in order; tick ✔ or ✘ and write what you saw. **Expected** is what should happen.
Use DEMO names. Times are India time.

### A. First start and Super Admin

| ID | Steps | Expected | ✔/✘ |
|---|---|---|---|
| A1 | Double-click `install.cmd`; when asked, enter your e-mail and name | Presentify starts; a temporary password and the addresses to open are shown; the browser opens | |
| A1b | Double-click `install.cmd` a second time | *Keeping the existing configuration*, *A Super Admin already exists* — nothing is lost | |
| A2 | Open `PUBLIC_URL` on the laptop; sign in with the temporary password | asked to choose a new password | |
| A3 | Try `password123` as the new password | refused with a plain explanation (≥ 10 characters, upper, lower, digit) | |
| A4 | Choose a strong password; scan the QR code with the authenticator app; type the code | *Presentify administration* console opens | |
| A5 | Sign out and sign in again | asks for the 6-digit code; works | |
| A6 | Switch the sign-in page to ಕನ್ನಡ and back | all text changes; nothing cut off | |

### B. Organisation and users

| ID | Steps | Expected | ✔/✘ |
|---|---|---|---|
| B1 | Console → Organisations → New organisation (package *Government / Internal*) | organisation created; *Staff* tab opens | |
| B2 | Add user → Organisation Admin (`admin@test.local`) | a temporary password is shown once | |
| B3 | In another browser (or a private window) sign in as that admin; change the password | Welcome dashboard of the organisation | |
| B4 | Organisation → upload a logo, set tagline, brand colour | logo appears top left and on the phone page later | |
| B5 | Organisation → Participant settings: tick *Mobile number — Ask*; write a consent text in English and ಕನ್ನಡ | saved | |
| B6 | Users → add an Organiser and a Presenter | both created with temporary passwords | |
| B7 | As Super Admin: the organisation → *Package & limits* → set *User accounts* to the current number; as admin try to add one more user | refused: limit reached | |
| B8 | Deactivate the Presenter; try to sign in as the Presenter | sign-in refused | |
| B9 | Audit log | shows the actions above with names and times | |

### C. Security

| ID | Steps | Expected | ✔/✘ |
|---|---|---|---|
| C1 | Type a wrong password 5 times for the Organiser, then the right one | *"Too many unsuccessful attempts. Your account is locked…"*; works again after 15 minutes | |
| C2 | Create a second organisation with its own admin; as admin of org 1 copy a meeting's address from the browser; open it as admin of org 2 | *Page not found* | |
| C3 | As Super Admin open the console | organisations and usage only — no participant names anywhere | |
| C4 | Sign in, then do not touch the laptop for 30 minutes | at 29 minutes *"Are you still there?"*; at 30 minutes signed out with an explanation | |
| C5 | Sign in, open a meeting's *Show full screen* (QR display), leave it 40 minutes | the display stays on (meant for meetings) | |

### D. Creating a meeting (wizard)

| ID | Steps | Expected | ✔/✘ |
|---|---|---|---|
| D1 | Dashboard → Create meeting; fill title, today's date, times, venue → *Save and continue* | Step 2; a meeting number MTG-2026-xxxx is given | |
| D2 | Add session → *New presenter* (create one inside the form) → save; add a second session | both sessions listed with times and presenter | |
| D3 | Step 3: add a presentation, upload the **PowerPoint** | *No viewable copy yet* shown | |
| D4 | Upload its **PDF copy** | *PDF ready for phones* | |
| D5 | Upload the **fake** `test.pdf` (renamed text file) | refused with a plain message; nothing added | |
| D6 | Upload a file bigger than the organisation's file limit | refused before uploading | |
| D7 | Step 4: add the Word document **and** the long PDF as supporting material | both listed; the Word file asks for a PDF copy | |
| D8 | Step 5: *Details are optional*, *At any time*, set a passcode `HALL26`, downloads **off** | each change saved | |
| D9 | Step 6: *Create QR code*; *Download image*; *Print* | PNG saved; a clean print page with the code | |
| D10 | Step 7: read the warnings (Word file without PDF copy, session without presentation) → *Publish meeting* | *Meeting Published Successfully* with QR code and buttons | |
| D11 | Close the browser in the middle of another new meeting; reopen it from Meetings → *Continue setup* | continues where you stopped | |

### E. Participants on real phones (Android **and** iPhone)

| ID | Steps | Expected | ✔/✘ |
|---|---|---|---|
| E1 | Show the QR code (D9/D10); scan it with the phone **camera** | page opens with logo, organisation, meeting title — no app needed | |
| E2 | Switch language to ಕನ್ನಡ | everything in Kannada, readable | |
| E3 | Press *Continue* with empty fields; then without ticking *I agree* | clear messages next to the fields | |
| E4 | Enter the wrong passcode, then `HALL26` | *passcode is not correct*, then the sessions appear | |
| E5 | Open the PowerPoint's PDF copy | slides fill the phone width, sharp text; *Page 1 of N* | |
| E6 | *Full screen*; turn the phone sideways; swipe left/right; tap the screen edges | one slide fills the screen in both directions; pages turn | |
| E7 | Look at the view-only document | no *Download* button; your name faintly across the page | |
| E8 | As organiser allow downloads for one document; on the phone pull to refresh and download it | the file downloads with its name | |
| E9 | Open the long PDF and scroll to the end; open the scanned PDF; open the Kannada PDF | everything renders; Kannada letters correct | |
| E10 | Open the Word document (no PDF copy) | *Preview not available on the phone* (no crash) | |
| E11 | Close the browser; scan again | goes straight to the material (no form) | |
| E12 | Tick *Remember my details* in one meeting; scan another meeting's QR | the form is pre-filled | |
| E13 | As organiser *Replace with a new QR code*; scan the **old** printed code | *This QR code is not valid* | |
| E14 | Create a meeting for tomorrow with *Around the meeting time*; scan its code | *not opened yet — opens at …* | |
| E15 | Turn off Wi-Fi / mobile data and press a button | *Cannot reach the Presentify server* with *Try again* | |
| E16 | 20–30 colleagues scan the code within one minute and open the PDF | everyone gets in; note any slow phone (model) | |

### F. Projector: QR display and presenter mode

| ID | Steps | Expected | ✔/✘ |
|---|---|---|---|
| F1 | Meeting → QR code & access → *Show full screen*; press F11 or *Full screen* | logo, title, large QR, bilingual "Scan to access…" — nothing else | |
| F2 | Scan the projected code from the **back row** of the hall | phones read it (note the distance) | |
| F3 | Move the mouse → *Participant count*; let a colleague register | count shown; goes up within ~5 seconds | |
| F4 | Meeting → *Start presentation* | NOW (session, presenter, countdown), NEXT, clock, meeting timer, QR | |
| F5 | Press → , ←, T, Q, C, F | next/previous session, back to timetable, QR on/off, count on/off, full screen | |
| F6 | *Win + P → Extend*: PowerPoint slideshow on the projector, presenter mode on the laptop (or the other way round) | both run; Presentify does not interfere with PowerPoint | |
| F7 | Leave the mouse still for 3 seconds | the buttons disappear; move the mouse — they return | |

### G. Attendance and live figures

| ID | Steps | Expected | ✔/✘ |
|---|---|---|---|
| G1 | Meeting → Participants | everyone who registered, with time and what they opened | |
| G2 | Meeting page *Live* strip during the meeting | *Active now*, *Total participants*, current session and presenter; updates by itself | |
| G3 | Dashboard | active QR codes, participants today and in 30 days | |
| G4 | Sign in as the Presenter: open the meeting | QR code can be shown; no Participants tab; count visible only if *Presenters may see the live participant count* is on | |

### H. Data protection

| ID | Steps | Expected | ✔/✘ |
|---|---|---|---|
| H1 | Phone registration page | your consent text (or the default one) with the retention period | |
| H2 | Organisation → Participant settings → retention 30 / 90 / 180 / 365 days | saved; cannot exceed the package maximum | |
| H3 | Automatic deletion after the retention period | cannot be waited for manually — covered by the automated tests (`06-qr-participants`, "retention") | n/a |

---

## 5. Reporting a problem

For each ✘ note: **test ID**, the steps, what you expected, what happened, a **screenshot or photo**, the
**phone model and browser** (for phone tests) and the **time**. Server logs for the last half hour:

```powershell
docker compose logs --since 30m > presentify-logs.txt
```

Never send the `.env` file (it contains the master keys).

---

## 6. Not covered yet

- Reports and exports (Phase 5); backups, demo data and the remaining guides (Phase 6).
- HTTPS and the State Data Centre set-up (planned with the SDC installation).
- E-mail (no e-mail server yet; administrators issue temporary passwords).
- The automated tests use Chromium only; **iPhone/Safari and Firefox are covered only by the manual checks above**.
- The test commands have been run on Linux; on Windows they are expected to work in Git Bash but have not yet
  been run there — please report any problem.
