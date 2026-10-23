import assert from "node:assert/strict";
import { test } from "node:test";
import { badgeArt } from "../lib/art.ts";
import { claim, createEvent, createLedger, hasBadge, LedgerError, locked, reissue, revoke, transfer, verifyChain } from "../lib/ledger.ts";

const ISSUER = { name: "Test Org", address: "0x" + "a".repeat(40) };
const ALICE = "0x" + "1".repeat(40);
const BOB = "0x" + "2".repeat(40);
const T0 = new Date("2026-10-23T10:00:00Z");
const later = (min: number) => new Date(T0.getTime() + min * 60_000);

function setup() {
  const state = createLedger(T0);
  const event = createEvent(state, { name: "Hack Day", date: "2026-10-23", venue: "Lab 1", description: "", claimMinutes: 60 }, ISSUER, T0);
  return { state, event };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof LedgerError, "expected a LedgerError");
    return e.code;
  }
  assert.fail("expected an error");
}

test("claim mints a badge that hasBadge can see", () => {
  const { state, event } = setup();
  const badge = claim(state, { eventId: event.id, wallet: ALICE, nonceKey: "n1", nonceExpMs: later(1).getTime() }, later(1));
  assert.equal(badge.tokenId, 1);
  assert.equal(badge.owner, ALICE);
  assert.equal(hasBadge(state, ALICE, event.id), true);
  assert.equal(hasBadge(state, BOB, event.id), false);
  assert.equal(verifyChain(state), true);
});

test("one badge per wallet per event", () => {
  const { state, event } = setup();
  claim(state, { eventId: event.id, wallet: ALICE, nonceKey: "n1", nonceExpMs: later(5).getTime() }, later(1));
  assert.equal(code(() => claim(state, { eventId: event.id, wallet: ALICE.toUpperCase().replace("0X", "0x"), nonceKey: "n2", nonceExpMs: later(5).getTime() }, later(2))), "already_claimed");
});

test("a used claim code cannot be reused by another wallet", () => {
  const { state, event } = setup();
  claim(state, { eventId: event.id, wallet: ALICE, nonceKey: "voucher:x", nonceExpMs: later(5).getTime() }, later(1));
  assert.equal(code(() => claim(state, { eventId: event.id, wallet: BOB, nonceKey: "voucher:x", nonceExpMs: later(5).getTime() }, later(2))), "code_reused");
});

test("claims outside the claim window are rejected", () => {
  const { state, event } = setup();
  assert.equal(code(() => claim(state, { eventId: event.id, wallet: ALICE, nonceKey: "n", nonceExpMs: 0 }, later(61))), "claim_closed");
  assert.equal(code(() => claim(state, { eventId: "evt_deadbeef", wallet: ALICE, nonceKey: "n", nonceExpMs: 0 }, later(1))), "event_not_found");
});

test("badges are soulbound: locked() is true and transfer always reverts", () => {
  const { state, event } = setup();
  const badge = claim(state, { eventId: event.id, wallet: ALICE, nonceKey: "n1", nonceExpMs: later(5).getTime() }, later(1));
  assert.equal(locked(state, badge.tokenId), true);
  assert.equal(code(() => transfer(state, badge.tokenId, BOB)), "soulbound");
  assert.equal(code(() => locked(state, 999)), "token_not_found");
  assert.equal(state.badges[0].owner, ALICE);
});

test("revoke is issuer-only and removes verification", () => {
  const { state, event } = setup();
  const badge = claim(state, { eventId: event.id, wallet: ALICE, nonceKey: "n1", nonceExpMs: later(5).getTime() }, later(1));
  assert.equal(code(() => revoke(state, badge.tokenId, BOB, later(2))), "not_issuer");
  revoke(state, badge.tokenId, ISSUER.address, later(2));
  assert.equal(hasBadge(state, ALICE, event.id), false);
  assert.equal(code(() => revoke(state, badge.tokenId, ISSUER.address, later(3))), "already_revoked");
  assert.equal(verifyChain(state), true);
});

test("reissue moves the badge to a new wallet and revokes the old one", () => {
  const { state, event } = setup();
  const old = claim(state, { eventId: event.id, wallet: ALICE, nonceKey: "n1", nonceExpMs: later(5).getTime() }, later(1));
  const fresh = reissue(state, old.tokenId, BOB, ISSUER.address, later(2));
  assert.equal(fresh.owner, BOB);
  assert.equal(fresh.reissuedFrom, old.tokenId);
  assert.equal(hasBadge(state, ALICE, event.id), false);
  assert.equal(hasBadge(state, BOB, event.id), true);
  assert.equal(code(() => reissue(state, fresh.tokenId, BOB, ISSUER.address, later(3))), "same_wallet");
  assert.equal(verifyChain(state), true);
});

test("tampering with history breaks verifyChain", () => {
  const { state, event } = setup();
  claim(state, { eventId: event.id, wallet: ALICE, nonceKey: "n1", nonceExpMs: later(5).getTime() }, later(1));
  const copy = structuredClone(state);
  copy.badges[0].owner = BOB; // forge ownership
  assert.equal(verifyChain(copy), false);
  const copy2 = structuredClone(state);
  copy2.blocks[1].txs[0].data.name = "Fake Event"; // rewrite an old transaction
  assert.equal(verifyChain(copy2), false);
});

test("event creation validates the claim window", () => {
  const state = createLedger(T0);
  assert.equal(code(() => createEvent(state, { name: "x", date: "2026-10-23", venue: "", description: "", claimMinutes: 1 }, ISSUER, T0)), "bad_window");
});

test("badge art is deterministic and tied to event + wallet", () => {
  assert.deepEqual(badgeArt("evt_00000001", ALICE), badgeArt("evt_00000001", ALICE));
  assert.notDeepEqual(badgeArt("evt_00000001", ALICE), badgeArt("evt_00000001", BOB));
});
