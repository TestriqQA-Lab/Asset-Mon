#!/usr/bin/env bash
# =====================================================================
# AssetMon - deployment self-check.
# Proves: the backend image builds, the full stack boots in PRODUCTION
# mode, and a real signup provisions a fully-formed tenant.
#
# This is the only check that exercises the production IMAGE and a production-mode
# boot (where the MFA secret assertions are fail-closed). `npm run verify` checks the
# code; tools/verify-tenant-isolation.sh checks a running API; neither builds a
# container. Keep this as the pre-deploy gate.
#
# Safe & repeatable: it backs up your dev .env, runs with throwaway
# secrets, and tears everything down (and restores .env) on exit -
# even if a step fails.
#
# Run it from the project folder inside your Ubuntu (WSL) terminal:
#     bash verify-deploy.sh
# =====================================================================
cd "$(dirname "$0")" || exit 1
# Runs under its OWN compose project name, deliberately.
#
# The cleanup below is `down -v`, which removes the project's named volumes. Under a
# shared project name that would delete `pgdata` — the original per-tenant Postgres
# databases, which are still the migration source AND the only rollback position until
# cutover is signed off. A separate project gets its own throwaway volumes, so a
# self-check can never destroy real data.
VERIFY_PROJECT="assetmon-verify"
VERIFY_PORT=4010

# ...and on its own ports. docker-compose.local.yml publishes the API on 4000, which a
# running dev stack already holds. Without this the stack either fails to bind or, far
# worse, every HTTP check below silently passes against the OTHER API and the
# self-check reports green on a build it never tested.
# Note this composes docker-compose.yml with its OWN override and deliberately does
# NOT layer docker-compose.local.yml. Compose MERGES port lists rather than replacing
# them, so layering the dev file would publish 4000 *as well as* the verify port —
# colliding with a running dev stack, and (worse) letting the HTTP checks below answer
# from the other API.
VERIFY_OVERRIDE="verify-deploy.override.tmp.yml"
cat > "$VERIFY_OVERRIDE" <<YML
services:
  api:
    ports: ["${VERIFY_PORT}:4000"]
  mysql:
    ports: ["3310:3306"]
  caddy:
    profiles: ["never"]
YML
COMPOSE="docker compose -p $VERIFY_PROJECT -f docker-compose.yml -f $VERIFY_OVERRIDE"
PASS=0; FAIL=0
ok(){  printf '  \033[32m[PASS]\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  \033[31m[FAIL]\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup(){
  echo ""; echo "Cleaning up (stopping containers, restoring your .env)..."
  # -v is safe here only because of the dedicated project name above.
  $COMPOSE down -v >/dev/null 2>&1
  [ -f .env.verify.bak ] && mv -f .env.verify.bak .env && echo "  dev .env restored"
  rm -f "$VERIFY_OVERRIDE"
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

echo ""; echo "3) Throwaway production-mode config"
# `docker compose build` interpolates the whole compose file, and the mysql service
# declares MYSQL_ROOT_PASSWORD as required — so the throwaway env has to exist before
# ANY compose command, not just before `up`. Previously this step ran after the build
# and only worked because the developer's own .env happened to satisfy the
# interpolation, quietly defeating the point of using throwaway secrets.
cp -f .env .env.verify.bak 2>/dev/null
PW="verify_pw_${RANDOM}${RANDOM}"
cat > .env <<EOF
NODE_ENV=production
API_PORT=4000
MYSQL_ROOT_PASSWORD=$PW
MYSQL_DATABASE=assetmon
DATABASE_URL=mysql://root:$PW@mysql:3306/assetmon
CATALOG_DATABASE_URL=mysql://root:$PW@mysql:3306/assetmon
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
ok "generated throwaway .env (real one backed up)"

echo ""; echo "4) Backend image builds (cached layers = fast)"
if $COMPOSE build >/tmp/am_build.log 2>&1; then ok "docker build OK"; else bad "build FAILED - see /tmp/am_build.log"; exit 1; fi

echo ""; echo "5) Boot full stack"
$COMPOSE up -d >/tmp/am_up.log 2>&1
DBC=$($COMPOSE ps -q mysql)
s=none
for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$DBC" 2>/dev/null || echo none)
  [ "$s" = "healthy" ] && break; sleep 2
done
[ "$s" = "healthy" ] && ok "mysql healthy" || bad "mysql not healthy"
code=000
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$VERIFY_PORT/api/health 2>/dev/null)
  [ -n "$code" ] && [ "$code" != "000" ] && break
  sleep 2
done
[ "$code" != "000" ] && ok "API responding (HTTP $code)" || bad "API not responding"

echo ""; echo "6) Migrate + signup provisions a fully-formed tenant"
if $COMPOSE exec -T api npm -w @assetmon/db run migrate:deploy >/tmp/am_mig.log 2>&1; then ok "schema + collations applied"; else bad "migrate FAILED - see /tmp/am_mig.log"; fi

# Resolve the database client once. MariaDB 11 ships `mariadb` and no longer provides a
# `mysql` binary, and because every query below sends stderr to /dev/null, a missing
# client does not announce itself — it turns each check into an empty string, which reads
# as "the row was never created". That is exactly how a working application once produced
# eight failures here, so this fails loudly instead.
DBCLI=$($COMPOSE exec -T mysql sh -c 'command -v mariadb || command -v mysql' 2>/dev/null | tr -d '\r' | tr -d '[:space:]')
[ -n "$DBCLI" ] || bad "no mariadb/mysql client inside the database container — the SQL checks below cannot run"
DBCLI="${DBCLI:-mariadb}"

# Helper: one-shot SQL against the app database, scalar result.
q(){ $COMPOSE exec -T mysql "$DBCLI" -uroot -p"$PW" -N -B -e "$1" assetmon 2>/dev/null | tr -d '
' | tr -d '[:space:]'; }

# The searchable columns must be case-insensitive, or search silently regresses to
# case-sensitive — the collations are applied by migrate:deploy, not by Prisma.
COLL=$(q "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='assetmon' AND COLLATION_NAME='utf8mb4_general_ci';")
[ "$COLL" = "12" ] && ok "12 searchable columns collated case-insensitively" || bad "collated columns: ${COLL:-0}/12"

SLUG="verify${RANDOM}"
HTTP=$(curl -s -o /tmp/am_signup.json -w '%{http_code}' -X POST http://127.0.0.1:$VERIFY_PORT/api/auth/signup -H 'Content-Type: application/json' -d "{\"workspaceName\":\"Verify Co\",\"slug\":\"$SLUG\",\"email\":\"admin@$SLUG.test\",\"password\":\"VerifyPass123\",\"firstName\":\"V\",\"lastName\":\"Erify\"}")
[ "$HTTP" = "201" ] && ok "signup returned HTTP 201" || bad "signup HTTP $HTTP (see /tmp/am_signup.json)"
grep -q accessToken /tmp/am_signup.json 2>/dev/null && ok "signup issued JWT tokens" || bad "no tokens returned"

# Provisioning no longer creates a database — it writes rows in one transaction. So
# assert the transaction did ALL of its work, which is a stronger check than the old
# "a database exists with >=25 tables".
TID=$(q "SELECT id FROM Tenant WHERE slug='$SLUG';")
[ -n "$TID" ] && ok "Tenant row created" || bad "no Tenant row for $SLUG"
if [ -n "$TID" ]; then
  [ "$(q "SELECT COUNT(*) FROM User WHERE tenantId='$TID' AND role='ADMIN';")" = "1" ] && ok "admin User created" || bad "admin User missing"
  [ "$(q "SELECT COUNT(*) FROM TenantUser WHERE tenantId='$TID';")" = "1" ] && ok "TenantUser mapping created" || bad "TenantUser mapping missing"
  [ "$(q "SELECT COUNT(*) FROM Category WHERE tenantId='$TID';")" = "5" ] && ok "5 default categories seeded" || bad "categories seeded: $(q "SELECT COUNT(*) FROM Category WHERE tenantId='$TID';")/5"
  [ "$(q "SELECT COUNT(*) FROM AssetStatusDef WHERE tenantId='$TID';")" = "7" ] && ok "7 status definitions seeded" || bad "status defs seeded: $(q "SELECT COUNT(*) FROM AssetStatusDef WHERE tenantId='$TID';")/7"
  # Without this row every audited action throws — it is the single most important
  # thing provisioning must not skip.
  [ "$(q "SELECT COUNT(*) FROM AuditCounter WHERE tenantId='$TID';")" = "1" ] && ok "AuditCounter seeded (audit writes will work)" || bad "AuditCounter MISSING — audited actions will fail"
  # No row anywhere may carry a tenantId with no Tenant behind it.
  ORPH=$(q "SELECT COUNT(*) FROM User u LEFT JOIN Tenant t ON u.tenantId=t.id WHERE t.id IS NULL;")
  [ "$ORPH" = "0" ] && ok "no orphaned rows" || bad "$ORPH orphaned User row(s)"
fi

echo ""; echo "7) MFA wired (production secrets boot the app + endpoints + schema)"
# Reaching here at all means the API booted in PRODUCTION mode WITH the MFA
# secrets present — i.e. the boot-time secret assertions (fail-closed in prod) passed.
TOK=$(grep -oP '"accessToken":"\K[^"]+' /tmp/am_signup.json 2>/dev/null)
ST=$(curl -s http://127.0.0.1:$VERIFY_PORT/api/me/mfa -H "Authorization: Bearer $TOK" 2>/dev/null)
echo "$ST" | grep -q '"mfaMethod":"NONE"' && ok "MFA status endpoint live (off by default)" || bad "MFA status endpoint failed ($ST)"
RS=$(curl -s -X POST http://127.0.0.1:$VERIFY_PORT/api/me/mfa/recovery/send -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"email":"recovery@othermail.test","acknowledgeRisk":true}' 2>/dev/null)
echo "$RS" | grep -q 'maskedEmail' && ok "email-code machinery works (OTP_PEPPER + email-log OK)" || bad "recovery/send failed ($RS)"
MT=$(q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='assetmon' AND TABLE_NAME IN ('TenantMfaPending','TenantBackupCode');")
[ "$MT" = "2" ] && ok "tenant MFA tables present (TenantMfaPending + TenantBackupCode)" || bad "tenant MFA tables: ${MT:-0}/2"
PMR=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$VERIFY_PORT/api/platform/mfa/setup/state 2>/dev/null)
[ "$PMR" = "401" ] && ok "platform MFA setup route registered (401 unauthenticated)" || bad "platform MFA route HTTP $PMR (expected 401)"

echo ""; echo "8) Audit chain verifies for the new tenant"
AV=$(curl -s http://127.0.0.1:$VERIFY_PORT/api/audit/verify -H "Authorization: Bearer $TOK" 2>/dev/null)
echo "$AV" | grep -q '"intact":true' && ok "audit chain intact" || bad "audit chain: $AV"

echo ""
echo "============================================================"
printf " RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
if [ "$FAIL" -eq 0 ]; then echo " ALL GOOD - deployment verified end to end."; else echo " Some checks FAILED - see /tmp/am_*.log"; fi
