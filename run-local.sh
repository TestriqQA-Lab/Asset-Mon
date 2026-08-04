#!/usr/bin/env bash
# ==================================================================
#  Run AssetMon locally: Docker backend (mysql + api).
#  Run this in an Ubuntu (WSL) terminal and LEAVE THE WINDOW OPEN.
#  Press Ctrl+C here to stop everything and restore your config.
#  (The website is started separately on Windows — see the banner.)
# ==================================================================
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml"

# Swap in local-run config, backing up whatever you had.
[ -f .env ] && cp .env .env.beforelocal.bak
cp .env.docker .env
[ -f apps/web/.env.local ] && cp apps/web/.env.local apps/web/.env.local.beforelocal.bak
printf 'NEXT_PUBLIC_API_URL=http://localhost:4000\nNEXT_PUBLIC_SITE_URL=http://localhost:4001\n' > apps/web/.env.local

restore() {
  echo ""
  echo "Stopping backend & restoring your config..."
  $COMPOSE down
  [ -f .env.beforelocal.bak ] && mv -f .env.beforelocal.bak .env
  [ -f apps/web/.env.local.beforelocal.bak ] && mv -f apps/web/.env.local.beforelocal.bak apps/web/.env.local
  echo "Done. Your workspaces/data are kept for next time."
}
trap restore INT TERM EXIT

echo "Starting backend (mysql + api)..."
$COMPOSE up -d

echo "Waiting for the database to be ready..."
# `postgres` now sits behind the `legacy` compose profile and is not started here,
# so this waits on `mysql`. Its healthcheck has a 30s start_period.
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q mysql)" 2>/dev/null)" = "healthy" ]; do sleep 2; done

echo "Applying migrations + column collations (safe to repeat)..."
# migrate:deploy also runs post-migrate-collations.sql, which is what makes search
# case-insensitive now that Prisma's mode: 'insensitive' is gone.
$COMPOSE exec -T api npm -w @assetmon/db run migrate:deploy >/dev/null 2>&1 && echo "  database ready" || echo "  (note: if login fails later, re-run this script)"

cat <<'BANNER'

==================================================================
  BACKEND IS UP   (API: http://localhost:4000)

  Now open a SEPARATE *Windows* PowerShell in the project folder:
      cd C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source
      npm run web:dev

  Then open in your browser:   http://localhost:4001

  Keep BOTH windows open while using the app.
  Press Ctrl+C in THIS window to stop the backend & restore config.
==================================================================

(streaming backend logs below — Ctrl+C to stop everything)
BANNER

$COMPOSE logs -f
