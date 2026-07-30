#!/usr/bin/env bash
set -e
API="http://localhost:4000/api/platform/auth"

echo "=== Step 1: Login (password) ==="
RESP1=$(curl -s -X POST "$API/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"op1405@plat.test","password":"DemoPass123"}')
echo "$RESP1" | jq .

CODE1=$(echo "$RESP1" | jq -r .code)
if [ "$CODE1" = "MFA_SETUP_REQUIRED" ]; then
  echo "MFA setup required! This user needs to complete MFA enrollment first."
  exit 0
fi

TICKET1=$(echo "$RESP1" | jq -r .ticket)
DEVCODE=$(echo "$RESP1" | jq -r .devCode)
echo ""
echo "Ticket: $TICKET1"
echo "DevCode (email OTP): $DEVCODE"

if [ "$DEVCODE" = "null" ] || [ -z "$DEVCODE" ]; then
  echo "No devCode returned — cannot proceed automatically."
  exit 1
fi

echo ""
echo "=== Step 2: Email OTP ==="
RESP2=$(curl -s -X POST "$API/login/mfa/email" \
  -H "Content-Type: application/json" \
  -d "{\"ticket\":\"$TICKET1\",\"code\":\"$DEVCODE\"}")
echo "$RESP2" | jq .

CODE2=$(echo "$RESP2" | jq -r .code)
TICKET2=$(echo "$RESP2" | jq -r .ticket)
echo ""
echo "Next code: $CODE2"
echo "Next ticket: $TICKET2"

if [ "$CODE2" != "TOTP_REQUIRED" ]; then
  echo "Did not get TOTP_REQUIRED — something failed at the email step."
  exit 1
fi

echo ""
echo "=== Step 3: TOTP ==="
# Generate TOTP code using Node.js (same machine, same time)
TOTP=$(node -e '
const crypto = require("crypto");
const { authenticator } = require("otplib");
const encKey = "d517188cd469e3d2752affc572940dc08346b8b58c068111aec4e152707f60eb";
const key = crypto.createHash("sha256").update(encKey).digest();
const payload = "v1:0DGQrm7mGlHwoREv:lpkO0yU/gjI735xnCJG0NQ==:clmYsuQs+AEaI1kOHCtpAw==";
const parts = payload.split(":");
const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64"));
decipher.setAuthTag(Buffer.from(parts[2], "base64"));
const plain = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
console.log(authenticator.generate(plain));
')
echo "TOTP code: $TOTP"

RESP3=$(curl -s -X POST "$API/login/mfa/totp" \
  -H "Content-Type: application/json" \
  -d "{\"ticket\":\"$TICKET2\",\"code\":\"$TOTP\"}")
echo "$RESP3" | jq .
echo ""
echo "=== DONE ==="
