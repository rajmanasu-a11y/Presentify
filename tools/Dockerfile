FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Optional extra root certificates (docker/certs/*.crt) for networks that inspect HTTPS.
RUN --mount=type=bind,from=certs,target=/certs \
    if ls /certs/*.crt >/dev/null 2>&1; then cat /certs/*.crt > /tmp/extra-ca.pem; export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force && rm -f /tmp/extra-ca.pem
COPY *.mjs ./
USER node
ENTRYPOINT ["node", "/app/cli.mjs"]
