#!/usr/bin/env bash
# Phase 7b-i verification: tenant employee email-2FA enable/disable backend.
# Provisions a tenant DB, then drives TenantMfaService through Nest DI. Isolated.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p7bverify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p7b.bak ] && mv -f .env.p7b.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 7b-i verify: tenant email-2FA enable/disable"
echo "============================================================"

cp -f .env .env.p7b.bak 2>/dev/null
PW="p7b_${RANDOM}${RANDOM}"
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
if $COMPOSE build api >/tmp/p7b_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p7b_build.log; exit 1; fi

echo ""; echo "2) Start postgres + catalog migrate"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p7b_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p7b_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p7b_mig.log; }

echo ""; echo "3) Tenant email-2FA enable/disable flow"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { TenantMfaService } = require("./apps/api/dist/auth/tenant-mfa.service.js");
const { TenantProvisioningService } = require("./apps/api/dist/tenancy/tenant-provisioning.service.js");
const { PrismaClient } = require("@assetmon/db-tenant");
const bcrypt = require("bcryptjs");
const rejects = async (p, label) => { let t = false; try { await p; } catch (e) { t = true; } assert.ok(t, label); };

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(TenantMfaService);
  const prov = new TenantProvisioningService();
  const dbName = "assetmon_t_p7btest";
  const tenantUrl = process.env.TENANT_DB_URL_TEMPLATE.replace("{db}", dbName);
  let db;
  try {
    await prov.dropDatabase(dbName).catch(() => {});
    await prov.createDatabase(dbName);
    await prov.runMigrations(dbName);
    db = new PrismaClient({ datasources: { db: { url: tenantUrl } } });
    const password = "Phase7bPass1";
    const user = await db.user.create({ data: { email: "emp@acme.test", passwordHash: await bcrypt.hash(password, 12), firstName: "E", lastName: "M", role: "EMPLOYEE", passwordChangedAt: new Date() } });
    const uid = user.id;

    let st = await svc.status(db, uid);
    assert.equal(st.mfaMethod, "NONE", "starts with MFA off");

    // recovery email: same-domain needs ack; different-domain sends
    const same = await svc.sendRecovery(db, uid, "other@acme.test", false);
    assert.equal(same.needsAck, true, "same-domain recovery needs acknowledgement");
    const rec = await svc.sendRecovery(db, uid, "emp.rec@othermail.test", false);
    assert.ok(rec.devCode, "different-domain recovery sends a code");
    await rejects(svc.verifyRecovery(db, uid, "000000"), "wrong recovery code rejected");
    await svc.verifyRecovery(db, uid, rec.devCode);
    assert.ok((await db.user.findUnique({ where: { id: uid } })).recoveryEmailVerifiedAt, "recovery verified");

    // cannot enable EMAIL_TOTP without an authenticator
    await rejects(svc.enable(db, uid, "EMAIL_TOTP"), "EMAIL_TOTP rejected without authenticator");

    // enable EMAIL 2FA -> backup codes, mfaMethod set, tokenVersion bumped
    const tvBefore = (await db.user.findUnique({ where: { id: uid } })).tokenVersion;
    const en = await svc.enable(db, uid, "EMAIL");
    assert.equal(en.codes.length, 10, "enable returns 10 backup codes");
    const after = await db.user.findUnique({ where: { id: uid } });
    assert.equal(after.mfaMethod, "EMAIL", "mfaMethod = EMAIL");
    assert.ok(after.mfaEnabledAt, "mfaEnabledAt set");
    assert.ok(after.tokenVersion > tvBefore, "tokenVersion bumped on enable");
    assert.equal(await db.tenantBackupCode.count({ where: { userId: uid } }), 10, "10 backup-code hashes stored");

    // disable: wrong password rejected; correct password disables + clears
    await rejects(svc.disable(db, uid, "wrongpass"), "disable rejects a wrong password (step-up)");
    await svc.disable(db, uid, password);
    const off = await db.user.findUnique({ where: { id: uid } });
    assert.equal(off.mfaMethod, "NONE", "disabled -> mfaMethod NONE");
    assert.equal(off.recoveryEmail, null, "disable cleared recovery email");
    assert.equal(await db.tenantBackupCode.count({ where: { userId: uid } }), 0, "disable deleted backup codes");

    console.log("PHASE7B_OK");
    await db.$disconnect(); await prov.dropDatabase(dbName).catch(() => {}); await app.close(); process.exit(0);
  } catch (e) {
    console.error("PHASE7B_FAIL:", e && e.message ? e.message : e);
    try { if (db) await db.$disconnect(); } catch (x) {}
    try { await prov.dropDatabase(dbName); } catch (x) {}
    try { await app.close(); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p7b_flow.log 2>&1
grep -q PHASE7B_OK /tmp/p7b_flow.log && ok "enable/disable: recovery + ack + backup codes + step-up all correct" || { bad "tenant email-2FA FAILED"; tail -30 /tmp/p7b_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 7b-i RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
