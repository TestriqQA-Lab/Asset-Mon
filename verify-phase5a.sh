#!/usr/bin/env bash
# Phase 5a verification: enrolled-operator login chain (password->email->TOTP),
# replay guard, wrong-code handling, and backup-code fallback (>=2-of-3).
# Drives real services through Nest DI (no HTTP/ports). Isolated project.
# (Resets lastTotpStep between live-TOTP cases to simulate clock advancing, so
#  several logins in one 30s window do not trip the replay guard against itself.)
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p5verify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup(){
  echo ""; echo "Cleaning up (down -v, restoring .env)..."
  $COMPOSE down -v >/dev/null 2>&1
  [ -f .env.phase5.bak ] && mv -f .env.phase5.bak .env && echo "  .env restored"
}
trap cleanup EXIT

echo "============================================================"
echo " Phase 5a verify: operator login chain"
echo "============================================================"

cp -f .env .env.phase5.bak 2>/dev/null
PW="phase5_pw_${RANDOM}${RANDOM}"
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
JWT_ACCESS_TTL=900
WEB_ORIGIN=http://localhost:4001
UPLOAD_DIR=/app/uploads
EOF

echo ""; echo "1) Build api image"
if $COMPOSE build api >/tmp/p5_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p5_build.log; exit 1; fi

echo ""; echo "2) Start postgres + migrate"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p5_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p5_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p5_mig.log; }

echo ""; echo "3) Enroll an operator, then exercise the login chain"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { PlatformAuthService } = require("./apps/api/dist/platform/platform-auth.service.js");
const { PlatformMfaService } = require("./apps/api/dist/platform/platform-mfa.service.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
const { authenticator } = require("otplib");
const bcrypt = require("bcryptjs");

const rejects = async (p, label) => { let t = false; try { await p; } catch { t = true; } assert.ok(t, label); };

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const auth = app.get(PlatformAuthService);
  const mfa = app.get(PlatformMfaService);
  const catalog = app.get(CatalogPrismaService);
  const email = "p5admin@assetmon.local";
  const password = "Phase5Pass123";
  const reload = () => catalog.platformUser.findUnique({ where: { email } });
  const resetStep = (id) => catalog.platformUser.update({ where: { id }, data: { lastTotpStep: null } });
  try {
    await catalog.platformUser.deleteMany({ where: { email } });
    const passwordHash = await bcrypt.hash(password, 12);
    let user = await catalog.platformUser.create({ data: { email, passwordHash, firstName: "P5", lastName: "Admin", role: "SUPER_ADMIN", active: true, passwordChangedAt: new Date() } });

    // --- enroll (reuse the Phase 4 wizard), capturing TOTP secret + backup codes ---
    await mfa.verifyPrimaryEmail(user, (await mfa.sendPrimaryEmail(await reload())).devCode);
    const totp = await mfa.startTotp(await reload());
    await mfa.verifyTotp(await reload(), authenticator.generate(totp.secret));
    await mfa.verifyRecoveryEmail(user, (await mfa.sendRecoveryEmail(await reload(), "p5rec@othermail.test", false)).devCode);
    const backup = (await mfa.generateBackupCodes(await reload())).codes;
    await mfa.complete(await reload());
    assert.ok((await reload()).mfaEnrolledAt, "enrolled");
    user = await reload();

    // A) full live chain
    await resetStep(user.id);
    const a1 = await auth.login({ email, password });
    assert.equal(a1.code, "EMAIL_OTP_REQUIRED", "login -> email step");
    assert.ok(a1.ticket && a1.devCode, "email step ticket + devCode");
    const a2 = await auth.loginMfaEmail(a1.ticket, a1.devCode);
    assert.equal(a2.code, "TOTP_REQUIRED", "email ok -> totp step");
    const tA = authenticator.generate(totp.secret);
    const a3 = await auth.loginMfaTotp(a2.ticket, tA);
    assert.ok(a3.accessToken && a3.refreshToken, "totp ok -> tokens issued");

    // B) replay guard: reuse the SAME totp code in a new chain -> rejected
    const b1 = await auth.login({ email, password });
    const b2 = await auth.loginMfaEmail(b1.ticket, b1.devCode);
    await rejects(auth.loginMfaTotp(b2.ticket, tA), "replayed TOTP code rejected");

    // C) wrong email code rejected; then backup code at the TOTP step works
    const c1 = await auth.login({ email, password });
    await rejects(auth.loginMfaEmail(c1.ticket, "000000"), "wrong email code rejected");
    const c2 = await auth.loginMfaEmail(c1.ticket, c1.devCode);
    const c3 = await auth.loginMfaTotp(c2.ticket, backup[0]);
    assert.ok(c3.accessToken, "backup code at TOTP step issues tokens");

    // D) backup at email step -> TOTP must be live; a 2nd backup code is rejected
    await resetStep(user.id);
    const d1 = await auth.login({ email, password });
    const d2 = await auth.loginMfaEmail(d1.ticket, backup[1]);
    assert.equal(d2.code, "TOTP_REQUIRED", "backup code satisfies email step");
    await rejects(auth.loginMfaTotp(d2.ticket, backup[2]), "second backup code rejected (>=2-of-3)");
    const d3 = await auth.loginMfaTotp(d2.ticket, authenticator.generate(totp.secret));
    assert.ok(d3.accessToken, "live TOTP after backup-email issues tokens");

    // E) a used backup code cannot be reused
    await resetStep(user.id);
    const e1 = await auth.login({ email, password });
    const e2 = await auth.loginMfaEmail(e1.ticket, e1.devCode);
    await rejects(auth.loginMfaTotp(e2.ticket, backup[0]), "already-used backup code rejected");

    console.log("PHASE5A_OK");
    await app.close();
    process.exit(0);
  } catch (e) {
    console.error("PHASE5A_FAIL:", e && e.message ? e.message : e);
    try { await app.close(); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p5_flow.log 2>&1
grep -q PHASE5A_OK /tmp/p5_flow.log && ok "login chain: full + replay + wrong-code + backup fallback all correct" || { bad "login chain FAILED"; tail -30 /tmp/p5_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 5a RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
