# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# AssetMon API (NestJS) — multi-stage build for the monorepo.
# Build context MUST be the repo root:  docker build -f apps/api/Dockerfile .
# ---------------------------------------------------------------------------

# ---- build stage ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
# OpenSSL is required by Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install dependencies using only the workspace manifests first (better layer caching).
#
# The Prisma schema and its config come along even though they are not manifests: the
# root package.json runs `npm -w @assetmon/db run generate` as a postinstall, so npm
# install fails outright without them. It did fail, silently and for a long time, because
# nothing in CI builds this image.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/shared/package.json packages/shared/
RUN npm install

# Copy the rest of the source (node_modules + generated clients are excluded via .dockerignore).
COPY . .

# Generate the unified Prisma client, then compile the API. The client output is
# gitignored and .dockerignore'd, so without this the build fails with a few
# hundred type errors from the missing @assetmon/db module.
RUN npm -w @assetmon/db run generate
RUN npm -w @assetmon/api run build

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production

# Bring over installed deps, the compiled API, and the packages
# (the packages dir carries the generated Prisma clients AND the tenant
#  migration .sql files, which the API reads from disk at runtime).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/packages ./packages

# Uploads live on a mounted volume in production (see docker-compose.yml).
RUN mkdir -p /app/uploads

EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
