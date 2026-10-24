#!/usr/bin/env bash
# ci/check-tenant-safety.sh
#
# Guards the two ways a query can escape the tenant-scoping Prisma extension, plus
# the SQL-dialect mistake that each database move keeps producing. The dialect check
# was inverted when the database went back to Postgres: it used to ban Postgres
# syntax, and now bans MySQL's.
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

# ── 2. MySQL syntax in raw SQL ──────────────────────────────────
# Backtick identifiers are a syntax error in Postgres (42601) and a ? placeholder
# binds nothing, so either one fails at RUNTIME rather than at build time — which is
# exactly why this is a CI check and not a code-review habit. The 19 statements ported
# in the Postgres move are each on one line, so a line-based grep sees all of them.
#
# pg_advisory stays banned in the same breath, from the other direction: the locks
# here are SELECT ... FOR UPDATE, which works on either engine, and advisory locks
# would tie the code back to one database for no gain.
note "2. MySQL-only SQL syntax"
my_hits=$(grep -rnE '(FROM|SELECT|WHERE|JOIN|ORDER BY) \\?`|= \?|pg_advisory' "$SRC" --include='*.ts' | decomment)
if [ -n "$my_hits" ]; then
  while IFS= read -r l; do bad "MySQL syntax in SQL: $(echo "$l" | cut -c1-110)"; done <<< "$my_hits"
else
  ok "no backtick identifiers, ? placeholders, or advisory locks"
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
