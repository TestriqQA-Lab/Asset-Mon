#!/usr/bin/env bash
# First, authenticate to start the chain
RESP=$(curl -s -X POST "http://localhost:4000/api/platform/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"op1405@plat.test","password":"DemoPass123"}')

TICKET=$(echo $RESP | jq -r .ticket)
if [ "$TICKET" == "null" ]; then
  echo "Login failed: $RESP"
  exit 1
fi

echo "Got ticket: $TICKET"

# Generate TOTP via JS
CODE=$(node simulate.js | grep "Generated code:" | awk '{print $3}')
echo "Generated code: $CODE"

# The step 2 requires EMAIL OTP. But wait, what if the user is stuck at step 2?
# The user's row is at stage='TOTP'. This means they ALREADY passed the EMAIL OTP step!
# How did they pass the EMAIL OTP step? They must have extracted the email OTP code from the logs or devCode!
# Or maybe I should just hit the TOTP endpoint with the current ticket! Wait, I just created a NEW chain.
# The new chain is at stage='EMAIL'.
