#!/usr/bin/env bash
# Phase 8b-i verification: enabling/disabling tenant MFA re-issues the CALLER's
# own session (keeps the acting device signed in) while the tokenVersion bump
# invalidates every other session. Drives the real TenantMfaController via Nest
# DI (REQUEST-scoped ctx faked). Isolated project.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p8biverify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p8bi.bak ] && mv -f .env.p8bi.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 8b-i verify: keep-signed-in on enable/disable"
echo "============================================================"

cp -f .env .env.p8bi.bak 2>/dev/null
PW="p8bi_${RANDOM}${RANDOM}"
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
if $COMPOSE build api >/tmp/p8bi_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p8bi_build.log; exit 1; fi

echo ""; echo "2) Start postgres + catalog migrate"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p8bi_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p8bi_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p8bi_mig.log; }

echo ""; echo "3) enable/disable re-issue the caller's session"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { JwtService } = require("@nestjs/jwt");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { AuthService } = require("./apps/api/dist/auth/auth.service.js");
const { TenantMfaService } = require("./apps/api/dist/auth/tenant-mfa.service.js");
const { TenantMfaController } = require("./apps/api/dist/auth/tenant-mfa.controller.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
const { PrismaClient } = require("@assetmon/db-tenant");
const rejects = async (p, label) => { let t = false; try { await p; } catch (e) { t = true; } assert.ok(t, label); };

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const auth = app.get(AuthService);
  const tenantMfa = app.get(TenantMfaService);
  const jwt = app.get(JwtService);
  const catalog = app.get(CatalogPrismaService);
  const slug = "p8bi"; const password = "Phase8biPass1";
  let db;
  try {
    const prior = await catalog.tenant.findUnique({ where: { slug } });
    if (prior) { const { TenantProvisioningService } = require("./apps/api/dist/tenancy/tenant-provisioning.service.js"); await new TenantProvisioningService().dropDatabase(prior.dbName).catch(() => {}); await catalog.tenantUser.deleteMany({ where: { tenantId: prior.id } }); await catalog.tenant.delete({ where: { id: prior.id } }); }

    await auth.signup({ workspaceName: "P8bi Co", slug, email: "boss@p8bi.test", password, firstName: "B", lastName: "S" });
    const tenant = await catalog.tenant.findUnique({ where: { slug } });
    db = new PrismaClient({ datasources: { db: { url: process.env.TENANT_DB_URL_TEMPLATE.replace("{db}", tenant.dbName) } } });
    let boss = await db.user.findUnique({ where: { email: "boss@p8bi.test" } });

    // Drive the REAL controller with a faked request ctx (prisma() only) + the real AuthService.
    const ctx = { prisma: () => db };
    const ctrl = new TenantMfaController(tenantMfa, ctx, auth);
    const claimsFor = (u) => ({ sub: u.id, tid: tenant.id, slug: tenant.slug, db: tenant.dbName, role: u.role, email: u.email, tv: u.tokenVersion });

    // verify recovery, then ENABLE via the controller (initial opt-in, no password)
    await tenantMfa.verifyRecovery(db, boss.id, (await tenantMfa.sendRecovery(db, boss.id, "boss.rec@othermail.test", false)).devCode);
    const before = await db.user.findUnique({ where: { id: boss.id } });
    const enRes = await ctrl.enable(claimsFor(before), { method: "EMAIL" });
    assert.ok(enRes.tokens && enRes.tokens.accessToken && enRes.tokens.refreshToken, "enable returns a fresh session");
    assert.ok(Array.isArray(enRes.codes) && enRes.codes.length === 10, "enable still returns 10 recovery codes");
    const afterEnable = await db.user.findUnique({ where: { id: boss.id } });
    assert.ok(afterEnable.tokenVersion > before.tokenVersion, "tokenVersion bumped on enable");
    const decA = jwt.verify(enRes.tokens.accessToken, { secret: process.env.JWT_ACCESS_SECRET });
    assert.equal(decA.tv, afterEnable.tokenVersion, "new access token tv == current tokenVersion (caller stays valid)");
    assert.notEqual(decA.tv, before.tokenVersion, "the pre-enable tv is no longer valid (other sessions dropped)");
    const decR = jwt.verify(enRes.tokens.refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
    assert.equal(decR.tv, afterEnable.tokenVersion, "new refresh token tv == current tokenVersion");
    assert.equal(decA.sub, boss.id, "token is for the caller");
    assert.equal(decA.slug, tenant.slug, "token carries the tenant slug");

    // wrong-password disable is rejected (step-up), session unchanged
    await rejects(ctrl.disable({ ...claimsFor(afterEnable) }, { password: "wrongpass" }), "disable with wrong password rejected");
    assert.equal((await db.user.findUnique({ where: { id: boss.id } })).mfaMethod, "EMAIL", "still enabled after a rejected disable");

    // DISABLE via the controller (correct password) -> also re-issues the session
    const disRes = await ctrl.disable(claimsFor(afterEnable), { password });
    assert.ok(disRes.tokens && disRes.tokens.accessToken, "disable returns a fresh session");
    const afterDisable = await db.user.findUnique({ where: { id: boss.id } });
    assert.equal(afterDisable.mfaMethod, "NONE", "MFA off after disable");
    assert.ok(afterDisable.tokenVersion > afterEnable.tokenVersion, "tokenVersion bumped again on disable");
    const decD = jwt.verify(disRes.tokens.accessToken, { secret: process.env.JWT_ACCESS_SECRET });
    assert.equal(decD.tv, afterDisable.tokenVersion, "disable re-issued token tv == current tokenVersion");

    // disabling again is a no-op and returns NO new session (nothing changed)
    const noop = await ctrl.disable(claimsFor(afterDisable), { password });
    assert.ok(!noop.tokens, "no-op disable (already off) returns no tokens");

    console.log("PHASE8BI_OK");
    await db.$disconnect(); await app.close(); process.exit(0);
  } catch (e) {
    console.error("PHASE8BI_FAIL:", e && e.message ? e.message : e);
    try { if (db) await db.$disconnect(); } catch (x) {}
    try { await app.close(); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p8bi_flow.log 2>&1
grep -q PHASE8BI_OK /tmp/p8bi_flow.log && ok "enable/disable re-issue caller session + tv bump correct" || { bad "8b-i flow FAILED"; tail -40 /tmp/p8bi_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 8b-i RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
