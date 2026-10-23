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

echo "10. issuer revokes the badge"
TOKEN_ID=$(curl -s "$BASE/api/events/$EVENT" | j 'o.recent[0].tokenId')
curl -s -X POST "$BASE/api/badges/$TOKEN_ID/revoke" -H "x-organizer-pin: $PIN" | j '"   badge #"+o.badge.tokenId+" revoked="+o.badge.revoked'
curl -s "$BASE/api/verify/$WALLET" | j '"   verify after revoke: verified="+o.verified'
echo "   re-claim after revoke -> $(curl -s -b "$JAR" -X POST "$BASE/api/claim" -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}")"
curl -s "$BASE/api/chain" | j '"   ledger height="+o.height+" valid="+o.valid'
rm -f "$JAR"

echo "11. Round 2: geofence set from the organizer dashboard (100 m around the room)"
EV2=$(curl -s -X POST "$BASE/api/events" -H "content-type: application/json" -H "x-organizer-pin: $PIN" \
  -d '{"name":"Geofenced Lecture","date":"2026-10-23","venue":"Room 101","description":"r2","claimMinutes":60}' | j 'o.event.id')
curl -s -X POST "$BASE/api/events/$EV2/geofence" -H "content-type: application/json" -H "x-organizer-pin: $PIN" \
  -d '{"enabled":true,"lat":30.2688,"lng":77.9938,"radiusM":100}' | j '"   geofence: "+JSON.stringify(o.event.geofence)'
PA="$(mktemp)"; PB="$(mktemp)"
signin() { local c; c=$(curl -s -c "$1" -b "$1" -X POST "$BASE/api/auth/request" -H 'content-type: application/json' -d "{\"email\":\"$2\"}" | j 'o.demoCode');
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/auth/verify" -H 'content-type: application/json' -d "{\"email\":\"$2\",\"code\":\"$c\"}" | j 'o.wallet'; }
claimw() { curl -s -c "$1" -b "$1" -X POST "$BASE/api/claim" -H 'content-type: application/json' -d "$2"; }
T2=$(curl -s "$BASE/api/events/$EV2/qr" -H "x-organizer-pin: $PIN" | j 'new URL(o.claimUrl).searchParams.get("t")')
SCAN_A=$(curl -s -c "$PA" -b "$PA" -o /dev/null -w '%{redirect_url}' "$BASE/api/scan?t=$T2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(new URL(s).searchParams.get('s')))")
echo "   phone A scanned the QR, personal claim link s=$SCAN_A"
signin "$PA" "alice$RANDOM@example.com" >/dev/null
echo "   A claims without location -> $(claimw "$PA" "{\"token\":\"$T2\",\"scanId\":\"$SCAN_A\"}" | cut -c1-90)"
echo "   A claims from 1.1 km away -> $(claimw "$PA" "{\"token\":\"$T2\",\"scanId\":\"$SCAN_A\",\"location\":{\"lat\":30.2788,\"lng\":77.9938,\"accuracy\":10}}")"
echo "   A claims inside the room   -> $(claimw "$PA" "{\"token\":\"$T2\",\"scanId\":\"$SCAN_A\",\"location\":{\"lat\":30.26885,\"lng\":77.99385,\"accuracy\":15}}" | j '"badge #"+o.badge.tokenId')"

echo "12. Round 2: A forwards the claim link to B (another phone) -> B is flagged and A is named as the sharer"
signin "$PB" "bob$RANDOM@example.com" >/dev/null
echo "   B claims with A's link -> $(claimw "$PB" "{\"token\":\"$T2\",\"scanId\":\"$SCAN_A\",\"location\":{\"lat\":30.26885,\"lng\":77.99385,\"accuracy\":15}}" | j 'o.badge ? "badge #"+o.badge.tokenId+" (allowed, flagged)" : JSON.stringify(o)')"

echo "13. Round 2: A tries to mark proxy for Carol from A's own phone -> blocked"
signin "$PA" "carol$RANDOM@example.com" >/dev/null
echo "   -> $(claimw "$PA" "{\"token\":\"$T2\",\"scanId\":\"$SCAN_A\",\"location\":{\"lat\":30.26885,\"lng\":77.99385,\"accuracy\":15}}")"

echo "14. Round 2: organizer proxy watch"
curl -s "$BASE/api/events/$EV2/integrity" -H "x-organizer-pin: $PIN" | j '"   stats "+JSON.stringify(o.stats)+"\n   flagged: "+o.claims.filter(c=>c.level!=="ok").map(c=>c.person.handle+" risk "+c.risk+" shared by "+(c.sharer&&c.sharer.handle)).join("; ")+"\n   blocked: "+o.blocked.map(b=>b.reason.slice(0,40)+"… tried by "+(b.attemptedBy&&b.attemptedBy.handle)+" on phone of "+(b.deviceOwner&&b.deviceOwner.handle)).join("; ")'
curl -s "$BASE/api/check?wallet=0x0000000000000000000000000000000000000001&event=$EV2" | j '"   /api/check onChain="+o.onChain+" status="+o.status'
rm -f "$PA" "$PB"
echo "SMOKE TEST PASSED"
