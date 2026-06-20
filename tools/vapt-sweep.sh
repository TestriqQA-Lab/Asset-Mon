#!/usr/bin/env bash
set -u
TOK=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@acme.test","password":"Sandeep@123"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
H="Authorization: Bearer $TOK"
PASS=0; FAIL=0
t() {
  local label="$1"; shift
  local expected="$1"; shift
  local code=$(curl -s -o /tmp/r.out -w "%{http_code}" "$@")
  if [ "$code" = "$expected" ]; then
    echo "  PASS  $label -> $code"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $label -> $code expected $expected; body: $(head -c 200 /tmp/r.out)"
    FAIL=$((FAIL+1))
  fi
}

echo "=== AUTH ==="
t "POST /auth/login (valid)"      201 -H "Content-Type: application/json" -X POST -d '{"email":"admin@acme.test","password":"Sandeep@123"}' http://localhost:4000/api/auth/login
t "GET /me"                       200 -H "$H" http://localhost:4000/api/me
t "GET /health"                   200 http://localhost:4000/api/health
t "GET /metrics"                  200 http://localhost:4000/api/metrics

echo
echo "=== Categories ==="
C=$(curl -s -X POST http://localhost:4000/api/categories -H "$H" -H "Content-Type: application/json" -d '{"name":"SweepCat"}' | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "GET /categories"               200 -H "$H" http://localhost:4000/api/categories
t "GET /categories/:id"           200 -H "$H" "http://localhost:4000/api/categories/$C"
t "PATCH /categories/:id"         200 -H "$H" -X PATCH -H "Content-Type: application/json" -d '{"description":"x"}' "http://localhost:4000/api/categories/$C"
t "DELETE /categories/:id"        200 -H "$H" -X DELETE "http://localhost:4000/api/categories/$C"

echo
echo "=== Departments ==="
D=$(curl -s -X POST http://localhost:4000/api/departments -H "$H" -H "Content-Type: application/json" -d '{"name":"SweepDept"}' | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "GET /departments"              200 -H "$H" http://localhost:4000/api/departments
t "PATCH /departments/:id"        200 -H "$H" -X PATCH -H "Content-Type: application/json" -d '{"costCenter":"X-1"}' "http://localhost:4000/api/departments/$D"
t "DELETE /departments/:id"       200 -H "$H" -X DELETE "http://localhost:4000/api/departments/$D"

echo
echo "=== Locations ==="
L=$(curl -s -X POST http://localhost:4000/api/locations -H "$H" -H "Content-Type: application/json" -d '{"name":"SweepLoc","type":"ROOM"}' | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "GET /locations"                200 -H "$H" http://localhost:4000/api/locations
t "GET /locations/tree"           200 -H "$H" http://localhost:4000/api/locations/tree
t "PATCH /locations/:id"          200 -H "$H" -X PATCH -H "Content-Type: application/json" -d '{"name":"SweepLoc2"}' "http://localhost:4000/api/locations/$L"
t "DELETE /locations/:id"         200 -H "$H" -X DELETE "http://localhost:4000/api/locations/$L"

echo
echo "=== Vendors ==="
V=$(curl -s -X POST http://localhost:4000/api/vendors -H "$H" -H "Content-Type: application/json" -d '{"name":"SweepVen"}' | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "GET /vendors"                  200 -H "$H" http://localhost:4000/api/vendors
t "PATCH /vendors/:id"            200 -H "$H" -X PATCH -H "Content-Type: application/json" -d '{"contact":"x"}' "http://localhost:4000/api/vendors/$V"
t "DELETE /vendors/:id"           200 -H "$H" -X DELETE "http://localhost:4000/api/vendors/$V"

echo
echo "=== Assets ==="
CAT=$(curl -s -H "$H" http://localhost:4000/api/categories | python -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'])")
A=$(curl -s -X POST http://localhost:4000/api/assets -H "$H" -H "Content-Type: application/json" -d "{\"name\":\"sweep\",\"categoryId\":\"$CAT\"}" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "GET /assets filtered"          200 -H "$H" "http://localhost:4000/api/assets?status=IN_STOCK&page=1&pageSize=5"
t "GET /assets/:id"               200 -H "$H" "http://localhost:4000/api/assets/$A"
t "GET /assets/:id/qr"            200 -H "$H" "http://localhost:4000/api/assets/$A/qr"
t "GET /assets/:id/audit"         200 -H "$H" "http://localhost:4000/api/assets/$A/audit"
t "GET /assets/export.csv"        200 -H "$H" http://localhost:4000/api/assets/export.csv
t "PATCH /assets/:id"             200 -H "$H" -X PATCH -H "Content-Type: application/json" -d '{"notes":"updated"}' "http://localhost:4000/api/assets/$A"
t "DELETE /assets/:id"            200 -H "$H" -X DELETE "http://localhost:4000/api/assets/$A"

echo
echo "=== Users ==="
U=$(curl -s -X POST http://localhost:4000/api/users -H "$H" -H "Content-Type: application/json" -d '{"email":"sweep@x.com","password":"Sandeep@123","firstName":"S","lastName":"W","role":"EMPLOYEE"}' | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "GET /users"                    200 -H "$H" http://localhost:4000/api/users
t "PATCH /users/:id"              200 -H "$H" -X PATCH -H "Content-Type: application/json" -d '{"firstName":"S2"}' "http://localhost:4000/api/users/$U"
t "DELETE /users/:id"             200 -H "$H" -X DELETE "http://localhost:4000/api/users/$U"

echo
echo "=== Tickets & maintenance & reservations & audit-sessions ==="
A2=$(curl -s -X POST http://localhost:4000/api/assets -H "$H" -H "Content-Type: application/json" -d "{\"name\":\"sweep2\",\"categoryId\":\"$CAT\"}" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
T=$(curl -s -X POST http://localhost:4000/api/tickets -H "$H" -H "Content-Type: application/json" -d "{\"assetId\":\"$A2\",\"title\":\"sweep\"}" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "GET /tickets/:id"              200 -H "$H" "http://localhost:4000/api/tickets/$T"
t "PATCH /tickets/:id"            200 -H "$H" -X PATCH -H "Content-Type: application/json" -d '{"status":"RESOLVED"}' "http://localhost:4000/api/tickets/$T"

M=$(curl -s -X POST http://localhost:4000/api/maintenance -H "$H" -H "Content-Type: application/json" -d "{\"assetId\":\"$A2\",\"title\":\"sweep\",\"intervalDays\":30,\"nextDueAt\":\"2026-06-01T00:00:00Z\"}" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "POST /maintenance/:id/done"    201 -H "$H" -X POST "http://localhost:4000/api/maintenance/$M/done"
t "DELETE /maintenance/:id"       200 -H "$H" -X DELETE "http://localhost:4000/api/maintenance/$M"

USR=$(curl -s -H "$H" http://localhost:4000/api/users | python -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'])")
TOM=$(python -c "import datetime;d=datetime.datetime.now(datetime.UTC)+datetime.timedelta(days=2);print(d.strftime('%Y-%m-%dT00:00:00Z'))")
END=$(python -c "import datetime;d=datetime.datetime.now(datetime.UTC)+datetime.timedelta(days=2);print(d.strftime('%Y-%m-%dT01:00:00Z'))")
R=$(curl -s -X POST http://localhost:4000/api/reservations -H "$H" -H "Content-Type: application/json" -d "{\"assetId\":\"$A2\",\"userId\":\"$USR\",\"startAt\":\"$TOM\",\"endAt\":\"$END\"}" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "GET /reservations/:id"         200 -H "$H" "http://localhost:4000/api/reservations/$R"
t "POST /reservations/:id/cancel" 201 -H "$H" -X POST "http://localhost:4000/api/reservations/$R/cancel"

AS=$(curl -s -X POST http://localhost:4000/api/audit-sessions -H "$H" -H "Content-Type: application/json" -d '{"name":"sweep","scope":{}}' | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
t "POST /audit-sessions/:id/start"        201 -H "$H" -X POST "http://localhost:4000/api/audit-sessions/$AS/start"
t "GET /audit-sessions/:id/discrepancies" 200 -H "$H" "http://localhost:4000/api/audit-sessions/$AS/discrepancies"
t "DELETE /audit-sessions/:id"            200 -H "$H" -X DELETE "http://localhost:4000/api/audit-sessions/$AS"

echo
echo "=== Procurement / Software / Integrations / Reports ==="
t "GET /purchase-requests"        200 -H "$H" http://localhost:4000/api/purchase-requests
t "GET /purchase-orders"          200 -H "$H" http://localhost:4000/api/purchase-orders
t "GET /software"                 200 -H "$H" http://localhost:4000/api/software
t "GET /licenses"                 200 -H "$H" http://localhost:4000/api/licenses
t "GET /licenses/compliance"      200 -H "$H" http://localhost:4000/api/licenses/compliance
t "GET /api-keys"                 200 -H "$H" http://localhost:4000/api/api-keys
t "GET /webhooks"                 200 -H "$H" http://localhost:4000/api/webhooks
t "GET /audit"                    200 -H "$H" http://localhost:4000/api/audit
t "GET /dashboard/stats"          200 -H "$H" http://localhost:4000/api/dashboard/stats
t "GET /dashboard/alerts"         200 -H "$H" http://localhost:4000/api/dashboard/alerts
t "GET /depreciation/fleet"       200 -H "$H" http://localhost:4000/api/depreciation/fleet
t "GET /reports"                  200 -H "$H" http://localhost:4000/api/reports
t "GET /reports/assets"           200 -H "$H" http://localhost:4000/api/reports/assets
t "GET /docs"                     200 http://localhost:4000/docs

echo
echo "TOTAL: $PASS passed, $FAIL failed"
