# Build from the repository root:  docker build -f apps/web/Dockerfile -t lms-web .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
# Behind a TLS-intercepting proxy, pass its CA as a build secret (never stored in the image):
#   docker build --secret id=extra_ca,src=/path/to/ca.crt ...
ARG CA_MOUNT=/run/secrets/extra_ca
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=extra_ca,required=false NODE_EXTRA_CA_CERTS=$CA_MOUNT pnpm install --frozen-lockfile --filter @lms/web
COPY apps/web apps/web
RUN pnpm --filter @lms/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
