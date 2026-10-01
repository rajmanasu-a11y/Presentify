# Build the Presentify screens, then serve them with nginx (which is also the API gateway).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional extra root certificates (docker/certs/*.crt) for networks that inspect HTTPS.
RUN --mount=type=bind,from=certs,target=/certs \
    if ls /certs/*.crt >/dev/null 2>&1; then cat /certs/*.crt > /tmp/extra-ca.pem; export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    npm ci --no-audit --no-fund && rm -f /tmp/extra-ca.pem
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
