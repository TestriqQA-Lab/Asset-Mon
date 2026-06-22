#!/usr/bin/env bash
# Phase 3 verification: shared MFA kernel (OTP hashing, backup codes, ticket).
# Pure logic — no database. Builds the image (proves the kernel compiles) then
# exercises every kernel function in a one-off container against the compiled
# dist. Isolated compose project; backs up/restores .env.
cd "$(dirname "$0")" || exit 1
COMPOSE="docker compose -p assetmon_p3verify -f docker-compose.yml -f docker-compose.local.yml"
PASS=0; FAIL=0
ok(){  printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup(){
  echo ""; echo "Cleaning up (down -v, restoring .env)..."
  $COMPOSE down -v >/dev/null 2>&1
  [ -f .env.phase3.bak ] && mv -f .env.phase3.bak .env && echo "  .env restored"
}
trap cleanup EXIT

echo "============================================================"
echo " Phase 3 verify: shared MFA kernel"
echo "============================================================"

cp -f .env .env.phase3.bak 2>/dev/null
cat > .env <<EOF
NODE_ENV=production
OTP_PEPPER=$(openssl rand -hex 32)
OTP_PEPPER_VERSION=1
JWT_MFA_TICKET_SECRET=$(openssl rand -hex 32)
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=unused_phase3
EOF

echo ""; echo "1) Build api image (compiles the new common/mfa kernel)"
if $COMPOSE build api >/tmp/p3_build.log 2>&1; then ok "image build OK (kernel compiles)"; else bad "build FAILED"; tail -40 /tmp/p3_build.log; exit 1; fi

echo ""; echo "2) Exercise the kernel (otp + backup codes + ticket) against compiled dist"
$COMPOSE run --rm -T --no-deps api node -e '
const A = require("assert");
const otp = require("./apps/api/dist/common/mfa/otp.util.js");
const bc = require("./apps/api/dist/common/mfa/backup-codes.util.js");
const tk = require("./apps/api/dist/common/mfa/mfa-ticket.service.js");
const { JwtService } = require("@nestjs/jwt");

// --- OTP / shared code hashing ---
A.equal(otp.normalizeCode("ab-cd ef"), "ABCDEF", "normalize strips + uppercases");
const code = "123456";
const h = otp.hashCode(code);
A.equal(h.length, 64, "hash is 32-byte hex");
A.equal(otp.hashCode(code), h, "hash is deterministic");
A.notStrictEqual(otp.hashCode("654321"), h, "different code -> different hash");
A.ok(otp.verifyCode(code, h), "verifyCode true on match");
A.ok(!otp.verifyCode("000000", h), "verifyCode false on mismatch");
A.ok(/^[0-9]{6}$/.test(otp.generateNumericOtp(6)), "generateNumericOtp is 6 digits");

// --- backup codes ---
const codes = bc.generateBackupCodes(10);
A.equal(codes.length, 10, "generates 10 codes");
A.equal(new Set(codes.map(c => c.plain)).size, 10, "codes are unique");
for (const c of codes) {
  A.ok(otp.verifyCode(c.plain, c.hash), "code verifies against its stored hash");
  A.ok(otp.verifyCode(c.plain.replace(/-/g, ""), c.hash), "dashless form also verifies (normalize)");
  A.equal(c.pepperVersion, bc.currentPepperVersion(), "pepperVersion is stamped");
  A.ok(c.plain.replace(/-/g, "").length >= 32, "code is >=128-bit (>=32 hex chars)");
}

// --- MFA ticket ---
const svc = new tk.MfaTicketService(new JwtService({}));
const t = svc.sign("mfa_pending", { scope: "platform", nonce: "NONCE1", sub: "u1" }, 600);
const p = svc.verify(t, "mfa_pending");
A.equal(p.scope, "platform", "claims preserved (scope)");
A.equal(p.nonce, "NONCE1", "claims preserved (nonce)");
A.equal(p.purpose, "mfa_pending", "purpose preserved");
let threw = false; try { svc.verify(t, "mfa_setup"); } catch { threw = true; } A.ok(threw, "wrong purpose rejected");
threw = false; try { svc.verify(t + "tamper", "mfa_pending"); } catch { threw = true; } A.ok(threw, "tampered ticket rejected");
const expd = svc.sign("mfa_pending", { scope: "platform", nonce: "z" }, -1);
threw = false; try { svc.verify(expd, "mfa_pending"); } catch { threw = true; } A.ok(threw, "expired ticket rejected");

console.log("KERNEL_OK");
' >/tmp/p3_kernel.log 2>&1
grep -q KERNEL_OK /tmp/p3_kernel.log && ok "kernel: otp + backup codes + ticket all correct" || { bad "kernel check FAILED"; cat /tmp/p3_kernel.log; }

echo ""
echo "============================================================"
printf " PHASE 3 RESULT: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "============================================================"
