#!/usr/bin/env bash
set -u
TOK=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@acme.test","password":"Sandeep@123"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
TOK_BETA=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@beta.test","password":"Sandeep@123"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
TOK_EMP=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"emp1@acme.test","password":"Sandeep@123"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
H="Authorization: Bearer $TOK"
PASS=0; FAIL=0
t() {
  local label="$1"; shift; local expected="$1"; shift
  local code=$(curl -s -o /tmp/r.out -w "%{http_code}" "$@")
  if [ "$code" = "$expected" ]; then echo "  PASS  $label -> $code"; PASS=$((PASS+1))
  else echo "  FAIL  $label -> $code expected $expected"; FAIL=$((FAIL+1)); fi
}

CAT=$(curl -s -H "$H" http://localhost:4000/api/categories | python -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'])")
ACME_ASSET=$(curl -s -H "$H" http://localhost:4000/api/assets | python -c "import sys,json;d=json.load(sys.stdin);print(d['items'][0]['id'])")

echo "=== A. Authentication ==="
t "no token"                  401 http://localhost:4000/api/me
t "garbage bearer"             401 -H "Authorization: Bearer abc" http://localhost:4000/api/me
t "tampered token"             401 -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOiJ4In0.aaaa" http://localhost:4000/api/me

echo
echo "=== B. Authorization (cross-tenant, role escalation) ==="
t "Beta GET acme asset"        404 -H "Authorization: Bearer $TOK_BETA" "http://localhost:4000/api/assets/$ACME_ASSET"
t "Beta DELETE acme asset"     404 -H "Authorization: Bearer $TOK_BETA" -X DELETE "http://localhost:4000/api/assets/$ACME_ASSET"
t "Beta PATCH acme asset"      404 -H "Authorization: Bearer $TOK_BETA" -H "Content-Type: application/json" -X PATCH -d '{"name":"x"}' "http://localhost:4000/api/assets/$ACME_ASSET"
t "EMP POST asset (403)"       403 -H "Authorization: Bearer $TOK_EMP" -H "Content-Type: application/json" -X POST -d "{\"name\":\"x\",\"categoryId\":\"$CAT\"}" http://localhost:4000/api/assets
t "EMP PATCH user role"        403 -H "Authorization: Bearer $TOK_EMP" -H "Content-Type: application/json" -X PATCH -d '{"role":"ADMIN"}' "http://localhost:4000/api/users/00000000-0000-0000-0000-000000000000"
t "EMP POST api-key"           403 -H "Authorization: Bearer $TOK_EMP" -H "Content-Type: application/json" -X POST -d '{"name":"x"}' http://localhost:4000/api/api-keys

echo
echo "=== C. Input validation ==="
t "SQLi in status filter"      400 -H "$H" "http://localhost:4000/api/assets?status=IN_STOCK%27%3B--"
t "asset name as array"        400 -H "$H" -H "Content-Type: application/json" -X POST -d "{\"name\":[\"x\"],\"categoryId\":\"$CAT\"}" http://localhost:4000/api/assets
t "asset name max length"      400 -H "$H" -H "Content-Type: application/json" -X POST -d "{\"name\":\"$(python -c 'print("x"*250)')\",\"categoryId\":\"$CAT\"}" http://localhost:4000/api/assets
t "null byte in name"          400 -H "$H" -H "Content-Type: application/json" -X POST -d "{\"name\":\"x\\u0000y\",\"categoryId\":\"$CAT\"}" http://localhost:4000/api/assets
t "malformed JSON"             400 -H "$H" -H "Content-Type: application/json" -X POST -d '{bad' http://localhost:4000/api/assets

python -c "import json;print(json.dumps({'name':'x','categoryId':'$CAT','notes':'A'*2000000}))" > /tmp/big.json
t "2MB body (413)"             413 -H "$H" -H "Content-Type: application/json" -X POST --data-binary @/tmp/big.json http://localhost:4000/api/assets

t "negative quantity"          400 -H "$H" -H "Content-Type: application/json" -X POST -d "{\"title\":\"x\",\"items\":[{\"description\":\"y\",\"quantity\":-1}]}" http://localhost:4000/api/purchase-requests
t "weak password rejected"     400 -H "Content-Type: application/json" -X POST -d '{"workspaceName":"WP","slug":"weakpw","email":"w@p.com","password":"short77","firstName":"X","lastName":"Y"}' http://localhost:4000/api/auth/signup
t "invalid email"              400 -H "Content-Type: application/json" -X POST -d '{"workspaceName":"WP","slug":"bademail","email":"not-an-email","password":"Sandeep@123","firstName":"X","lastName":"Y"}' http://localhost:4000/api/auth/signup

echo
echo "=== D. Path traversal & file uploads ==="
t "path traversal ../"          404 -H "$H" "http://localhost:4000/api/assets/files/..%2F..%2Fpackage.json"
t "absolute-path traversal"     404 -H "$H" "http://localhost:4000/api/assets/files/%2Fetc%2Fpasswd"

A_FOR_UP=$(curl -s -X POST http://localhost:4000/api/assets -H "$H" -H "Content-Type: application/json" -d "{\"name\":\"upload-target\",\"categoryId\":\"$CAT\"}" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x07\x0b\xfa\x7f\x00\x00\x00\x00IEND\xaeB`\x82' > /c/AssetMon/img.png
echo "#!/bin/bash" > /c/AssetMon/evil.sh
echo "<script>x</script>" > /c/AssetMon/evil.html
dd if=/dev/zero of=/c/AssetMon/huge.png bs=1024 count=6000 2>/dev/null

t "real PNG upload"            201 -H "$H" -X POST -F "file=@C:/AssetMon/img.png;type=image/png" "http://localhost:4000/api/assets/$A_FOR_UP/photo"
t "shell w/ image CT (magic)"  400 -H "$H" -X POST -F "file=@C:/AssetMon/evil.sh;type=image/png" "http://localhost:4000/api/assets/$A_FOR_UP/photo"
t "html w/ text/html CT"       400 -H "$H" -X POST -F "file=@C:/AssetMon/evil.html;type=text/html" "http://localhost:4000/api/assets/$A_FOR_UP/photo"
t "6MB file over limit"        413 -H "$H" -X POST -F "file=@C:/AssetMon/huge.png;type=image/png" "http://localhost:4000/api/assets/$A_FOR_UP/photo"
curl -s -H "$H" -X DELETE "http://localhost:4000/api/assets/$A_FOR_UP" > /dev/null

echo
echo "=== E. API keys, security headers, password mask ==="
NEW_KEY=$(curl -s -X POST http://localhost:4000/api/api-keys -H "$H" -H "Content-Type: application/json" -d '{"name":"final","scope":"read_only"}')
KEY_TOK=$(echo "$NEW_KEY" | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
KEY_ID=$(echo "$NEW_KEY" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
t "valid API key + slug (GET)"  200 -H "X-API-Key: $KEY_TOK" -H "X-Tenant-Slug: acme" http://localhost:4000/api/assets
t "read_only key cannot POST"   403 -H "X-API-Key: $KEY_TOK" -H "X-Tenant-Slug: acme" -H "Content-Type: application/json" -X POST -d '{"name":"x"}' http://localhost:4000/api/categories
t "API key without slug"        401 -H "X-API-Key: $KEY_TOK" http://localhost:4000/api/assets
curl -s -X POST -H "$H" http://localhost:4000/api/api-keys/$KEY_ID/revoke > /dev/null
t "revoked API key"             401 -H "X-API-Key: $KEY_TOK" -H "X-Tenant-Slug: acme" http://localhost:4000/api/assets

# Security headers
HEADERS=$(curl -s -D - -o /dev/null -H "$H" http://localhost:4000/api/me)
for hdr in "X-Content-Type-Options" "X-Frame-Options" "Strict-Transport-Security" "Referrer-Policy"; do
  if echo "$HEADERS" | grep -i "^$hdr" >/dev/null; then echo "  PASS  header $hdr present"; PASS=$((PASS+1))
  else echo "  FAIL  header $hdr missing"; FAIL=$((FAIL+1)); fi
done

# passwordHash never in responses
USERS=$(curl -s -H "$H" http://localhost:4000/api/users)
if echo "$USERS" | grep -q 'passwordHash'; then echo "  FAIL  passwordHash leaked in /users"; FAIL=$((FAIL+1))
else echo "  PASS  passwordHash not in /users"; PASS=$((PASS+1)); fi

ME=$(curl -s -H "$H" http://localhost:4000/api/me)
if echo "$ME" | grep -q 'passwordHash'; then echo "  FAIL  passwordHash leaked in /me"; FAIL=$((FAIL+1))
else echo "  PASS  passwordHash not in /me"; PASS=$((PASS+1)); fi

echo
echo "=== F. Rate limits ==="
# Sleep so prior throttler windows clear
sleep 1
# Try 12 rapid bad logins, expect some 429s
LOGINS_429=$(for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"email":"admin@acme.test","password":"wrong"}' http://localhost:4000/api/auth/login; done | grep -c 429)
if [ "$LOGINS_429" -gt 0 ]; then echo "  PASS  login rate limit kicked in ($LOGINS_429 of 12 throttled)"; PASS=$((PASS+1))
else echo "  FAIL  login rate limit did not engage"; FAIL=$((FAIL+1)); fi

echo
echo "TOTAL: $PASS passed, $FAIL failed"
