#!/usr/bin/env bash
# ==================================================================
#  Run AssetMon locally: Docker backend (mysql + api).
#  Run this in an Ubuntu (WSL) terminal and LEAVE THE WINDOW OPEN.
#  Press Ctrl+C here to stop everything and restore your config.
#  (The website is started separately on Windows — see the banner.)
# ==================================================================
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml"

# A leftover backup means a previous run ended without restore() firing — closed
# terminal, machine slept, process killed rather than Ctrl+C'd. Overwriting it here
# would replace the real .env backup with the Docker one and lose the original for
# good, so recover instead of ploughing on.
if [ -f .env.beforelocal.bak ]; then
  echo "A previous run did not restore your config (.env.beforelocal.bak is still here)."
  echo "Putting it back before continuing; re-run this script afterwards."
  mv -f .env.beforelocal.bak .env
  [ -f apps/web/.env.local.beforelocal.bak ] && mv -f apps/web/.env.local.beforelocal.bak apps/web/.env.local
  exit 1
fi

# Swap in local-run config, backing up whatever you had.
[ -f .env ] && cp .env .env.beforelocal.bak
cp .env.docker .env
[ -f apps/web/.env.local ] && cp apps/web/.env.local apps/web/.env.local.beforelocal.bak
printf 'NEXT_PUBLIC_API_URL=http://localhost:4000\nNEXT_PUBLIC_SITE_URL=http://localhost:4001\n' > apps/web/.env.local

restore() {
  echo ""
  echo "Stopping backend & restoring your config..."
  # `down` re-reads docker-compose.yml, which requires MYSQL_ROOT_PASSWORD to
  # interpolate. Restoring .env first would therefore break the teardown — so the
  # value is supplied inline and the order is: stop the stack, then restore config.
  MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-teardown}" $COMPOSE down
  [ -f .env.beforelocal.bak ] && mv -f .env.beforelocal.bak .env
  [ -f apps/web/.env.local.beforelocal.bak ] && mv -f apps/web/.env.local.beforelocal.bak apps/web/.env.local
  echo "Done. Your workspaces/data are kept for next time."
}
trap restore INT TERM EXIT

echo "Starting backend (mysql + api)..."
# --build, not a bare `up -d`. Compose happily reuses whatever image is tagged for
# this project, and the tag survives across branches — so without this you can be
# running a build from days ago while reading today's source, which is a genuinely
# confusing way to lose an hour. Layers are cached, so a no-change rebuild is quick.
$COMPOSE up -d --build

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
