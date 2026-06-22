#!/usr/bin/env bash
# Phase 6b verification: governed 4-eyes peer MFA reset.
# Drives real services via Nest DI (no HTTP/ports). Isolated project.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p6bverify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup(){ echo ""; echo "Cleaning up..."; $COMPOSE down -v >/dev/null 2>&1; [ -f .env.p6b.bak ] && mv -f .env.p6b.bak .env && echo "  .env restored"; }
trap cleanup EXIT

echo "============================================================"
echo " Phase 6b verify: 4-eyes peer MFA reset"
echo "============================================================"

cp -f .env .env.p6b.bak 2>/dev/null
PW="p6b_${RANDOM}${RANDOM}"
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
if $COMPOSE build api >/tmp/p6b_build.log 2>&1; then ok "image build OK"; else bad "build FAILED"; tail -40 /tmp/p6b_build.log; exit 1; fi

echo ""; echo "2) Start postgres + migrate (incl. new PlatformMfaResetRequest)"
$COMPOSE down -v >/dev/null 2>&1
$COMPOSE up -d postgres >/tmp/p6b_up.log 2>&1
PG=$($COMPOSE ps -q postgres); s=none
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null || echo none); [ "$s" = "healthy" ] && break; sleep 2; done
[ "$s" = "healthy" ] && ok "postgres healthy" || { bad "postgres not healthy"; exit 1; }
$COMPOSE run --rm -T api npm run db:catalog:migrate >/tmp/p6b_mig.log 2>&1 && ok "catalog migrate OK" || { bad "migrate FAILED"; tail -20 /tmp/p6b_mig.log; }

echo ""; echo "3) 4-eyes peer reset flow"
$COMPOSE run --rm -T api node -e '
const assert = require("assert");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./apps/api/dist/app.module.js");
const { PlatformMfaService } = require("./apps/api/dist/platform/platform-mfa.service.js");
const { PlatformAuthService } = require("./apps/api/dist/platform/platform-auth.service.js");
const { CatalogPrismaService } = require("./apps/api/dist/catalog/catalog-prisma.service.js");
const { authenticator } = require("otplib");
const bcrypt = require("bcryptjs");
const rejects = async (p, label) => { let t = false; try { await p; } catch (e) { t = true; } assert.ok(t, label); };
const ACT = (id, email) => ({ id, email, role: "SUPER_ADMIN" });

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const mfa = app.get(PlatformMfaService); const auth = app.get(PlatformAuthService); const catalog = app.get(CatalogPrismaService);
  const enroll = async (email) => {
    await catalog.platformUser.deleteMany({ where: { email } });
    const u = await catalog.platformUser.create({ data: { email, passwordHash: await bcrypt.hash("Phase6Pass123", 12), firstName: "P", lastName: "6", role: "SUPER_ADMIN", active: true, passwordChangedAt: new Date() } });
    const rl = () => catalog.platformUser.findUnique({ where: { id: u.id } });
    await mfa.verifyPrimaryEmail(u, (await mfa.sendPrimaryEmail(await rl())).devCode);
    const t = await mfa.startTotp(await rl()); await mfa.verifyTotp(await rl(), authenticator.generate(t.secret));
    await mfa.verifyRecoveryEmail(u, (await mfa.sendRecoveryEmail(await rl(), email.split("@")[0] + "@othermail.test", false)).devCode);
    await mfa.generateBackupCodes(await rl()); await mfa.complete(await rl());
    return { id: u.id, email, secret: t.secret };
  };
  try {
    const R = await enroll("p6b_req@assetmon.local"); // requester
    const A = await enroll("p6b_app@assetmon.local"); // approver (neutral)
    const T = await enroll("p6b_tgt@assetmon.local"); // target

    // request (happy)
    const rr = await mfa.requestPeerReset(ACT(R.id, R.email), T.id, "INC-100");
    assert.ok(rr.requestId, "peer-reset request created");

    // self-reset rejected
    await rejects(mfa.requestPeerReset(ACT(R.id, R.email), R.id, "INC-101"), "self-reset rejected");

    // 4-eyes: requester cannot approve their own request
    await rejects(mfa.approvePeerReset(ACT(R.id, R.email), rr.requestId, authenticator.generate(R.secret)), "requester cannot approve (4-eyes)");
    // target cannot approve
    await rejects(mfa.approvePeerReset(ACT(T.id, T.email), rr.requestId, authenticator.generate(T.secret)), "target cannot approve");
    // approver wrong step-up code rejected
    await rejects(mfa.approvePeerReset(ACT(A.id, A.email), rr.requestId, "000000"), "wrong step-up code rejected");

    // approver correct step-up -> success
    await catalog.platformUser.update({ where: { id: A.id }, data: { lastTotpStep: null } });
    const appr = await mfa.approvePeerReset(ACT(A.id, A.email), rr.requestId, authenticator.generate(A.secret));
    assert.ok(appr.ok, "neutral approver with valid step-up succeeds");

    // target MFA cleared + re-gated
    const tu = await catalog.platformUser.findUnique({ where: { id: T.id } });
    assert.equal(tu.mfaEnrolledAt, null, "target MFA cleared");
    assert.equal(await catalog.platformBackupCode.count({ where: { userId: T.id } }), 0, "target backup codes deleted");
    const lt = await auth.login({ email: T.email, password: "Phase6Pass123" });
    assert.equal(lt.code, "MFA_SETUP_REQUIRED", "target re-gated to setup");

    // request marked APPROVED + approver recorded + blocking chained audit
    const reqRow = await catalog.platformMfaResetRequest.findUnique({ where: { id: rr.requestId } });
    assert.equal(reqRow.status, "APPROVED", "request status APPROVED");
    assert.equal(reqRow.approverId, A.id, "approver recorded");
    const audit = await catalog.platformAuditLog.findFirst({ where: { action: "platform.mfa.admin_reset", targetId: T.id }, orderBy: { createdAt: "desc" } });
    assert.ok(audit && audit.entryHash, "blocking chained audit row written");

    // re-approving a consumed request is rejected
    await rejects(mfa.approvePeerReset(ACT(A.id, A.email), rr.requestId, authenticator.generate(A.secret)), "already-approved request cannot be re-approved");

    // <3 active super-admins -> request refused (CLI is the path instead)
    await catalog.platformUser.update({ where: { id: A.id }, data: { active: false } });
    await rejects(mfa.requestPeerReset(ACT(R.id, R.email), T.id, "INC-102"), "request refused with <3 active super-admins");

    console.log("PHASE6B_OK");
    await app.close(); process.exit(0);
  } catch (e) { console.error("PHASE6B_FAIL:", e && e.message ? e.message : e); try { await app.close(); } catch (x) {} process.exit(1); }
})();
' >/tmp/p6b_flow.log 2>&1
grep -q PHASE6B_OK /tmp/p6b_flow.log && ok "peer reset: 4-eyes + step-up + guards + blocking audit all correct" || { bad "peer reset FAILED"; tail -30 /tmp/p6b_flow.log; }

echo ""
echo "============================================================"
printf " PHASE 6b RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
