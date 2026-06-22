#!/usr/bin/env bash
# Phase 7d verification: company-admin "Reset this user's MFA" recovery action.
# Proves: ADMIN-only gate, admin-own-password step-up (only when the admin has
# MFA), the full clear (incl. authenticator), backup/pending wiped, tokenVersion
# bumped, audit entry written, and — critically — that a user who enrolled 3FA
# and "lost their device" can log in NORMALLY again after the reset.
# Drives the real UsersService via Nest DI (REQUEST-scoped ctx faked). Isolated project.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p7dverify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p7d.bak ] && mv -f .env.p7d.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 7d verify: admin reset-user-MFA (recovery)"
echo "============================================================"

cp -f .env .env.p7d.bak 2>/dev/null
PW="p7d_${RANDOM}${RANDOM}"
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
if $COMPOSE build api >/tmp/p7d_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p7d_build.log; exit 1; fi

echo ""; echo "2) Start postgres + catalog migrate"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p7d_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p7d_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p7d_mig.log; }

echo ""; echo "3) Enroll user MFA -> admin reset -> recovered + normal login"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const bcrypt = require("bcryptjs");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { AuthService } = require("./apps/api/dist/auth/auth.service.js");
const { TenantMfaService } = require("./apps/api/dist/auth/tenant-mfa.service.js");
const { UsersService } = require("./apps/api/dist/users/users.service.js");
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
  const slug = "p7d"; const bossPw = "Phase7dBoss1"; const empPw = "Phase7dEmp1!";
  let db;
  try {
    const prior = await catalog.tenant.findUnique({ where: { slug } });
    if (prior) { const { TenantProvisioningService } = require("./apps/api/dist/tenancy/tenant-provisioning.service.js"); await new TenantProvisioningService().dropDatabase(prior.dbName).catch(() => {}); await catalog.tenantUser.deleteMany({ where: { tenantId: prior.id } }); await catalog.tenant.delete({ where: { id: prior.id } }); }

    await auth.signup({ workspaceName: "P7d Co", slug, email: "boss@p7d.test", password: bossPw, firstName: "B", lastName: "S" });
    const tenant = await catalog.tenant.findUnique({ where: { slug } });
    db = new PrismaClient({ datasources: { db: { url: process.env.TENANT_DB_URL_TEMPLATE.replace("{db}", tenant.dbName) } } });

    // UsersService.resetUserMfa only uses ctx.prisma() + ctx.impersonatedBy, so a
    // minimal fake context sidesteps the REQUEST scope (no HTTP layer in the harness).
    const ctx = { prisma: () => db, impersonatedBy: undefined };
    const users = new UsersService(ctx, catalog, null);

    // ---- create an EMPLOYEE (mirror what UsersService.create does, minus billing) ----
    const empHash = await bcrypt.hash(empPw, 12);
    await catalog.tenantUser.create({ data: { email: "emp@p7d.test", tenantId: tenant.id } });
    let emp = await db.user.create({ data: { email: "emp@p7d.test", passwordHash: empHash, firstName: "E", lastName: "M", role: "EMPLOYEE", passwordChangedAt: new Date() } });

    // ---- employee enrolls 3FA (worst case: also "owns" an authenticator device) ----
    const secret = authenticator.generateSecret();
    await db.user.update({ where: { id: emp.id }, data: { totpSecret: encryptSecret(secret), totpEnabled: true } });
    await tenantMfa.verifyRecovery(db, emp.id, (await tenantMfa.sendRecovery(db, emp.id, "emp.rec@othermail.test", false)).devCode);
    await tenantMfa.enable(db, emp.id, "EMAIL_TOTP");
    emp = await db.user.findUnique({ where: { id: emp.id } });
    assert.equal(emp.mfaMethod, "EMAIL_TOTP", "emp enrolled EMAIL_TOTP");
    assert.ok((await db.tenantBackupCode.count({ where: { userId: emp.id } })) === 10, "emp has 10 backup codes");
    const empTvBefore = emp.tokenVersion;

    // confirm the employee login is actually MFA-gated before the reset
    const g = await auth.login({ email: "emp@p7d.test", password: empPw, workspaceSlug: slug });
    assert.equal(g.code, "EMAIL_OTP_REQUIRED", "pre-reset: emp login is MFA-gated");

    // ---- the acting admin enrolls their OWN MFA so step-up is required ----
    await tenantMfa.verifyRecovery(db, (await db.user.findUnique({ where: { email: "boss@p7d.test" } })).id, (await tenantMfa.sendRecovery(db, (await db.user.findUnique({ where: { email: "boss@p7d.test" } })).id, "boss.rec@othermail.test", false)).devCode);
    const boss = await db.user.findUnique({ where: { email: "boss@p7d.test" } });
    await tenantMfa.enable(db, boss.id, "EMAIL");

    // ---- guard checks ----
    await rejects(users.resetUserMfa(emp.id, { id: boss.id, role: "EMPLOYEE" }), "non-admin actor rejected (ForbiddenException)");
    await rejects(users.resetUserMfa(emp.id, { id: boss.id, role: "ADMIN" }), "admin-with-MFA, no password rejected (step-up)");
    await rejects(users.resetUserMfa(emp.id, { id: boss.id, role: "ADMIN" }, "wrongpass"), "admin-with-MFA, wrong password rejected");
    assert.equal((await db.user.findUnique({ where: { id: emp.id } })).mfaMethod, "EMAIL_TOTP", "emp UNCHANGED after rejected attempts");

    // ---- the reset (correct step-up password) ----
    const res = await users.resetUserMfa(emp.id, { id: boss.id, role: "ADMIN" }, bossPw);
    assert.ok(res && res.ok, "reset returns ok");

    // ---- full clear assertions ----
    const after = await db.user.findUnique({ where: { id: emp.id } });
    assert.equal(after.mfaMethod, "NONE", "mfaMethod NONE");
    assert.equal(after.mfaEnabledAt, null, "mfaEnabledAt null");
    assert.equal(after.recoveryEmail, null, "recoveryEmail null");
    assert.equal(after.recoveryEmailVerifiedAt, null, "recoveryEmailVerifiedAt null");
    assert.equal(after.totpSecret, null, "totpSecret null (authenticator cleared)");
    assert.equal(after.totpEnabled, false, "totpEnabled false (authenticator cleared)");
    assert.equal(after.lastTotpStep, null, "lastTotpStep null");
    assert.equal(after.failedLoginCount, 0, "failedLoginCount 0");
    assert.equal(after.lockedUntil, null, "lockedUntil null");
    assert.ok(after.tokenVersion > empTvBefore, "tokenVersion bumped (sessions killed)");
    assert.equal(await db.tenantBackupCode.count({ where: { userId: emp.id } }), 0, "backup codes deleted");
    assert.equal(await db.tenantMfaPending.count({ where: { userId: emp.id } }), 0, "pending chains deleted");

    // ---- audit entry ----
    const ae = await db.auditLog.findFirst({ where: { action: "user.reset_mfa" }, orderBy: { seq: "desc" } });
    assert.ok(ae && ae.detail && ae.detail.userId === emp.id && ae.performedById === boss.id, "audit entry user.reset_mfa written");

    // ---- the WHOLE POINT: a device-lost user logs in NORMALLY again ----
    const n = await auth.login({ email: "emp@p7d.test", password: empPw, workspaceSlug: slug });
    assert.ok(n.accessToken && !n.code, "post-reset: emp login issues tokens directly (no MFA wall)");

    // ---- conditional step-up: an admin WITHOUT MFA needs no password ----
    // boss2 has no MFA; re-enroll emp, then boss2 resets with no password.
    const b2Hash = await bcrypt.hash("Phase7dBoss2", 12);
    await catalog.tenantUser.create({ data: { email: "boss2@p7d.test", tenantId: tenant.id } });
    const boss2 = await db.user.create({ data: { email: "boss2@p7d.test", passwordHash: b2Hash, firstName: "B2", lastName: "S", role: "ADMIN", passwordChangedAt: new Date() } });
    await tenantMfa.verifyRecovery(db, emp.id, (await tenantMfa.sendRecovery(db, emp.id, "emp.rec2@othermail.test", false)).devCode);
    await tenantMfa.enable(db, emp.id, "EMAIL");
    assert.equal((await db.user.findUnique({ where: { id: emp.id } })).mfaMethod, "EMAIL", "emp re-enrolled EMAIL");
    await users.resetUserMfa(emp.id, { id: boss2.id, role: "ADMIN" }); // no password
    assert.equal((await db.user.findUnique({ where: { id: emp.id } })).mfaMethod, "NONE", "admin-without-MFA reset (no step-up needed)");

    console.log("PHASE7D_OK");
    await db.$disconnect(); await app.close(); process.exit(0);
  } catch (e) {
    console.error("PHASE7D_FAIL:", e && e.message ? e.message : e);
    try { if (db) await db.$disconnect(); } catch (x) {}
    try { await app.close(); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p7d_flow.log 2>&1
grep -q PHASE7D_OK /tmp/p7d_flow.log && ok "reset gates + full clear + recovery login all correct" || { bad "7d flow FAILED"; tail -40 /tmp/p7d_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 7d RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
