#!/usr/bin/env bash
# Phase 2 verification: env/secret assertions + versioned crypto.
# Proves: (a) image still builds; (b) versioned crypto round-trips AND old
# unversioned/plaintext secrets still decrypt (existing tenant 2FA unbroken);
# (c) the app boots in production mode with all five distinct secrets; and
# (d) it REFUSES to boot when an MFA secret is missing or non-distinct.
# Isolated compose project so it never touches the user's live app data.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p2verify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup(){
  echo ""; echo "Cleaning up (containers down -v, restoring .env)..."
  $COMPOSE down -v >/dev/null 2>&1
  [ -f .env.phase2.bak ] && mv -f .env.phase2.bak .env && echo "  .env restored"
}
trap cleanup EXIT

echo "============================================================"
echo " Phase 2 verify: secrets + versioned crypto"
echo "============================================================"

# Throwaway production-mode env with ALL FIVE secrets, each distinct & >=32.
cp -f .env .env.phase2.bak 2>/dev/null
PW="phase2_pw_${RANDOM}${RANDOM}"
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

echo ""; echo "1) Build api image (compiles new crypto.ts + main.ts)"
if $COMPOSE build api >/tmp/p2_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p2_build.log; exit 1; fi

echo ""; echo "2) Start postgres (fresh, isolated) + apply migrations"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p2_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p2_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p2_mig.log; }

echo ""; echo "3) Versioned crypto: v1 round-trip + legacy decrypt + strict (backward compat)"
$COMPOSE run --rm -T api node -e '
const c = require("./apps/api/dist/common/crypto.js");
const A = require("assert");
const S = "JBSWY3DPEHPK3PXP";
const enc = c.encryptSecret(S);
A.ok(enc.startsWith("v1:"), "encrypt yields v1: prefix");
A.equal(c.decryptSecret(enc), S, "v1 round-trip");
const legacy = enc.slice(3);
A.equal(legacy.split(":").length, 3, "legacy is 3-part");
A.equal(c.decryptSecret(legacy), S, "legacy unversioned still decrypts");
A.equal(c.decryptSecret("PLAINTEXTSECRET"), "PLAINTEXTSECRET", "plaintext passthrough");
A.equal(c.decryptSecretStrict(enc), S, "strict accepts v1");
let t=false; try { c.decryptSecretStrict(legacy); } catch { t=true; } A.ok(t, "strict rejects legacy 3-part");
t=false; try { c.decryptSecretStrict("PLAIN"); } catch { t=true; } A.ok(t, "strict rejects plaintext");
A.ok(c.timingSafeEqualStr("abc","abc")===true && c.timingSafeEqualStr("abc","abd")===false, "timingSafeEqualStr");
console.log("CRYPTO_OK");
' >/tmp/p2_crypto.log 2>&1
grep -q CRYPTO_OK /tmp/p2_crypto.log && ok "crypto: v1 + legacy + plaintext + strict all correct" || { bad "crypto check FAILED"; cat /tmp/p2_crypto.log; }

echo ""; echo "4) App BOOTS (prod mode) with all five distinct secrets"
BOOT=$(timeout 60 $COMPOSE run --rm -T api sh -c 'node apps/api/dist/main.js & PID=$!; sleep 8; if kill -0 $PID 2>/dev/null; then echo BOOT_OK; kill $PID 2>/dev/null; else echo BOOT_DIED; fi' 2>&1)
echo "$BOOT" | grep -q BOOT_OK && ok "app boots cleanly with valid secrets" || { bad "app did NOT boot"; echo "$BOOT" | tail -8; }

echo ""; echo "5) App REFUSES to boot when JWT_MFA_TICKET_SECRET is missing"
OUT=$(timeout 60 $COMPOSE run --rm -T -e JWT_MFA_TICKET_SECRET= api node apps/api/dist/main.js 2>&1)
echo "$OUT" | grep -q 'JWT_MFA_TICKET_SECRET' && ok "fail-closed: missing JWT_MFA_TICKET_SECRET" || { bad "did NOT refuse"; echo "$OUT" | tail -6; }

echo ""; echo "6) App REFUSES to boot when OTP_PEPPER is missing"
OUT=$(timeout 60 $COMPOSE run --rm -T -e OTP_PEPPER= api node apps/api/dist/main.js 2>&1)
echo "$OUT" | grep -q 'OTP_PEPPER' && ok "fail-closed: missing OTP_PEPPER" || { bad "did NOT refuse"; echo "$OUT" | tail -6; }

echo ""; echo "7) App REFUSES to boot when two secrets are NOT distinct"
SAME=$(openssl rand -hex 32)
OUT=$(timeout 60 $COMPOSE run --rm -T -e OTP_PEPPER=$SAME -e ENCRYPTION_KEY=$SAME api node apps/api/dist/main.js 2>&1)
echo "$OUT" | grep -qi 'distinct' && ok "fail-closed: OTP_PEPPER == ENCRYPTION_KEY rejected" || { bad "did NOT refuse non-distinct"; echo "$OUT" | tail -6; }

echo ""
echo "============================================================"
printf " PHASE 2 RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
