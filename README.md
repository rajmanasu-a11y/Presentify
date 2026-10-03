# Presentify

**Present. Scan. Access.** — One Presentation. One QR Code. Zero Unnecessary Paper.

Presentify is a digital presentation-sharing, meeting-attendance and document-distribution platform for organisations,
training institutions, government offices and corporate meetings. Participants scan one QR code, enter their details and
view the presentation and supporting material on their own phone — no printed handouts, no app installation.

> **Status: Phases 1–4 of 6 complete** — organisations, staff accounts, sign-in with MFA, limits, audit,
> English/ಕನ್ನಡ; meetings with sessions and presenters, presentation uploads with versions, PDF copies and
> supporting material; QR codes, participant registration, the phone PDF viewer, download control, attendance and
> data retention; the create-meeting wizard, QR display mode, presenter mode and live participant count.
> Reports: [Phase 1](docs/PHASE-1-REPORT.md) · [Phase 2](docs/PHASE-2-REPORT.md) · [Phase 3](docs/PHASE-3-REPORT.md)
> · [Phase 4](docs/PHASE-4-REPORT.md).

## Quick start

**Windows 11 laptop:** follow [docs/INSTALL-LAPTOP-WINDOWS.md](docs/INSTALL-LAPTOP-WINDOWS.md).

**Linux:**

```bash
scripts/setup.sh                               # creates .env with fresh secrets
docker compose up -d --build                   # starts Presentify on port 8080
docker compose run --rm tools create-superadmin
```

Open `http://<server-address>:8080` and sign in.

## Technology

Self-hosted Supabase (PostgreSQL 17 with Row-Level Security, Auth, Storage, Edge Functions) ·
React + TypeScript + Mantine · nginx gateway · Docker Compose. Details:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documents

| Document | Contents |
|---|---|
| [docs/01-FINAL-REQUIREMENTS.md](docs/01-FINAL-REQUIREMENTS.md) | Confirmed requirements specification |
| [docs/00-DISCOVERY.md](docs/00-DISCOVERY.md) | Original analysis, questions, ER diagram |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Services, data model, security model |
| [docs/INSTALL-LAPTOP-WINDOWS.md](docs/INSTALL-LAPTOP-WINDOWS.md) | Laptop installation (Windows 11) |
| [docs/TESTING.md](docs/TESTING.md) | How to run the tests and what they cover |
| [docs/PHASE-1-REPORT.md](docs/PHASE-1-REPORT.md) | Phase 1 delivery, test results, checklist |
| [docs/PHASE-2-REPORT.md](docs/PHASE-2-REPORT.md) | Phase 2 delivery, test results, checklist |
| [docs/PHASE-3-REPORT.md](docs/PHASE-3-REPORT.md) | Phase 3 delivery, test results, load check, checklist |
| [docs/PHASE-4-REPORT.md](docs/PHASE-4-REPORT.md) | Phase 4 delivery, test results, checklist |

## Tests

```bash
scripts/test.sh        # disposable test stack on port 8090: 131 API/security + 24 browser tests
```
