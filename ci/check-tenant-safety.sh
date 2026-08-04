#!/usr/bin/env bash
# ci/check-tenant-safety.sh
#
# Guards the two ways a query can escape the tenant-scoping Prisma extension, plus
# the SQL-dialect mistake that the Postgres→MySQL move kept producing.
#
# The extension in apps/api/src/tenancy/scoped-client.ts injects `tenantId` on every
# top-level operation against a tenant-scoped model. It cannot see:
#
#   1. Raw queries   — $queryRaw / $executeRaw bypass extensions entirely.
#   2. Nested writes — `{ items: { create: [...] } }` is one operation to Prisma, so
#                      the child rows are written without a tenantId.
#
# Both are legitimate in specific places, so each is allowlisted by exact location
# rather than by a pattern that quietly matches anything.
#
# Usage: bash ci/check-tenant-safety.sh     (exit 0 clean, 1 on violation)

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SRC="apps/api/src"
fail=0

# Strip comment lines from `grep -n` output. This script scans code, not prose, and
# the tenancy docs legitimately quote the very patterns being searched for.
decomment() { grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)' || true; }

note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }

# ── 1. Raw queries ────────────────────────────────────────────────────────────────
# Allowlisted file:line-content pairs. Each of these takes an explicit FOR UPDATE lock
# and names its tenant inline; see the comment at each site for why.
ALLOWED_RAW=(
  "audit-hash.ts:AuditCounter"                 # per-tenant audit chain lock
  "audit.module.ts:AuditCounter"               # rebuildChain holds the same lock
  "platform-audit.service.ts:PlatformAuditCounter"  # platform chain lock (global, no tenant)
  "platform-mfa.service.ts:PlatformMfaResetRequest" # single-use claim on a reset request
  "platform-mfa.service.ts:PlatformUser"       # availability floor across super-admins
  "software.module.ts:SoftwareLicense"         # seat allocation lock
  "auth.service.ts:TenantMfaPending"           # MFA attempt-counter lock
  "platform-auth.service.ts:PlatformMfaPending" # ditto, platform side
  "users.service.ts:User"                      # offboard/role-change subject lock
)
note "1. Raw Prisma queries outside the allowlist"
raw_hits=$(grep -rn '\$queryRaw\|\$executeRaw' "$SRC" --include='*.ts' | grep -v '\.spec\.ts:' | decomment)
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file=$(basename "${line%%:*}")
  # Look at the statement itself, which sits on this line or the next few.
  ctx=$(sed -n "$(echo "$line" | cut -d: -f2),+3p" "${line%%:*}" 2>/dev/null)
  matched=0
  for entry in "${ALLOWED_RAW[@]}"; do
    if [ "$file" = "${entry%%:*}" ] && printf '%s' "$ctx" | grep -q "${entry##*:}"; then matched=1; break; fi
  done
  [ $matched -eq 1 ] || bad "unallowlisted raw query: $(echo "$line" | cut -c1-110)"
done <<< "$raw_hits"
[ $fail -eq 0 ] && ok "$(printf '%s' "$raw_hits" | grep -c . ) raw queries, all allowlisted"

# ── 2. Postgres syntax in raw SQL ─────────────────────────────────────────────────
# Double-quoted identifiers are string literals in MySQL, and $1 is a syntax error.
# Three of these shipped in the migration and threw at runtime.
note "2. Postgres-only SQL syntax"
pg_hits=$(grep -rn 'FROM "\|SELECT "\|WHERE "\|= \$[0-9]\|pg_advisory' "$SRC" --include='*.ts' | decomment)
if [ -n "$pg_hits" ]; then
  while IFS= read -r l; do bad "Postgres syntax in SQL: $(echo "$l" | cut -c1-110)"; done <<< "$pg_hits"
else
  ok "no Postgres identifier quoting, \$n placeholders, or advisory locks"
fi

# ── 3. Nested relation writes ─────────────────────────────────────────────────────
# Only allowlisted where BOTH parent and child are global (non-tenant-scoped) models.
note "3. Nested relation writes on tenant-scoped models"
nested_hits=$(grep -rn ': { create:\|: { createMany:\|: { connectOrCreate:' "$SRC" --include='*.ts' | grep -v '\.spec\.ts:' | decomment)
if [ -n "$nested_hits" ]; then
  while IFS= read -r l; do
    # SupportRequest → SupportMessage: both global, nothing to scope.
    if printf '%s' "$l" | grep -q 'support.service.ts'; then
      ok "allowlisted (both models global): $(basename "$(echo "$l" | cut -d: -f1)"):$(echo "$l" | cut -d: -f2)"
    else
      bad "nested write bypasses tenant scoping: $(echo "$l" | cut -c1-110)"
    fi
  done <<< "$nested_hits"
else
  ok "no nested relation writes"
fi

printf '\n'
if [ $fail -ne 0 ]; then
  printf '\033[31mtenant-safety check FAILED\033[0m — see above.\n'
  printf 'If a hit is genuinely safe, add it to the matching allowlist in this script\n'
  printf 'with a comment saying why. Do not broaden the patterns.\n'
  exit 1
fi
printf '\033[32mtenant-safety check passed\033[0m\n'
