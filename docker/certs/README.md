# Extra trusted certificates (optional)

Some office and government networks inspect HTTPS traffic with their own root
certificate. Docker builds then fail with errors such as
`SELF_SIGNED_CERT_IN_CHAIN` while downloading packages.

If that happens, ask your network team for the organisation's root certificate
(PEM format), save it in this folder with a `.crt` extension, and build again:

    docker compose build

Certificates here are used only while building the Presentify images.
They are not committed to Git (see .gitignore).
