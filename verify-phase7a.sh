#!/usr/bin/env bash
# Phase 7a verification: tenant MFA data model.
# Builds the image (regenerates the tenant Prisma client + applies the new
# migration via the REAL TenantProvisioningService), provisions a throwaway
# tenant DB, and confirms the new columns/tables/FKs exist AND the generated
# tenant client can read them. Isolated project.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p7averify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p7a.bak ] && mv -f .env.p7a.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 7a verify: tenant MFA data model"
echo "============================================================"

cp -f .env .env.p7a.bak 2>/dev/null
PW="p7a_${RANDOM}${RANDOM}"
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
UPLOAD_DIR=/app/uploads
EOF

echo ""; echo "1) Build api image (regenerates tenant Prisma client)"
if $COMPOSE build api >/tmp/p7a_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p7a_build.log; exit 1; fi

echo ""; echo "2) Start postgres"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p7a_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }

echo ""; echo "3) Provision a tenant DB via the real provisioner + verify the model"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { TenantProvisioningService } = require("./apps/api/dist/tenancy/tenant-provisioning.service.js");
const { PrismaClient } = require("@assetmon/db-tenant");
const { Client } = require("pg");
const pgConf = { host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD };
const dbName = "assetmon_t_p7atest";
const tenantUrl = process.env.TENANT_DB_URL_TEMPLATE.replace("{db}", dbName);
(async () => {
  const prov = new TenantProvisioningService();
  try {
    await prov.dropDatabase(dbName).catch(() => {});
    await prov.createDatabase(dbName);
    await prov.runMigrations(dbName); // applies ALL tenant migrations incl. 20260621140000_tenant_mfa
    const c = new Client({ ...pgConf, database: dbName });
    await c.connect();
    try {
      for (const col of ["mfaMethod", "mfaEnabledAt", "recoveryEmail", "recoveryEmailVerifiedAt", "lastTotpStep"]) {
        const r = await c.query("SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2", ["User", col]);
        assert.equal(r.rowCount, 1, "User." + col + " column exists");
      }
      for (const t of ["TenantMfaPending", "TenantBackupCode"]) {
        const r = await c.query("SELECT to_regclass($1) IS NOT NULL AS ok", ["public.\"" + t + "\""]);
        assert.equal(r.rows[0].ok, true, "table " + t + " exists");
      }
      for (const fk of ["TenantMfaPending_userId_fkey", "TenantBackupCode_userId_fkey"]) {
        const r = await c.query("SELECT 1 FROM pg_constraint WHERE conname=$1 AND confdeltype=$2", [fk, "c"]);
        assert.equal(r.rowCount, 1, "fk " + fk + " (ON DELETE CASCADE) exists");
      }
    } finally { await c.end(); }

    // Generated tenant client can read the new model (schema<->client<->DB agree)
    const tp = new PrismaClient({ datasources: { db: { url: tenantUrl } } });
    try {
      await tp.user.findMany({ select: { id: true, mfaMethod: true, mfaEnabledAt: true, recoveryEmail: true, recoveryEmailVerifiedAt: true, lastTotpStep: true } });
      await tp.tenantMfaPending.count();
      await tp.tenantBackupCode.count();
    } finally { await tp.$disconnect(); }

    await prov.dropDatabase(dbName).catch(() => {});
    console.log("PHASE7A_OK");
    process.exit(0);
  } catch (e) {
    console.error("PHASE7A_FAIL:", e && e.message ? e.message : e);
    try { await prov.dropDatabase(dbName); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p7a_flow.log 2>&1
grep -q PHASE7A_OK /tmp/p7a_flow.log && ok "tenant model: columns + tables + FKs + client read all correct" || { bad "tenant model FAILED"; tail -30 /tmp/p7a_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 7a RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
