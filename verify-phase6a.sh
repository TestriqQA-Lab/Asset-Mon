#!/usr/bin/env bash
# Phase 6a verification: shared clearMfa + CLI break-glass --reset-mfa.
# Enrolls operators, exercises the service clearMfa, then the CLI break-glass
# (token enforcement + success), and confirms the reset clears MFA, writes a
# hash-chained audit row, and re-gates the operator to setup. Isolated project.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p6averify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p6a.bak ] && mv -f .env.p6a.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 6a verify: clearMfa + CLI break-glass"
echo "============================================================"

cp -f .env .env.p6a.bak 2>/dev/null
PW="p6a_${RANDOM}${RANDOM}"
BG="bgtoken_$(openssl rand -hex 16)"
cat > .env <<EOF
NODE_ENV=development
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
BREAKGLASS_TOKEN=$BG
JWT_ACCESS_TTL=900
WEB_ORIGIN=http://localhost:4001
UPLOAD_DIR=/app/uploads
EOF

echo ""; echo "1) Build api image"
if $COMPOSE build api >/tmp/p6a_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p6a_build.log; exit 1; fi

echo ""; echo "2) Start postgres + migrate"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p6a_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p6a_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p6a_mig.log; }

echo ""; echo "3) Enroll two operators; test service clearMfa on #2"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { PlatformMfaService } = require("./apps/api/dist/platform/platform-mfa.service.js");
const { PlatformAuthService } = require("./apps/api/dist/platform/platform-auth.service.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
const { authenticator } = require("otplib");
const bcrypt = require("bcryptjs");
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const mfa = app.get(PlatformMfaService); const auth = app.get(PlatformAuthService); const catalog = app.get(CatalogPrismaService);
  const enroll = async (email) => {
    await catalog.platformUser.deleteMany({ where: { email } });
    const u = await catalog.platformUser.create({ data: { email, passwordHash: await bcrypt.hash("Phase6Pass123", 12), firstName: "P", lastName: "6", role: "SUPER_ADMIN", active: true, passwordChangedAt: new Date() } });
    const rl = () => catalog.platformUser.findUnique({ where: { id: u.id } });
    await mfa.verifyPrimaryEmail(u, (await mfa.sendPrimaryEmail(await rl())).devCode);
    const t = await mfa.startTotp(await rl()); await mfa.verifyTotp(await rl(), authenticator.generate(t.secret));
    const rec = email.split("@")[0] + "@othermail.test";
    await mfa.verifyRecoveryEmail(u, (await mfa.sendRecoveryEmail(await rl(), rec, false)).devCode);
    await mfa.generateBackupCodes(await rl()); await mfa.complete(await rl());
    return u.id;
  };
  try {
    const id1 = await enroll("p6a1@assetmon.local"); // left enrolled for the CLI test
    await catalog.platformUser.update({ where: { id: id1 }, data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 3600000) } }); // lock it to prove break-glass lifts the lockout
    const id2 = await enroll("p6a2@assetmon.local");
    await mfa.clearMfa(id2);
    const u2 = await catalog.platformUser.findUnique({ where: { id: id2 } });
    assert.equal(u2.mfaEnrolledAt, null, "service clearMfa nulls mfaEnrolledAt");
    assert.equal(u2.totpSecret, null, "service clearMfa nulls totpSecret");
    assert.equal(u2.totpEnabled, false, "service clearMfa disables totp");
    assert.equal(await catalog.platformBackupCode.count({ where: { userId: id2 } }), 0, "service clearMfa deletes backup codes");
    const l2 = await auth.login({ email: "p6a2@assetmon.local", password: "Phase6Pass123" });
    assert.equal(l2.code, "MFA_SETUP_REQUIRED", "cleared operator is re-gated to setup");
    console.log("DI1_OK");
    await app.close(); process.exit(0);
  } catch (e) { console.error("DI1_FAIL:", e && e.message ? e.message : e); try { await app.close(); } catch (x) {} process.exit(1); }
})();
' >/tmp/p6a_di1.log 2>&1
grep -q DI1_OK /tmp/p6a_di1.log && ok "service clearMfa clears MFA + re-gates" || { bad "service clearMfa FAILED"; tail -20 /tmp/p6a_di1.log; }

echo ""; echo "4) CLI break-glass token enforcement"
$COMPOSE run --rm -T api npm run platform:bootstrap-admin -- --email p6a1@assetmon.local --reset-mfa >/tmp/p6a_notoken.log 2>&1
[ $? -ne 0 ] && ok "CLI refuses --reset-mfa with NO --breakglass-token" || bad "CLI did not refuse missing token"
$COMPOSE run --rm -T api npm run platform:bootstrap-admin -- --email p6a1@assetmon.local --reset-mfa --breakglass-token WRONG_TOKEN >/tmp/p6a_wrong.log 2>&1
[ $? -ne 0 ] && ok "CLI refuses a WRONG --breakglass-token" || bad "CLI did not refuse wrong token"

echo ""; echo "5) CLI break-glass success (correct token)"
$COMPOSE run --rm -T api npm run platform:bootstrap-admin -- --email p6a1@assetmon.local --reset-mfa --breakglass-token "$BG" --incident-ref INC-123 --allow-prod >/tmp/p6a_ok.log 2>&1
[ $? -eq 0 ] && ok "CLI --reset-mfa succeeds with correct token" || { bad "CLI reset FAILED"; tail -20 /tmp/p6a_ok.log; }

echo ""; echo "6) Hash-chained audit row was written"
HAS=$($COMPOSE exec -T postgres psql -U postgres -d assetmon_catalog -tAc "SELECT count(*) FROM \"PlatformAuditLog\" WHERE action='platform.cli.mfa_reset' AND \"entryHash\" IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')
[ "$HAS" = "1" ] && ok "chained CLI audit row present (entryHash set)" || bad "CLI audit row missing/unchained (count=$HAS)"

echo ""; echo "7) Operator is cleared + re-gated after CLI reset"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { PlatformAuthService } = require("./apps/api/dist/platform/platform-auth.service.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const auth = app.get(PlatformAuthService); const catalog = app.get(CatalogPrismaService);
  try {
    const u = await catalog.platformUser.findUnique({ where: { email: "p6a1@assetmon.local" } });
    assert.ok(u, "operator exists");
    assert.equal(u.mfaEnrolledAt, null, "CLI reset nulled mfaEnrolledAt");
    assert.equal(u.totpSecret, null, "CLI reset nulled totpSecret");
    assert.equal(await catalog.platformBackupCode.count({ where: { userId: u.id } }), 0, "CLI reset deleted backup codes");
    assert.equal(u.lockedUntil, null, "CLI reset lifted the lockout (break-glass rescues a locked-out operator)");
    const l = await auth.login({ email: "p6a1@assetmon.local", password: "Phase6Pass123" });
    assert.equal(l.code, "MFA_SETUP_REQUIRED", "operator re-gated to setup after CLI reset");
    console.log("DI2_OK");
    await app.close(); process.exit(0);
  } catch (e) { console.error("DI2_FAIL:", e && e.message ? e.message : e); try { await app.close(); } catch (x) {} process.exit(1); }
})();
' >/tmp/p6a_di2.log 2>&1
grep -q DI2_OK /tmp/p6a_di2.log && ok "CLI reset clears MFA + re-gates operator" || { bad "post-CLI verify FAILED"; tail -20 /tmp/p6a_di2.log; }

echo ""
echo "============================================================"
printf " PHASE 6a RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
