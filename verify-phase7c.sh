#!/usr/bin/env bash
# Phase 7c verification: company-admin 3FA (EMAIL_TOTP) + level switching.
# Full 3FA login (email -> totp) and a 3FA->2FA switch gated by a password step-up.
# Drives real services via Nest DI. Isolated project.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p7cverify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p7c.bak ] && mv -f .env.p7c.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 7c verify: company-admin 3FA + level switch"
echo "============================================================"

cp -f .env .env.p7c.bak 2>/dev/null
PW="p7c_${RANDOM}${RANDOM}"
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
if $COMPOSE build api >/tmp/p7c_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p7c_build.log; exit 1; fi

echo ""; echo "2) Start postgres + catalog migrate"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p7c_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p7c_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p7c_mig.log; }

echo ""; echo "3) 3FA enable + login + level switch"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { AuthService } = require("./apps/api/dist/auth/auth.service.js");
const { TenantMfaService } = require("./apps/api/dist/auth/tenant-mfa.service.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
const { encryptSecret } = require("./apps/api/dist/common/crypto.js");
const { PrismaClient } = require("@assetmon/db-tenant");
const { authenticator } = require("otplib");
const rejects = async (p, label) => { let t = false; try { await p; } catch (e) { t = true; } assert.ok(t, label); };

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const auth = app.get(AuthService);
  const tenantMfa = app.get(TenantMfaService);
  const catalog = app.get(CatalogPrismaService);
  const slug = "p7c"; const password = "Phase7cPass1";
  let db;
  try {
    const prior = await catalog.tenant.findUnique({ where: { slug } });
    if (prior) { const { TenantProvisioningService } = require("./apps/api/dist/tenancy/tenant-provisioning.service.js"); await new TenantProvisioningService().dropDatabase(prior.dbName).catch(() => {}); await catalog.tenantUser.deleteMany({ where: { tenantId: prior.id } }); await catalog.tenant.delete({ where: { id: prior.id } }); }

    await auth.signup({ workspaceName: "P7c Co", slug, email: "boss@p7c.test", password, firstName: "B", lastName: "S" });
    const tenant = await catalog.tenant.findUnique({ where: { slug } });
    db = new PrismaClient({ datasources: { db: { url: process.env.TENANT_DB_URL_TEMPLATE.replace("{db}", tenant.dbName) } } });
    const boss = await db.user.findUnique({ where: { email: "boss@p7c.test" } });

    // simulate authenticator enrollment (the existing /me/2fa flow): set totp secret + enabled
    const secret = authenticator.generateSecret();
    await db.user.update({ where: { id: boss.id }, data: { totpSecret: encryptSecret(secret), totpEnabled: true } });

    // verify recovery, then enable 3FA (EMAIL_TOTP) — initial enable, no step-up
    await tenantMfa.verifyRecovery(db, boss.id, (await tenantMfa.sendRecovery(db, boss.id, "boss.rec@othermail.test", false)).devCode);
    await tenantMfa.enable(db, boss.id, "EMAIL_TOTP");
    assert.equal((await db.user.findUnique({ where: { id: boss.id } })).mfaMethod, "EMAIL_TOTP", "method = EMAIL_TOTP");

    // full 3FA login: password -> email -> TOTP -> tokens
    const l1 = await auth.login({ email: "boss@p7c.test", password, workspaceSlug: slug });
    assert.equal(l1.code, "EMAIL_OTP_REQUIRED", "3FA login -> email step");
    const l2 = await auth.loginMfaEmail(l1.ticket, l1.devCode);
    assert.equal(l2.code, "TOTP_REQUIRED", "email ok -> TOTP step (3FA)");
    const l3 = await auth.loginMfaTotp(l2.ticket, authenticator.generate(secret));
    assert.ok(l3.accessToken, "TOTP ok -> tokens (full 3FA)");

    // level switch 3FA -> 2FA requires a step-up
    await rejects(tenantMfa.enable(db, boss.id, "EMAIL"), "level switch without password rejected (step-up)");
    await rejects(tenantMfa.enable(db, boss.id, "EMAIL", "wrongpass"), "level switch with wrong password rejected");
    await tenantMfa.enable(db, boss.id, "EMAIL", password);
    assert.equal((await db.user.findUnique({ where: { id: boss.id } })).mfaMethod, "EMAIL", "switched to EMAIL (2FA)");

    // now login is 2FA: email -> tokens (no TOTP step)
    const m1 = await auth.login({ email: "boss@p7c.test", password, workspaceSlug: slug });
    const m2 = await auth.loginMfaEmail(m1.ticket, m1.devCode);
    assert.ok(m2.accessToken && !m2.code, "2FA login: email -> tokens (no TOTP step)");

    console.log("PHASE7C_OK");
    await db.$disconnect(); await app.close(); process.exit(0);
  } catch (e) {
    console.error("PHASE7C_FAIL:", e && e.message ? e.message : e);
    try { if (db) await db.$disconnect(); } catch (x) {}
    try { await app.close(); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p7c_flow.log 2>&1
grep -q PHASE7C_OK /tmp/p7c_flow.log && ok "3FA login + level switch (step-up) all correct" || { bad "3FA flow FAILED"; tail -35 /tmp/p7c_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 7c RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
