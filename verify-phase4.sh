#!/usr/bin/env bash
# Phase 4 verification: super-admin MFA enrolment (backend).
# Drives the REAL services through Nest's DI context (no HTTP/ports): a fresh
# password-only super-admin is walked through the whole setup wizard and we
# assert each factor is recorded, the gate flips, and tokens are issued.
# Runs in development mode so the dev-only devCode is returned. Isolated project.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p4verify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup(){
  echo ""; echo "Cleaning up (down -v, restoring .env)..."
  $COMPOSE down -v >/dev/null 2>&1
  [ -f .env.phase4.bak ] && mv -f .env.phase4.bak .env && echo "  .env restored"
}
trap cleanup EXIT

echo "============================================================"
echo " Phase 4 verify: super-admin enrolment (backend)"
echo "============================================================"

cp -f .env .env.phase4.bak 2>/dev/null
PW="phase4_pw_${RANDOM}${RANDOM}"
cat > .env <<EOF
NODE_ENV=development
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
UPLOAD_DIR=/app/uploads
EOF

echo ""; echo "1) Build api image (compiles the new platform MFA code)"
if $COMPOSE build api >/tmp/p4_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p4_build.log; exit 1; fi

echo ""; echo "2) Start postgres + apply migrations"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p4_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p4_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p4_mig.log; }

echo ""; echo "3) Walk a fresh super-admin through the full enrolment via DI context"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { PlatformAuthService } = require("./apps/api/dist/platform/platform-auth.service.js");
const { PlatformMfaService } = require("./apps/api/dist/platform/platform-mfa.service.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
const { mfaSetupComplete } = require("./apps/api/dist/platform/platform-mfa.util.js");
const { authenticator } = require("otplib");
const bcrypt = require("bcryptjs");

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const auth = app.get(PlatformAuthService);
  const mfa = app.get(PlatformMfaService);
  const catalog = app.get(CatalogPrismaService);
  const email = "p4admin@assetmon.local";
  const password = "Phase4Pass123";
  try {
    await catalog.platformUser.deleteMany({ where: { email } });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await catalog.platformUser.create({ data: { email, passwordHash, firstName: "P4", lastName: "Admin", role: "SUPER_ADMIN", active: true, passwordChangedAt: new Date() } });
    const reload = () => catalog.platformUser.findUnique({ where: { id: user.id } });

    const l1 = await auth.login({ email, password });
    assert.equal(l1.code, "MFA_SETUP_REQUIRED", "login forces setup");
    assert.ok(l1.setupTicket, "login returns a setupTicket");

    const s1 = await mfa.sendPrimaryEmail(await reload());
    assert.ok(s1.devCode, "dev devCode returned");
    let threw = false; try { await mfa.verifyPrimaryEmail(await reload(), "000000"); } catch { threw = true; }
    assert.ok(threw, "wrong primary code rejected");
    await mfa.verifyPrimaryEmail(await reload(), s1.devCode);
    assert.ok((await reload()).primaryEmailVerifiedAt, "primaryEmailVerifiedAt set");

    const t = await mfa.startTotp(await reload());
    assert.ok(t.secret && t.otpauth, "totp start returns secret + otpauth");
    await mfa.verifyTotp(await reload(), authenticator.generate(t.secret));
    const afterTotp = await reload();
    assert.ok(afterTotp.totpEnabled && afterTotp.totpSecret, "totpEnabled + secret stored");
    assert.ok(afterTotp.totpSecret.startsWith("v1:"), "totp secret is v1-versioned at rest");

    const sameDom = await mfa.sendRecoveryEmail(await reload(), "other@assetmon.local", false);
    assert.equal(sameDom.needsAck, true, "same-domain recovery requires acknowledgement");
    const rec = await mfa.sendRecoveryEmail(await reload(), "p4recovery@othermail.test", false);
    assert.ok(rec.devCode, "different-domain recovery sends a code");
    await mfa.verifyRecoveryEmail(await reload(), rec.devCode);
    const afterRec = await reload();
    assert.equal(afterRec.recoveryEmail, "p4recovery@othermail.test", "recoveryEmail set");
    assert.ok(afterRec.recoveryEmailVerifiedAt, "recoveryEmailVerifiedAt set");

    const bcodes = await mfa.generateBackupCodes(await reload());
    assert.equal(bcodes.codes.length, 10, "10 backup codes returned (shown once)");
    assert.equal(await catalog.platformBackupCode.count({ where: { userId: user.id } }), 10, "10 backup-code hashes stored");
    assert.ok((await reload()).backupCodesGeneratedAt, "backupCodesGeneratedAt set");

    const done = await mfa.complete(await reload());
    assert.ok(done.accessToken && done.refreshToken, "complete issues access + refresh tokens");
    const final = await reload();
    assert.ok(final.mfaEnrolledAt, "mfaEnrolledAt set (gate column)");
    assert.ok(mfaSetupComplete(final), "mfaSetupComplete is now true");

    const l2 = await auth.login({ email, password });
    assert.ok(l2.accessToken && !l2.code, "enrolled login returns tokens, no setup gate");

    console.log("PHASE4_OK");
    await app.close();
    process.exit(0);
  } catch (e) {
    console.error("PHASE4_FAIL:", e && e.message ? e.message : e);
    try { await app.close(); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p4_flow.log 2>&1
grep -q PHASE4_OK /tmp/p4_flow.log && ok "full enrolment walkthrough passed" || { bad "enrolment flow FAILED"; tail -30 /tmp/p4_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 4 RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
