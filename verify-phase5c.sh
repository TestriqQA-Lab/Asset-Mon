#!/usr/bin/env bash
# Phase 5c verification: SUPPORT read-only role gates (Option B).
# SUPPORT must be blocked from every write/destructive/operator/impersonation
# action; SUPER_ADMIN must be allowed. Drives real services via Nest DI.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p5cverify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p5c.bak ] && mv -f .env.p5c.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 5c verify: SUPPORT read-only role gates"
echo "============================================================"

cp -f .env .env.p5c.bak 2>/dev/null
PW="p5c_${RANDOM}${RANDOM}"
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
if $COMPOSE build api >/tmp/p5c_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p5c_build.log; exit 1; fi

echo ""; echo "2) Start postgres + migrate"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p5c_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p5c_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p5c_mig.log; }

echo ""; echo "3) SUPPORT is read-only; SUPER_ADMIN is allowed"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { PlatformAuthService } = require("./apps/api/dist/platform/platform-auth.service.js");
const { PlatformTenantsService } = require("./apps/api/dist/platform/platform-tenants.service.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
const rejects = async (p, label) => { let t = false; try { await p; } catch (e) { t = true; } assert.ok(t, label); };

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const auth = app.get(PlatformAuthService);
  const tenants = app.get(PlatformTenantsService);
  const catalog = app.get(CatalogPrismaService);
  const sup = { id: "support-1", email: "support@assetmon.local", role: "SUPPORT" };
  const sa = { id: "sa-1", email: "sa@assetmon.local", role: "SUPER_ADMIN" };
  try {
    await catalog.platformUser.deleteMany({ where: { email: { startsWith: "p5c" } } });

    // SUPPORT is forbidden from every write / operator / tenant action
    await rejects(auth.createAdmin(sup, { email: "p5cx@assetmon.local", password: "Passw0rd12", firstName: "X", lastName: "Y", role: "SUPPORT" }), "SUPPORT cannot create operators");
    await rejects(auth.updateAdmin(sup, "someid", { active: false }), "SUPPORT cannot update operators");
    await rejects(auth.resetAdminPassword(sup, "someid", "Passw0rd12"), "SUPPORT cannot reset operator passwords");
    await rejects(auth.deleteAdmin(sup, "someid"), "SUPPORT cannot delete operators");
    await rejects(tenants.setStatus(sup, "tid", "SUSPENDED"), "SUPPORT cannot suspend tenants");
    await rejects(tenants.hardDelete(sup, "tid", "slug"), "SUPPORT cannot delete tenants");
    await rejects(tenants.updatePlan(sup, "tid", "starter"), "SUPPORT cannot change plans");
    await rejects(tenants.updateSubscription(sup, "tid", {}), "SUPPORT cannot change subscriptions");
    await rejects(tenants.resetTenantUserPassword(sup, "tid", "uid"), "SUPPORT cannot reset tenant-user passwords");
    await rejects(tenants.impersonate(sup, "tid", "uid"), "SUPPORT cannot impersonate");

    // SUPER_ADMIN is allowed
    const created = await auth.createAdmin(sa, { email: "p5cnew@assetmon.local", password: "Passw0rd12", firstName: "N", lastName: "U", role: "SUPPORT" });
    assert.ok(created && created.id, "SUPER_ADMIN can create an operator");
    assert.equal(created.role, "SUPPORT", "created operator has the requested role");

    // No self-promotion / self-role-change, even for a SUPER_ADMIN
    await rejects(auth.updateAdmin(sa, sa.id, { role: "SUPPORT" }), "cannot change your own role");

    console.log("PHASE5C_OK");
    await app.close(); process.exit(0);
  } catch (e) {
    console.error("PHASE5C_FAIL:", e && e.message ? e.message : e);
    try { await app.close(); } catch (x) {}
    process.exit(1);
  }
})();
' >/tmp/p5c_flow.log 2>&1
grep -q PHASE5C_OK /tmp/p5c_flow.log && ok "role gates: SUPPORT blocked on all writes, SUPER_ADMIN allowed" || { bad "role gates FAILED"; tail -30 /tmp/p5c_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 5c RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
