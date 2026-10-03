# Installing Presentify on your laptop (Windows 11)

This guide sets up Presentify on a Windows 11 laptop for **testing and demonstrations**.
It takes about 30–45 minutes the first time (mostly downloads).

> **Test mode.** On the laptop Presentify runs over plain `http://`, because phones do not
> trust home-made security certificates. Every screen shows *"Test mode — not for official use"*.
> Do not collect real personal data in this mode. The State Data Centre installation uses HTTPS.

## What you need

- Windows 11, 16 GB RAM recommended (8 GB minimum), about 30 GB of free disk space
- Administrator rights on the laptop (only for installing Docker Desktop)
- Internet access during installation

## Step 1 — Install Docker Desktop

1. Download **Docker Desktop for Windows** from <https://www.docker.com/products/docker-desktop/>.
2. Run the installer and keep the default option **"Use WSL 2"**.
3. Restart the laptop when asked.
4. Open **Docker Desktop** from the Start menu and wait until it shows *"Engine running"*.
   (The first start may ask you to install a WSL update — accept it.)

## Step 2 — Get Presentify

Either:

- **Download ZIP:** open <https://github.com/rajmanasu-a11y/Presentify>, choose **Code → Download ZIP**,
  and extract it to a simple folder such as `C:\Presentify`; or
- **Git:** `git clone https://github.com/rajmanasu-a11y/Presentify.git C:\Presentify`

## Step 3 — Create the configuration (once)

1. Open **PowerShell** (Start menu → type *PowerShell*).
2. Run:

   ```powershell
   cd C:\Presentify
   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
   ```

   This creates a file called `.env` with new random passwords and keys, and detects the laptop's
   Wi-Fi address (for example `http://192.168.1.20:8080`) so phones can reach it.
   **Keep `.env` private** — it contains the master keys.

## Step 4 — Start Presentify

```powershell
docker compose up -d --build
```

The first time this downloads about 2 GB and builds the screens (10–20 minutes).
When it finishes, check that everything is running:

```powershell
docker compose ps
```

All services should show `running` or `healthy` (`migrate` shows `exited (0)` — that is correct;
it prepares the database and stops).

## Step 5 — Create the Super Admin (once)

```powershell
docker compose run --rm tools create-superadmin
```

Enter your e-mail address and name. A **temporary password** is shown — note it down.

## Step 6 — Sign in

1. On the laptop, open <http://localhost:8080>.
2. Sign in with your e-mail and the temporary password.
3. Choose your own password (at least 10 characters, with upper-case and lower-case letters and a number).
4. Set up an authenticator app on your phone (Google Authenticator or Microsoft Authenticator):
   scan the QR code on screen and type the 6-digit code.
5. You are now in **Presentify administration**: create an organisation, then add its administrator.

## Using phones on the same network

- Connect the laptop and the phones to the **same Wi-Fi**. A **mobile hotspot** works best;
  many office Wi-Fi networks block phone-to-laptop connections.
- The address is the one shown by the setup script (e.g. `http://192.168.1.20:8080`).
- If Windows asks whether to allow Docker on the network, choose **Private networks → Allow**.
- If the laptop's Wi-Fi address changes (different network), edit `PUBLIC_URL` in `.env`
  and run `docker compose up -d` again.
- **QR codes contain this address.** If it changes, QR codes printed or downloaded earlier point to the old
  address: show or print them again from the meeting's *QR code & access* tab (the meeting keeps the same code).
  Check before a meeting by scanning the displayed QR code with your own phone.

## Everyday commands

| Task | Command (in `C:\Presentify`) |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| See status | `docker compose ps` |
| Update after downloading a new version | `docker compose up -d --build` |
| See problems | `docker compose logs --tail 100 web auth functions` |

`docker compose down` keeps all data. **Never** add `-v` (that deletes the database and files).

## If something goes wrong

| What you see | What to do |
|---|---|
| `run the setup script first` | Step 3 was not done in this folder. |
| Build fails with `SELF_SIGNED_CERT_IN_CHAIN` | Your network inspects HTTPS. Put the organisation's root certificate (`.crt`) in `docker\certs\` and build again — see `docker\certs\README.md`. |
| Port 8080 already in use | Change `HTTP_PORT` and the port in `PUBLIC_URL` in `.env`, then `docker compose up -d`. |
| Phones cannot open the address | Use a mobile hotspot; check the Windows firewall prompt; check `PUBLIC_URL` matches the laptop's current Wi-Fi address (`ipconfig`). |
| Forgot the Super Admin password | Run Step 5 again with a different e-mail, or ask for help to reset it. |
