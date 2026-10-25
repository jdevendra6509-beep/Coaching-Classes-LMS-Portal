# Build from the repository root:  docker build -f apps/api/Dockerfile -t lms-api .
# The same image runs the API (default) and the release migration task:
#   node node_modules/@lms/db/scripts/migrate.mjs
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
WORKDIR /repo
# Behind a TLS-intercepting proxy, pass its CA as a build secret (never stored in the image):
#   docker build --secret id=extra_ca,src=/path/to/ca.crt ...
ARG CA_MOUNT=/run/secrets/extra_ca
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db packages/db
COPY apps/api/package.json apps/api/
RUN --mount=type=secret,id=extra_ca,required=false NODE_EXTRA_CA_CERTS=$CA_MOUNT pnpm install --frozen-lockfile --filter @lms/api...
COPY apps/api apps/api
RUN pnpm --filter @lms/api build \
 && pnpm --filter @lms/api deploy --prod --legacy /out \
 && cd /out/node_modules/@lms/db && node ../../prisma/build/index.js generate

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/opt/rds/global-bundle.pem
# Amazon RDS certificate authorities, so database connections verify the server (sslmode=require).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /opt/rds/global-bundle.pem
RUN chmod 755 /opt/rds && chmod 644 /opt/rds/global-bundle.pem
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
