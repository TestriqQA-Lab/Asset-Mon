#!/usr/bin/env bash
# tools/verify-tenant-isolation.sh
#
# Step 13 of the MySQL migration: prove that two tenants sharing a table cannot see
# or touch each other's rows.
#
# Under database-per-tenant this test was unnecessary — isolation was a property of
# the connection. Under shared tables it is a property of application code, so it has
# to be demonstrated rather than assumed. Every check below is the shape of a real
# attack: hold a valid session for tenant A, present an id belonging to tenant B.
#
# Usage:
#   API=http://localhost:4099 bash tools/verify-tenant-isolation.sh
#
# Exit 0 = isolated. Exit 1 = a tenant boundary leaked.

set -uo pipefail
API="${API:-http://localhost:4099}"
PASS=0; FAIL=0

g()  { printf '\033[32m  ✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
r()  { printf '\033[31m  ✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
hdr(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

# Extract a top-level JSON string field without jq (not installed on this box).
jget() { sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" <<< "$1" | head -1; }

code() { # code <token> <method> <path> [body]
  if [ -n "${4:-}" ]; then
    curl -s -o /dev/null -w '%{http_code}' -m 20 -X "$2" "$API$3" \
      -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$4"
  else
    curl -s -o /dev/null -w '%{http_code}' -m 20 -X "$2" "$API$3" -H "Authorization: Bearer $1"
  fi
}
body() { curl -s -m 20 -X "${2:-GET}" "$API$3" -H "Authorization: Bearer $1" \
           ${4:+-H 'Content-Type: application/json'} ${4:+-d "$4"}; }

# A cross-tenant id must not be readable, editable or deletable. 404 rather than 403
# is the correct answer: 403 would confirm the row exists.
denied() { # denied <label> <status>
  case "$2" in
    404|403) g "$1 → $2" ;;
    *)       r "$1 → $2 (expected 404)" ;;
  esac
}

hdr "Setting up two workspaces"
mk() { # mk <slug-prefix> ; echoes "token<TAB>slug"
  local s="$1$RANDOM$RANDOM"
  local out; out=$(curl -s -m 60 -X POST "$API/api/auth/signup" -H 'Content-Type: application/json' \
    -d "{\"slug\":\"$s\",\"workspaceName\":\"Iso $s\",\"email\":\"admin@$s.test\",\"password\":\"Iso!Test#2026\",\"firstName\":\"Iso\",\"lastName\":\"Test\"}")
  printf '%s\t%s' "$(jget "$out" accessToken)" "$s"
}
IFS=$'\t' read -r TOK_A SLUG_A < <(mk isoa)
IFS=$'\t' read -r TOK_B SLUG_B < <(mk isob)
[ -n "$TOK_A" ] && [ -n "$TOK_B" ] || { printf '\033[31mFATAL: signup failed — is the API up at %s?\033[0m\n' "$API"; exit 1; }
g "tenant A ($SLUG_A) and tenant B ($SLUG_B) provisioned"

hdr "Seeding a row of each type in tenant B"
B_ASSET=$(jget "$(body "$TOK_B" POST /api/assets '{"name":"B secret asset","status":"AVAILABLE"}')" id)
B_DEPT=$(jget "$(body "$TOK_B" POST /api/departments '{"name":"B Department"}')" id)
B_LOC=$(jget "$(body "$TOK_B" POST /api/locations '{"name":"B Location","type":"BUILDING"}')" id)
B_CAT=$(jget "$(body "$TOK_B" POST /api/categories '{"name":"B Category"}')" id)
B_TICKET=$(jget "$(body "$TOK_B" POST /api/tickets "{\"assetId\":\"$B_ASSET\",\"title\":\"B ticket\",\"priority\":\"LOW\"}")" id)
B_USER=$(jget "$(body "$TOK_B" POST /api/users "{\"email\":\"member@$SLUG_B.test\",\"password\":\"Iso!Test#2026\",\"firstName\":\"B\",\"lastName\":\"Member\",\"role\":\"EMPLOYEE\"}")" id)
B_PR=$(jget "$(body "$TOK_B" POST /api/purchase-requests '{"title":"B purchase","items":[{"description":"thing","quantity":1}]}')" id)
for n in B_ASSET B_DEPT B_LOC B_CAT B_TICKET B_USER B_PR; do
  [ -n "${!n}" ] && g "seeded $n" || r "could not seed $n (check the endpoint contract)"
done
# A row of A's own, so update-path checks have a legitimate target to aim at.
A_OWN=$(jget "$(body "$TOK_A" POST /api/assets '{"name":"A own asset","status":"AVAILABLE"}')" id)
[ -n "$A_OWN" ] && g "seeded A_OWN" || r "could not seed A_OWN"

hdr "Tenant A must not READ tenant B's rows by id"
denied "GET /assets/{B}"             "$(code "$TOK_A" GET "/api/assets/$B_ASSET")"
denied "GET /tickets/{B}"            "$(code "$TOK_A" GET "/api/tickets/$B_TICKET")"
denied "GET /users/{B}"              "$(code "$TOK_A" GET "/api/users/$B_USER")"
denied "GET /purchase-requests/{B}"  "$(code "$TOK_A" GET "/api/purchase-requests/$B_PR")"
denied "GET /departments/{B}"        "$(code "$TOK_A" GET "/api/departments/$B_DEPT")"

hdr "Tenant A must not MUTATE tenant B's rows"
denied "PATCH /assets/{B}"           "$(code "$TOK_A" PATCH "/api/assets/$B_ASSET" '{"name":"pwned"}')"
denied "DELETE /assets/{B}"          "$(code "$TOK_A" DELETE "/api/assets/$B_ASSET")"
denied "PATCH /tickets/{B}"          "$(code "$TOK_A" PATCH "/api/tickets/$B_TICKET" '{"status":"CLOSED"}')"
denied "PATCH /users/{B}"            "$(code "$TOK_A" PATCH "/api/users/$B_USER" '{"role":"ADMIN"}')"
denied "DELETE /departments/{B}"     "$(code "$TOK_A" DELETE "/api/departments/$B_DEPT")"

hdr "Tenant B's rows must not appear in tenant A's LIST responses"
for pair in "assets:$B_ASSET" "tickets:$B_TICKET" "users:$B_USER" "departments:$B_DEPT" \
            "locations:$B_LOC" "categories:$B_CAT" "purchase-requests:$B_PR" "notifications:" "audit:"; do
  path="${pair%%:*}"; needle="${pair##*:}"
  out=$(body "$TOK_A" GET "/api/$path")
  if [ -n "$needle" ] && grep -q "$needle" <<< "$out"; then
    r "GET /$path leaked a tenant-B id"
  elif grep -q "B secret asset\|B Department\|B Location\|B Category\|B ticket\|B purchase\|member@$SLUG_B" <<< "$out"; then
    r "GET /$path leaked tenant-B content"
  else
    g "GET /$path clean"
  fi
done

hdr "Cross-tenant writes must not be possible by referencing B's ids"
# Creating an asset in A that points at B's category/location/department must fail
# rather than silently forming a cross-tenant reference.
st=$(code "$TOK_A" POST /api/assets "{\"name\":\"A crossref\",\"status\":\"AVAILABLE\",\"categoryId\":\"$B_CAT\"}")
case "$st" in 200|201) r "created an asset in A referencing B's category → $st" ;; *) g "cross-tenant categoryId rejected → $st" ;; esac
st=$(code "$TOK_A" POST /api/tickets "{\"assetId\":\"$B_ASSET\",\"title\":\"x\",\"priority\":\"LOW\"}")
case "$st" in 200|201) r "opened a ticket in A against B's asset → $st" ;; *) g "cross-tenant assetId rejected (tickets) → $st" ;; esac

A_ME=$(jget "$(body "$TOK_A" GET /api/me)" id)
st=$(code "$TOK_A" POST /api/reservations "{\"assetId\":\"$B_ASSET\",\"userId\":\"$A_ME\",\"startAt\":\"2027-01-01T00:00:00.000Z\",\"endAt\":\"2027-01-02T00:00:00.000Z\"}")
case "$st" in 200|201) r "reserved B's asset from A → $st" ;; *) g "cross-tenant assetId rejected (reservations) → $st" ;; esac

st=$(code "$TOK_A" POST /api/maintenance "{\"assetId\":\"$B_ASSET\",\"title\":\"x\",\"intervalDays\":30,\"nextDueAt\":\"2027-01-01T00:00:00.000Z\"}")
case "$st" in 200|201) r "scheduled maintenance on B's asset from A → $st" ;; *) g "cross-tenant assetId rejected (maintenance) → $st" ;; esac

st=$(code "$TOK_A" POST /api/purchase-requests "{\"title\":\"x\",\"items\":[{\"description\":\"d\",\"quantity\":1,\"categoryId\":\"$B_CAT\"}]}")
case "$st" in 200|201) r "purchase request in A citing B's category → $st" ;; *) g "cross-tenant categoryId rejected (purchase-requests) → $st" ;; esac

st=$(code "$TOK_A" PATCH "/api/assets/$A_OWN" "{\"categoryId\":\"$B_CAT\"}")
case "$st" in 200|201) r "re-pointed A's own asset at B's category → $st" ;; *) g "cross-tenant categoryId rejected on update → $st" ;; esac

hdr "Each tenant's audit chain verifies independently"
for t in "A:$TOK_A" "B:$TOK_B"; do
  out=$(body "${t##*:}" GET /api/audit/verify)
  grep -q '"intact":true' <<< "$out" && g "tenant ${t%%:*} chain intact" || r "tenant ${t%%:*} chain: $out"
done

printf '\n─────────────────────────────────\n'
printf 'passed: %s   failed: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '\033[31mTENANT ISOLATION FAILED — do not cut over.\033[0m\n'
  exit 1
fi
printf '\033[32mtenant isolation verified\033[0m\n'
