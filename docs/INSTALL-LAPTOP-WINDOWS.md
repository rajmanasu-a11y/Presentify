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

## Step 3 — Run the installer

1. Connect the laptop to the Wi-Fi or **mobile hotspot** that the phones will use (the installer records the
   laptop's address on that network — it goes into every QR code).
2. In `C:\Presentify`, double-click **`install.cmd`**. (Or in PowerShell:
   `powershell -ExecutionPolicy Bypass -File install.ps1`.)
3. The installer:
   1. checks that Docker Desktop is running;
   2. creates the private settings file **`.env`** with new random keys (**keep it private and keep a copy** —
      it holds the master keys);
   3. builds and starts Presentify — the first time this downloads about 2 GB (10–20 minutes);
   4. asks for the **e-mail address and name of the first Super Admin**, and shows a **temporary password** —
      write it down;
   5. shows the addresses to open and opens the browser.

   If you run it as administrator (right-click → *Run as administrator*) it also allows port 8080 for phones in the
   Windows Firewall (private networks only). Otherwise allow Docker when Windows asks (*Private networks → Allow*).

To use a specific address or port: `install.cmd -PublicUrl http://192.168.1.20:8080` or `install.cmd -Port 8081`.

Running `install.cmd` again later is safe: it keeps your data and settings, starts Presentify, and offers to update
the address if the laptop has joined a different network.

<details><summary>Manual installation (without the installer)</summary>

```powershell
cd C:\Presentify
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1     # creates .env
docker compose up -d --build                                  # builds and starts
docker compose ps                                             # all healthy; migrate: exited (0)
docker compose run --rm tools create-superadmin               # first Super Admin
```
</details>

## Step 4 — Sign in

1. On the laptop, open <http://localhost:8080> (staff on other computers or phones on the same network use the
   address shown by the installer, e.g. `http://192.168.1.20:8080`).
2. Sign in with your e-mail and the temporary password.
3. Choose your own password (at least 10 characters, with upper-case and lower-case letters and a number).
4. Set up an authenticator app on your phone (Google Authenticator or Microsoft Authenticator):
   scan the QR code on screen and type the 6-digit code.
5. You are now in **Presentify administration**: create an organisation, then add its administrator.
   Participants never sign in — they scan a meeting's QR code.

To check the whole installation automatically (sign-in, a meeting, a phone reading a PDF), see
*Installation check* in [TESTING-GUIDE.md](TESTING-GUIDE.md).

## Using phones on the same network

- Connect the laptop and the phones to the **same Wi-Fi**. A **mobile hotspot** works best;
  many office Wi-Fi networks block phone-to-laptop connections.
- The address is the one shown at the end of the installer (e.g. `http://192.168.1.20:8080`).
- If Windows asks whether to allow Docker on the network, choose **Private networks → Allow**.
- If the laptop's Wi-Fi address changes (different network), double-click `install.cmd` again — it offers to
  update the address (or edit `PUBLIC_URL` in `.env` and run `docker compose up -d`).
- **QR codes contain this address.** If it changes, QR codes printed or downloaded earlier point to the old
  address: show or print them again from the meeting's *QR code & access* tab (the meeting keeps the same code).
  Check before a meeting by scanning the displayed QR code with your own phone.

## Everyday commands

| Task | Command (in `C:\Presentify`) |
|---|---|
| Start | `docker compose up -d` (or double-click `install.cmd`) |
| Stop | `docker compose down` |
| See status | `docker compose ps` |
| Update after downloading a new version | `docker compose up -d --build` |
| See problems | `docker compose logs --tail 100 web auth functions` |

`docker compose down` keeps all data. **Never** add `-v` (that deletes the database and files).

## If something goes wrong

| What you see | What to do |
|---|---|
| `Docker Desktop is not running` | Start Docker Desktop, wait for *Engine running*, run `install.cmd` again. |
| `run the setup script first` | Run `install.cmd` in this folder. |
| Build fails with `SELF_SIGNED_CERT_IN_CHAIN` | Your network inspects HTTPS. Put the organisation's root certificate (`.crt`) in `docker\certs\` and build again — see `docker\certs\README.md`. |
| Port 8080 already in use | Change `HTTP_PORT` and the port in `PUBLIC_URL` in `.env`, then `docker compose up -d`. |
| Phones cannot open the address | Use a mobile hotspot; check the Windows firewall prompt; check `PUBLIC_URL` matches the laptop's current Wi-Fi address (`ipconfig`). |
| Forgot the Super Admin password | `docker compose run --rm tools create-superadmin` with a different e-mail creates another Super Admin. |
