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
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/db-catalog/package.json packages/db-catalog/
COPY packages/db-tenant/package.json packages/db-tenant/
COPY packages/shared/package.json packages/shared/
RUN npm install

# Copy the rest of the source (node_modules + generated clients are excluded via .dockerignore).
COPY . .

# Generate the Prisma clients for BOTH schemas, then compile the API.
RUN npm run db:catalog:generate && npm run db:tenant:generate
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
