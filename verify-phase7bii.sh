#!/usr/bin/env bash
# Phase 7b-ii verification: tenant login-chain integration + BACK-COMPAT.
# Critical checks: (A) a no-MFA user still logs in normally; (B) the legacy
# single-call TOTP path still works; (C) an email-2FA user goes through the chain;
# (D) attempt counters PERSIST across wrong codes (the rollback-bug fix); (E)
# wrong-then-right works. Drives real services via Nest DI. Isolated project.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p7biiverify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p7bii.bak ] && mv -f .env.p7bii.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 7b-ii verify: tenant login chain + back-compat"
echo "============================================================"

cp -f .env .env.p7bii.bak 2>/dev/null
PW="p7bii_${RANDOM}${RANDOM}"
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
if $COMPOSE build api >/tmp/p7bii_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p7bii_build.log; exit 1; fi

echo ""; echo "2) Start postgres + catalog migrate"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p7bii_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p7bii_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p7bii_mig.log; }

echo ""; echo "3) Login chain + back-compat"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { AuthService } = require("./apps/api/dist/auth/auth.service.js");
const { TenantMfaService } = require("./apps/api/dist/auth/tenant-mfa.service.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
const { TenantProvisioningService } = require("./apps/api/dist/tenancy/tenant-provisioning.service.js");
const { encryptSecret } = require("./apps/api/dist/common/crypto.js");
const { PrismaClient } = require("@assetmon/db-tenant");
const { authenticator } = require("otplib");
const bcrypt = require("bcryptjs");
const rejects = async (p, label) => { let t = false; try { await p; } catch (e) { t = true; } assert.ok(t, label); };

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const auth = app.get(AuthService);
  const tenantMfa = app.get(TenantMfaService);
  const catalog = app.get(CatalogPrismaService);
  const prov = new TenantProvisioningService();
  const slug = "p7bii";
  const password = "Phase7Pass12";
  let db;
  try {
    // clean any prior run
    const prior = await catalog.tenant.findUnique({ where: { slug } });
    if (prior) { await prov.dropDatabase(prior.dbName).catch(() => {}); await catalog.tenantUser.deleteMany({ where: { tenantId: prior.id } }); await catalog.tenant.delete({ where: { id: prior.id } }); }

    // signup -> tenant + admin (mfaMethod NONE)
    await auth.signup({ workspaceName: "P7bii Co", slug, email: "admin@p7bii.test", password, firstName: "A", lastName: "D" });
    const tenant = await catalog.tenant.findUnique({ where: { slug } });
    const tenantUrl = process.env.TENANT_DB_URL_TEMPLATE.replace("{db}", tenant.dbName);
    db = new PrismaClient({ datasources: { db: { url: tenantUrl } } });
    const admin = await db.user.findUnique({ where: { email: "admin@p7bii.test" } });

    // (A) back-compat: a no-MFA user logs in normally
    const a = await auth.login({ email: "admin@p7bii.test", password, workspaceSlug: slug });
    assert.ok(a.accessToken && !a.code, "no-MFA user logs in directly (back-compat)");

    // (B) back-compat: legacy single-call TOTP path still works
    const secret = authenticator.generateSecret();
    await catalog.tenantUser.create({ data: { email: "legacy@p7bii.test", tenantId: tenant.id } });
    await db.user.create({ data: { email: "legacy@p7bii.test", passwordHash: await bcrypt.hash(password, 12), firstName: "L", lastName: "G", role: "EMPLOYEE", passwordChangedAt: new Date(), totpSecret: encryptSecret(secret), totpEnabled: true } });
    await rejects(auth.login({ email: "legacy@p7bii.test", password, workspaceSlug: slug }), "legacy TOTP user without code is rejected (TOTP_REQUIRED)");
    const lg = await auth.login({ email: "legacy@p7bii.test", password, workspaceSlug: slug, totp: authenticator.generate(secret) });
    assert.ok(lg.accessToken, "legacy single-call TOTP login still issues tokens");

    // (C) enable email-2FA on the admin, then log in through the chain
    await tenantMfa.verifyRecovery(db, admin.id, (await tenantMfa.sendRecovery(db, admin.id, "admin.rec@othermail.test", false)).devCode);
    await tenantMfa.enable(db, admin.id, "EMAIL");
    const c1 = await auth.login({ email: "admin@p7bii.test", password, workspaceSlug: slug });
    assert.equal(c1.code, "EMAIL_OTP_REQUIRED", "email-2FA user gets EMAIL_OTP_REQUIRED");
    assert.ok(c1.ticket && c1.devCode, "chain returns ticket + devCode");
    const c2 = await auth.loginMfaEmail(c1.ticket, c1.devCode);
    assert.ok(c2.accessToken, "correct email code issues tokens");

    // (D) counters PERSIST across wrong attempts (the rollback-bug fix)
    const d1 = await auth.login({ email: "admin@p7bii.test", password, workspaceSlug: slug });
    let rem1, rem2;
    try { await auth.loginMfaEmail(d1.ticket, "000000"); } catch (e) { rem1 = (e.getResponse && e.getResponse().attemptsRemaining); }
    try { await auth.loginMfaEmail(d1.ticket, "000000"); } catch (e) { rem2 = (e.getResponse && e.getResponse().attemptsRemaining); }
    assert.equal(rem1, 4, "first wrong attempt leaves 4 remaining");
    assert.equal(rem2, 3, "second wrong attempt leaves 3 remaining (counter persisted across attempts)");

    // (E) wrong then right on a fresh chain
    const e1 = await auth.login({ email: "admin@p7bii.test", password, workspaceSlug: slug });
    await rejects(auth.loginMfaEmail(e1.ticket, "111111"), "wrong code rejected");
    const e2 = await auth.loginMfaEmail(e1.ticket, e1.devCode);
    assert.ok(e2.accessToken, "right code after a wrong one still issues tokens");

    console.log("PHASE7BII_OK");
    await db.$disconnect(); await app.close(); process.exit(0);
  } catch (e) {
    console.error("PHASE7BII_FAIL:", e && e.message ? e.message : e);
    try { if (db) await db.$disconnect(); } catch (x) {}
    try { await app.close(); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p7bii_flow.log 2>&1
grep -q PHASE7BII_OK /tmp/p7bii_flow.log && ok "chain + back-compat + counter-persistence all correct" || { bad "login chain FAILED"; tail -35 /tmp/p7bii_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 7b-ii RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
