#!/usr/bin/env bash
# End-to-end smoke test of the main journey against a running server.
# Usage: ORGANIZER_PIN=xxxxxx bash scripts/smoke.sh [base_url]
set -euo pipefail
BASE="${1:-http://localhost:3000}"
PIN="${ORGANIZER_PIN:?set ORGANIZER_PIN}"
JAR="$(mktemp)"
EMAIL="judge$RANDOM@example.com"
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log($1)})"; }

echo "1. pages respond"
for p in / /login /wallet /organizer /scan /explorer /verify; do
  printf '   %-12s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")"
done

echo "2. organizer creates an event"
EVENT=$(curl -s -X POST "$BASE/api/events" -H "content-type: application/json" -H "x-organizer-pin: $PIN" \
  -d '{"name":"Smoke Test Meetup","date":"2026-10-23","venue":"Lab 2","description":"smoke","claimMinutes":60}' | j 'o.event.id')
echo "   event: $EVENT"
echo "   wrong PIN -> $(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/events" -H 'content-type: application/json' -H 'x-organizer-pin: nope' -d '{}')"

echo "3. big screen fetches a rotating QR"
QR=$(curl -s "$BASE/api/events/$EVENT/qr" -H "x-organizer-pin: $PIN")
CLAIM_URL=$(echo "$QR" | j 'o.claimUrl')
TOKEN=$(echo "$QR" | j 'new URL(o.claimUrl).searchParams.get("t")')
echo "   claimUrl: ${CLAIM_URL:0:70}... (svg $(echo "$QR" | j 'o.svg.length') chars, rotates every $(echo "$QR" | j 'o.rotateMs')ms)"

echo "4. attendee scans: QR exchanged for a voucher, redirected to /claim"
echo "   $(curl -s -c "$JAR" -b "$JAR" -o /dev/null -w '%{http_code} -> %{redirect_url}' "$BASE/api/scan?t=$TOKEN" | cut -c1-80)"

echo "5. attendee signs in with email + 6-digit key"
CODE=$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/request" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}" | j 'o.demoCode')
WALLET=$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/verify" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}" | j 'o.wallet')
echo "   key $CODE -> wallet $WALLET"

echo "6. claim the badge"
curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/claim" -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}" | j '"   badge #"+o.badge.tokenId+" for "+o.badge.event.name+" in block "+o.badge.blockNumber+" tx "+o.badge.txHash.slice(0,18)+"..."'
echo "   claim again -> $(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/claim" -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}")"
echo "   forged token -> $(curl -s -b "$JAR" -X POST "$BASE/api/claim" -H 'content-type: application/json' -d '{"token":"abc.def"}')"

echo "7. badge wallet"
curl -s -b "$JAR" "$BASE/api/badges" | j '"   "+o.badges.length+" badge(s): "+o.badges.map(b=>b.event.name).join(", ")'

echo "8. public verify (no login)"
curl -s "$BASE/api/verify/$WALLET" | j '"   verified="+o.verified+" chainValid="+o.chainValid+" badges="+o.badges.length'
curl -s "$BASE/api/check?wallet=$WALLET&event=$EVENT" | j '"   /api/check hasBadge="+o.hasBadge'
echo "   page /verify/$WALLET -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE/verify/$WALLET")"

echo "9. live dashboard count + ledger"
curl -s "$BASE/api/events/$EVENT" | j '"   claimed="+o.event.claimed+" recent="+o.recent.length'
curl -s "$BASE/api/chain" | j '"   ledger height="+o.height+" valid="+o.valid'
rm -f "$JAR"
echo "SMOKE TEST PASSED"
