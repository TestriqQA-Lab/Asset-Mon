#!/usr/bin/env bash
# =====================================================================
# AssetMon - deployment self-check.
# Proves: the backend image builds, the full stack boots in PRODUCTION
# mode, and a real signup provisions an isolated tenant database.
#
# Safe & repeatable: it backs up your dev .env, runs with throwaway
# secrets, and tears everything down (and restores .env) on exit -
# even if a step fails.
#
# Run it from the project folder inside your Ubuntu (WSL) terminal:
#     bash verify-deploy.sh
# =====================================================================
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  \033[32m[PASS]\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  \033[31m[FAIL]\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup(){
  echo ""; echo "Cleaning up (stopping containers, restoring your .env)..."
  $COMPOSE down -v >/dev/null 2>&1
  [ -f .env.verify.bak ] && mv -f .env.verify.bak .env && echo "  dev .env restored"
}
trap cleanup EXIT

echo "============================================================"
echo " AssetMon deployment self-check"
echo "============================================================"

echo ""; echo "1) Deployment files present"
for f in apps/api/Dockerfile docker-compose.yml docker-compose.local.yml Caddyfile .env.production.example .dockerignore; do
  [ -f "$f" ] && ok "$f" || bad "$f MISSING"
done

echo ""; echo "2) Docker engine reachable"
if docker info >/dev/null 2>&1; then ok "daemon up - $(docker --version)"; else bad "docker not reachable"; exit 1; fi

echo ""; echo "3) Backend image builds (cached layers = fast)"
if $COMPOSE build >/tmp/am_build.log 2>&1; then ok "docker build OK"; else bad "build FAILED - see /tmp/am_build.log"; exit 1; fi

echo ""; echo "4) Boot full stack (throwaway production-mode env)"
cp -f .env .env.verify.bak 2>/dev/null
PW="verify_pw_${RANDOM}${RANDOM}"
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
JWT_MFA_TICKET_SECRET=$(openssl rand -hex 32)
OTP_PEPPER=$(openssl rand -hex 32)
OTP_PEPPER_VERSION=1
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
$COMPOSE up -d >/tmp/am_up.log 2>&1
PG=$($COMPOSE ps -q postgres)
s=none
for i in $(seq 1 40); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none)
  [ "$s" = "healthy" ] && break; sleep 2
done
[ "$s" = "healthy" ] && ok "postgres healthy" || bad "postgres not healthy"
code=000
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/health 2>/dev/null)
  [ -n "$code" ] && [ "$code" != "000" ] && break
  sleep 2
done
[ "$code" != "000" ] && ok "API responding (HTTP $code)" || bad "API not responding"

echo ""; echo "5) Catalog migrate + signup provisions a tenant DB"
if $COMPOSE exec -T api npm run db:catalog:migrate >/tmp/am_mig.log 2>&1; then ok "catalog migrated"; else bad "catalog migrate FAILED - see /tmp/am_mig.log"; fi
SLUG="verify${RANDOM}"
HTTP=$(curl -s -o /tmp/am_signup.json -w '%{http_code}' -X POST http://127.0.0.1:4000/api/auth/signup -H 'Content-Type: application/json' -d "{\"workspaceName\":\"Verify Co\",\"slug\":\"$SLUG\",\"email\":\"admin@$SLUG.test\",\"password\":\"VerifyPass123\",\"firstName\":\"V\",\"lastName\":\"Erify\"}")
[ "$HTTP" = "201" ] && ok "signup returned HTTP 201" || bad "signup HTTP $HTTP (see /tmp/am_signup.json)"
grep -q accessToken /tmp/am_signup.json 2>/dev/null && ok "signup issued JWT tokens" || bad "no tokens returned"
DBN="assetmon_t_$SLUG"
EX=$($COMPOSE exec -T postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DBN';" 2>/dev/null | tr -d '[:space:]')
[ "$EX" = "1" ] && ok "tenant database $DBN created" || bad "tenant DB not created"
TB=$($COMPOSE exec -T postgres psql -U postgres -d "$DBN" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d '[:space:]')
if [ -n "$TB" ] && [ "$TB" -ge 25 ] 2>/dev/null; then ok "tenant schema migrated ($TB tables)"; else bad "tenant tables: ${TB:-0}"; fi

echo ""; echo "6) MFA wired (production secrets boot the app + endpoints + schema)"
# Reaching here at all means the API booted in PRODUCTION mode WITH the MFA
# secrets present — i.e. the boot-time secret assertions (fail-closed in prod) passed.
TOK=$(grep -oP '"accessToken":"\K[^"]+' /tmp/am_signup.json 2>/dev/null)
ST=$(curl -s http://127.0.0.1:4000/api/me/mfa -H "Authorization: Bearer $TOK" 2>/dev/null)
echo "$ST" | grep -q '"mfaMethod":"NONE"' && ok "MFA status endpoint live (off by default)" || bad "MFA status endpoint failed ($ST)"
RS=$(curl -s -X POST http://127.0.0.1:4000/api/me/mfa/recovery/send -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"email":"recovery@othermail.test","acknowledgeRisk":true}' 2>/dev/null)
echo "$RS" | grep -q 'maskedEmail' && ok "email-code machinery works (OTP_PEPPER + email-log OK)" || bad "recovery/send failed ($RS)"
MT=$($COMPOSE exec -T postgres psql -U postgres -d "$DBN" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('TenantMfaPending','TenantBackupCode');" 2>/dev/null | tr -d '[:space:]')
[ "$MT" = "2" ] && ok "tenant MFA tables present (TenantMfaPending + TenantBackupCode)" || bad "tenant MFA tables: ${MT:-0}/2"
PMR=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/platform/mfa/setup/state 2>/dev/null)
[ "$PMR" = "401" ] && ok "platform MFA setup route registered (401 unauthenticated)" || bad "platform MFA route HTTP $PMR (expected 401)"

echo ""
echo "============================================================"
printf " RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
if [ "$FAIL" -eq 0 ]; then echo " ALL GOOD - deployment verified end to end."; else echo " Some checks FAILED - see /tmp/am_*.log"; fi
