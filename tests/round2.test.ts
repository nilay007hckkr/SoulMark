import assert from "node:assert/strict";
import { test } from "node:test";
import { checkGeofence, haversineMeters, parseGeoPoint } from "../lib/geo.ts";
import { claim, createEvent, createLedger, LedgerError, setGeofence, verifyChain } from "../lib/ledger.ts";
import { assessClaim, claimTimeStats, createPresence, deviceConflict, findScan, heavyScanners, recordClaim, recordScan, type ClaimRecord } from "../lib/presence.ts";
import { allowHit } from "../lib/rateLimit.ts";
import { stampLabel } from "../lib/stamp.ts";

// Graphic Era main gate area (approx.) and points ~40 m and ~1.1 km away.
const ROOM = { lat: 30.2688, lng: 77.9938 };
const NEAR = { lat: 30.26915, lng: 77.9939 };
const FAR = { lat: 30.2788, lng: 77.9938 };
const FENCE = { enabled: true, ...ROOM, radiusM: 100 };

test("geofence: haversine distance is sane", () => {
  const d = haversineMeters(ROOM, FAR);
  assert.ok(d > 1050 && d < 1150, `expected ~1.1 km, got ${d}`);
});

test("geofence: inside passes, outside is rejected, missing location fails closed", () => {
  assert.equal(checkGeofence(FENCE, { ...NEAR, accuracy: 10 }).ok, true);
  const out = checkGeofence(FENCE, { ...FAR, accuracy: 10 });
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.reason, "outside");
  const none = checkGeofence(FENCE, null);
  assert.equal(!none.ok && none.reason, "no_location");
});

test("geofence: GPS accuracy is forgiven only up to 100 m", () => {
  const edge = { lat: ROOM.lat + 0.0015, lng: ROOM.lng }; // ~167 m away
  assert.equal(checkGeofence(FENCE, { ...edge, accuracy: 80 }).ok, true);
  assert.equal(checkGeofence(FENCE, { ...edge, accuracy: 0 }).ok, false);
  const farther = { lat: ROOM.lat + 0.00225, lng: ROOM.lng }; // ~250 m away
  assert.equal(checkGeofence(FENCE, { ...farther, accuracy: 5000 }).ok, false); // huge accuracy can't stretch past radius + 100 m
});

test("geofence: disabled or absent fences always pass; bad input is rejected", () => {
  assert.equal(checkGeofence({ ...FENCE, enabled: false }, null).ok, true);
  assert.equal(checkGeofence(null, null).ok, true);
  assert.equal(parseGeoPoint({ lat: 91, lng: 0 }), null);
  assert.equal(parseGeoPoint({ lat: "30", lng: 77 }), null);
  assert.deepEqual(parseGeoPoint({ lat: 30, lng: 77, accuracy: -5 }), { lat: 30, lng: 77, accuracy: undefined });
});

test("setGeofence is issuer-only, validated and recorded in the chain", () => {
  const T0 = new Date("2026-10-23T10:00:00Z");
  const issuer = { name: "Org", address: "0x" + "a".repeat(40) };
  const state = createLedger(T0);
  const ev = createEvent(state, { name: "Class", date: "2026-10-23", venue: "", description: "", claimMinutes: 60 }, issuer, T0);
  assert.throws(() => setGeofence(state, ev.id, FENCE, "0x" + "b".repeat(40), T0), LedgerError);
  assert.throws(() => setGeofence(state, ev.id, { ...FENCE, radiusM: 2 }, issuer.address, T0), LedgerError);
  setGeofence(state, ev.id, FENCE, issuer.address, T0);
  assert.equal(state.events[0].geofence?.radiusM, 100);
  assert.equal(state.blocks.at(-1)?.txs[0].type, "SET_GEOFENCE");
  assert.equal(verifyChain(state), true);
  claim(state, { eventId: ev.id, wallet: "0x" + "1".repeat(40), nonceKey: "n", nonceExpMs: T0.getTime() + 1e6 }, new Date(T0.getTime() + 1000));
  assert.equal(verifyChain(state), true);
});

const W1 = "0x" + "1".repeat(40);
const W2 = "0x" + "2".repeat(40);
const A = "a".repeat(32); // phone A
const B = "b".repeat(32); // phone B
function claimRec(over: Partial<ClaimRecord>): ClaimRecord {
  return { tokenId: 1, eventId: "evt_00000001", wallet: W1, deviceId: A, ip: "10.0.0.5", at: 10_000, scanId: null, scanDeviceId: null, scanAt: null, distanceM: null, ...over };
}

test("proxy: a forwarded claim link names the phone that shared it", () => {
  const p = createPresence();
  const scan = recordScan(p, { eventId: "evt_00000001", nonce: "n1", deviceId: A, ip: "10.0.0.5", at: 1000 });
  // Phone B opens phone A's personal claim link.
  const found = findScan(p, { scanId: scan.id, nonce: "n1", deviceId: B });
  assert.equal(found?.deviceId, A);
  const rec = claimRec({ wallet: W2, deviceId: B, scanId: scan.id, scanDeviceId: A, scanAt: 1000, ip: "100.64.1.9" });
  const a = assessClaim(p, rec);
  assert.equal(a.sharerDeviceId, A);
  assert.equal(a.level, "high");
  assert.ok(a.reasons.some((r) => r.includes("forwarded")));
});

test("proxy: a scan id from another QR window is ignored", () => {
  const p = createPresence();
  const scan = recordScan(p, { eventId: "evt_00000001", nonce: "n1", deviceId: A, ip: "x", at: 1 });
  assert.equal(findScan(p, { scanId: scan.id, nonce: "other", deviceId: B }), null);
});

test("proxy: an honest in-room claim scores ok", () => {
  const p = createPresence();
  const scan = recordScan(p, { eventId: "evt_00000001", nonce: "n1", deviceId: A, ip: "10.0.0.5", at: 1000 });
  const a = assessClaim(p, claimRec({ scanId: scan.id, scanDeviceId: A, scanAt: 1000, at: 6000 }));
  assert.equal(a.level, "ok");
  assert.equal(a.risk, 0);
});

test("proxy: one phone claiming for a second account is detected (the proxy marker)", () => {
  const p = createPresence();
  recordClaim(p, claimRec({ wallet: W1, deviceId: A }));
  assert.equal(deviceConflict(p, "evt_00000001", A, W2)?.wallet, W1);
  assert.equal(deviceConflict(p, "evt_00000001", A, W1), null); // same person again is not a proxy
  assert.equal(deviceConflict(p, "evt_00000002", A, W2), null); // other events are fine
});

test("proxy: early warning for phones that keep scanning; claim-time stats", () => {
  const p = createPresence();
  for (let i = 0; i < 5; i++) recordScan(p, { eventId: "evt_00000001", nonce: `n${i}`, deviceId: B, ip: "x", at: i });
  assert.deepEqual(heavyScanners(p, "evt_00000001"), [{ deviceId: B, scans: 5 }]);
  const stats = claimTimeStats([
    claimRec({ scanAt: 0, at: 4000, scanDeviceId: A }),
    claimRec({ scanAt: 0, at: 6000, scanDeviceId: A }),
    claimRec({ scanAt: 0, at: 15000, scanDeviceId: A }),
  ]);
  assert.equal(stats.medianClaimSec, 6);
  assert.equal(stats.over10s, 1);
});

test("rate limit: 6th request in the window is refused, then the window resets", () => {
  const m = new Map();
  for (let i = 0; i < 5; i++) assert.equal(allowHit(m, "ip", 1000 + i, 5, 60_000), true);
  assert.equal(allowHit(m, "ip", 2000, 5, 60_000), false);
  assert.equal(allowHit(m, "other-ip", 2000, 5, 60_000), true);
  assert.equal(allowHit(m, "ip", 70_000, 5, 60_000), true);
});

test("verify stamp never says on-chain without a confirmed chain transaction", () => {
  assert.equal(stampLabel({ verified: true }).onChain, false);
  assert.ok(!/on-chain/i.test(stampLabel({ verified: true }).title));
  assert.ok(!/on-chain/i.test(stampLabel({ verified: false }).title));
  assert.equal(stampLabel({ verified: true, chainTxHash: "0xabc" }).onChain, true);
});
