#!/usr/bin/env bash
# Phase 5b verification: MFA ENFORCEMENT — refresh re-MFA gate + guard hard-gate.
# Drives real services/guard through Nest DI (no HTTP/ports). Isolated project.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p5bverify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p5b.bak ] && mv -f .env.p5b.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 5b verify: MFA enforcement (refresh + guard)"
echo "============================================================"

cp -f .env .env.p5b.bak 2>/dev/null
PW="p5b_${RANDOM}${RANDOM}"
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
if $COMPOSE build api >/tmp/p5b_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p5b_build.log; exit 1; fi

echo ""; echo "2) Start postgres + migrate"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p5b_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p5b_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p5b_mig.log; }

echo ""; echo "3) Refresh re-MFA gate + guard hard-gate"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const crypto = require("crypto");
const { NestFactory } = require("@nestjs/core");
const { JwtService } = require("@nestjs/jwt");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { PlatformAuthService } = require("./apps/api/dist/platform/platform-auth.service.js");
const { PlatformMfaService } = require("./apps/api/dist/platform/platform-mfa.service.js");
const { PlatformAuthGuard } = require("./apps/api/dist/platform/platform-auth.guard.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
const { authenticator } = require("otplib");
const bcrypt = require("bcryptjs");
const rejects = async (p, label) => { let t = false; try { await p; } catch { t = true; } assert.ok(t, label); };
const ctx = (token) => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: "Bearer " + token } }) }) });

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const auth = app.get(PlatformAuthService);
  const mfa = app.get(PlatformMfaService);
  const guard = app.get(PlatformAuthGuard);
  const catalog = app.get(CatalogPrismaService);
  const jwt = new JwtService({});
  const now = () => Math.floor(Date.now() / 1000);
  try {
    // operator1: fully enrolled
    const e1 = "p5b1@assetmon.local"; const pw = "Phase5bPass123";
    await catalog.platformUser.deleteMany({ where: { email: { in: [e1, "p5b2@assetmon.local"] } } });
    let u1 = await catalog.platformUser.create({ data: { email: e1, passwordHash: await bcrypt.hash(pw, 12), firstName: "A", lastName: "One", role: "SUPER_ADMIN", active: true, passwordChangedAt: new Date() } });
    const rl1 = () => catalog.platformUser.findUnique({ where: { id: u1.id } });
    await mfa.verifyPrimaryEmail(u1, (await mfa.sendPrimaryEmail(await rl1())).devCode);
    const totp = await mfa.startTotp(await rl1());
    await mfa.verifyTotp(await rl1(), authenticator.generate(totp.secret));
    await mfa.verifyRecoveryEmail(u1, (await mfa.sendRecoveryEmail(await rl1(), "p5b1rec@othermail.test", false)).devCode);
    await mfa.generateBackupCodes(await rl1());
    await mfa.complete(await rl1());
    await catalog.platformUser.update({ where: { id: u1.id }, data: { lastTotpStep: null } });

    // login chain -> tokens
    const l1 = await auth.login({ email: e1, password: pw });
    const l2 = await auth.loginMfaEmail(l1.ticket, l1.devCode);
    const tok = await auth.loginMfaTotp(l2.ticket, authenticator.generate(totp.secret));
    assert.ok(tok.accessToken && tok.refreshToken, "login chain issued tokens");

    // A) refresh happy path
    const r = await auth.refresh(tok.refreshToken);
    assert.ok(r.accessToken, "valid refresh issues new tokens");
    u1 = await rl1();

    // B) refresh rejected when mfaAt is older than 24h
    const oldRefresh = jwt.sign({ sub: u1.id, jti: crypto.randomUUID(), platform: true, tv: u1.tokenVersion, mfaAt: now() - 90000 }, { secret: process.env.JWT_REFRESH_SECRET, algorithm: "HS256", expiresIn: "8h" });
    await rejects(auth.refresh(oldRefresh), "refresh older than 24h mfaAt rejected");

    // operator2: NOT enrolled
    const e2 = "p5b2@assetmon.local";
    const u2 = await catalog.platformUser.create({ data: { email: e2, passwordHash: await bcrypt.hash(pw, 12), firstName: "B", lastName: "Two", role: "SUPER_ADMIN", active: true, passwordChangedAt: new Date() } });

    // C) refresh rejected for an unenrolled operator (no 1FA backdoor)
    const unRefresh = jwt.sign({ sub: u2.id, jti: crypto.randomUUID(), platform: true, tv: u2.tokenVersion, mfaAt: now() }, { secret: process.env.JWT_REFRESH_SECRET, algorithm: "HS256", expiresIn: "8h" });
    await rejects(auth.refresh(unRefresh), "refresh rejected for unenrolled operator");

    // D) guard: enrolled access token allowed
    assert.equal(await guard.canActivate(ctx(tok.accessToken)), true, "guard allows enrolled access token");

    // E) guard: an MFA setup ticket cannot be used as an access token
    const setupResp = await auth.login({ email: e2, password: pw });
    assert.equal(setupResp.code, "MFA_SETUP_REQUIRED", "unenrolled login returns setup ticket");
    await rejects(guard.canActivate(ctx(setupResp.setupTicket)), "guard rejects a setup ticket (purpose != access)");

    // F) guard: forged access token for an unenrolled operator is hard-gated
    const forged = jwt.sign({ sub: u2.id, email: e2, role: "SUPER_ADMIN", platform: true, purpose: "access", tv: u2.tokenVersion, mfaAt: now() }, { secret: process.env.JWT_ACCESS_SECRET, algorithm: "HS256", expiresIn: 900 });
    await rejects(guard.canActivate(ctx(forged)), "guard hard-gates an unenrolled operator");

    console.log("PHASE5B_OK");
    await app.close(); process.exit(0);
  } catch (e) {
    console.error("PHASE5B_FAIL:", e && e.message ? e.message : e);
    try { await app.close(); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p5b_flow.log 2>&1
grep -q PHASE5B_OK /tmp/p5b_flow.log && ok "enforcement: refresh gate + guard hard-gate all correct" || { bad "enforcement FAILED"; tail -30 /tmp/p5b_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 5b RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
