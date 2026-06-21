#!/usr/bin/env bash
# Phase 1 verification: platform MFA catalog data model.
# Builds the api image (proves schema.prisma is valid + `prisma generate` works),
# applies the new migration on a fresh catalog DB, and confirms the new
# columns/tables/FKs exist AND the generated Prisma client can read them.
# Throwaway: backs up/restores .env, tears everything down on exit.
cd "$(dirname "$0")" || exit 1
# Isolated project name so this NEVER touches the user's live app data/volumes.
COMPOSE="docker compose -p assetmon_p1verify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup(){
  echo ""; echo "Cleaning up (containers down -v, restoring .env)..."
  $COMPOSE down -v >/dev/null 2>&1
  [ -f .env.phase1.bak ] && mv -f .env.phase1.bak .env && echo "  .env restored"
}
trap cleanup EXIT

echo "============================================================"
echo " Phase 1 verify: platform MFA data model (catalog)"
echo "============================================================"

# Throwaway production-mode env (same shape verify-deploy.sh uses).
cp -f .env .env.phase1.bak 2>/dev/null
PW="phase1_pw_${RANDOM}${RANDOM}"
cat > .env <<EOF
NODE_ENV=production
API_PORT=4000
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$PW
CATALOG_DB_NAME=assetmon_catalog
CATALOG_DATABASE_URL=postgresql://postgres:$PW@postgres:5432/assetmon_catalog?schema=public
TENANT_DB_URL_TEMPLATE=postgresql://postgres:$PW@postgres:5432/{db}?schema=public
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=2592000
WEB_ORIGIN=http://localhost:4001
TRUST_PROXY_HOPS=1
UPLOAD_DIR=/app/uploads
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=AssetMon <no-reply@assetmon.local>
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RAZORPAY_PLAN_BUSINESS=
RAZORPAY_PLAN_ENTERPRISE=
EOF

echo ""; echo "1) Build api image (runs prisma generate on the new schema)"
if $COMPOSE build api >/tmp/p1_build.log 2>&1; then ok "image build OK (schema.prisma valid, client generated)"; else bad "build FAILED"; tail -40 /tmp/p1_build.log; exit 1; fi

echo ""; echo "2) Start postgres (fresh)"
$COMPOSE down -v >/dev/null 2>&1   # wipe any prior verify volume so the fresh password initialises
$COMPOSE up -d postgres >/tmp/p1_up.log 2>&1
PG=$($COMPOSE ps -q postgres)
s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }

echo ""; echo "3) Apply catalog migrations (incl. new 20260621120000_platform_3fa)"
if $COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p1_mig.log 2>&1; then ok "prisma migrate deploy OK"; else bad "migrate FAILED"; tail -40 /tmp/p1_mig.log; fi

echo ""; echo "4) New migration recorded as applied"
APPLIED=$($COMPOSE exec -T postgres psql -U postgres -d assetmon_catalog -tAc "SELECT 1 FROM _prisma_migrations WHERE migration_name='20260621120000_platform_3fa' AND finished_at IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')
[ "$APPLIED" = "1" ] && ok "recorded in _prisma_migrations" || bad "not recorded as applied"

echo ""; echo "5) New tables exist"
for t in PlatformMfaPending PlatformBackupCode PlatformOperatorEmailLog; do
  EX=$($COMPOSE exec -T postgres psql -U postgres -d assetmon_catalog -tAc "SELECT to_regclass('public.\"$t\"') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')
  [ "$EX" = "t" ] && ok "table $t" || bad "table $t MISSING"
done

echo ""; echo "6) New PlatformUser columns exist"
for c in primaryEmailVerifiedAt recoveryEmail recoveryEmailVerifiedAt backupCodesGeneratedAt mfaEnrolledAt lastTotpStep; do
  EX=$($COMPOSE exec -T postgres psql -U postgres -d assetmon_catalog -tAc "SELECT 1 FROM information_schema.columns WHERE table_name='PlatformUser' AND column_name='$c';" 2>/dev/null | tr -d '[:space:]')
  [ "$EX" = "1" ] && ok "PlatformUser.$c" || bad "PlatformUser.$c MISSING"
done

echo ""; echo "7) FK cascade constraints present"
for fk in PlatformMfaPending_userId_fkey PlatformBackupCode_userId_fkey; do
  EX=$($COMPOSE exec -T postgres psql -U postgres -d assetmon_catalog -tAc "SELECT 1 FROM pg_constraint WHERE conname='$fk' AND confdeltype='c';" 2>/dev/null | tr -d '[:space:]')
  [ "$EX" = "1" ] && ok "$fk (ON DELETE CASCADE)" || bad "$fk MISSING or not cascade"
done

echo ""; echo "8) Generated Prisma client reads the new models (schema<->client<->DB agree)"
$COMPOSE run --rm -T api node -e '
const { PrismaClient } = require("@assetmon/db-catalog");
const p = new PrismaClient();
(async () => {
  try {
    await p.platformUser.findMany({ select: { id:true, mfaEnrolledAt:true, lastTotpStep:true, recoveryEmail:true, primaryEmailVerifiedAt:true, recoveryEmailVerifiedAt:true, backupCodesGeneratedAt:true } });
    await p.platformMfaPending.count();
    await p.platformBackupCode.count();
    await p.platformOperatorEmailLog.count();
    console.log("CLIENT_OK");
  } catch (e) { console.error("CLIENT_ERR", e.message); process.exit(1); }
  finally { await p.$disconnect(); }
})();
' >/tmp/p1_client.log 2>&1
grep -q CLIENT_OK /tmp/p1_client.log && ok "client reads new columns/tables" || { bad "client read FAILED"; cat /tmp/p1_client.log; }

echo ""; echo "9) Bootstrap super-admin still works (no regression)"
if $COMPOSE run --rm -T api npm run platform:bootstrap-admin -- --email phase1@assetmon.local --password Phase1Pass123 --firstName P --lastName One --allow-prod >/tmp/p1_boot.log 2>&1; then
  ROLE=$($COMPOSE exec -T postgres psql -U postgres -d assetmon_catalog -tAc "SELECT role FROM \"PlatformUser\" WHERE email='phase1@assetmon.local';" 2>/dev/null | tr -d '[:space:]')
  MFA=$($COMPOSE exec -T postgres psql -U postgres -d assetmon_catalog -tAc "SELECT \"mfaEnrolledAt\" IS NULL FROM \"PlatformUser\" WHERE email='phase1@assetmon.local';" 2>/dev/null | tr -d '[:space:]')
  [ "$ROLE" = "SUPER_ADMIN" ] && ok "bootstrap created SUPER_ADMIN" || bad "bootstrap role wrong (=$ROLE)"
  [ "$MFA" = "t" ] && ok "new admin has mfaEnrolledAt=NULL (will be force-gated later)" || bad "mfaEnrolledAt not NULL"
else bad "bootstrap FAILED"; tail -25 /tmp/p1_boot.log; fi

echo ""
echo "============================================================"
printf " PHASE 1 RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
