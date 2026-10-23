import { createHash, randomBytes } from "node:crypto";
import type { Badge, Block, EventRecord, LedgerState, Tx, TxType } from "./types";

/**
 * SoulMark ledger: an append-only, hash-chained log that follows the rules of an
 * ERC-5192 soulbound token contract. Every state change is a transaction in its own block;
 * each block commits to the previous block's hash, so editing history breaks verifyChain().
 *
 * Contract surface mirrored here: claim (mint to caller), revoke + reissue (issuer only),
 * hasBadge (public read), locked() is always true, and transfer always reverts.
 */

export class LedgerError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const ZERO_HASH = "0x" + "0".repeat(64);

function sha256(data: string): string {
  return "0x" + createHash("sha256").update(data).digest("hex");
}

function txHash(tx: Omit<Tx, "hash">): string {
  return sha256(JSON.stringify({ type: tx.type, from: tx.from, data: tx.data, timestamp: tx.timestamp }));
}

function blockHash(b: Omit<Block, "hash">): string {
  return sha256(JSON.stringify({ number: b.number, prevHash: b.prevHash, timestamp: b.timestamp, txs: b.txs.map((t) => t.hash) }));
}

export function createLedger(now: Date): LedgerState {
  const genesis: Omit<Block, "hash"> = { number: 0, prevHash: ZERO_HASH, timestamp: now.toISOString(), txs: [] };
  return { blocks: [{ ...genesis, hash: blockHash(genesis) }], events: [], badges: [], usedNonces: {} };
}

function appendTx(state: LedgerState, type: TxType, from: string, data: Record<string, string | number>, now: Date) {
  const base = { type, from, data, timestamp: now.toISOString() };
  const tx: Tx = { ...base, hash: txHash(base) };
  const prev = state.blocks[state.blocks.length - 1];
  const draft: Omit<Block, "hash"> = { number: prev.number + 1, prevHash: prev.hash, timestamp: tx.timestamp, txs: [tx] };
  const block: Block = { ...draft, hash: blockHash(draft) };
  state.blocks.push(block);
  return { tx, block };
}

export interface NewEventInput {
  name: string;
  date: string;
  venue: string;
  description: string;
  claimMinutes: number;
}

export function createEvent(
  state: LedgerState,
  input: NewEventInput,
  issuer: { name: string; address: string },
  now: Date,
): EventRecord {
  const minutes = Math.round(input.claimMinutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 7 * 24 * 60) {
    throw new LedgerError("bad_window", 400, "Claim window must be between 5 minutes and 7 days");
  }
  const event: EventRecord = {
    id: "evt_" + randomBytes(4).toString("hex"),
    name: input.name,
    date: input.date,
    venue: input.venue,
    description: input.description,
    issuer: issuer.name,
    issuerAddress: issuer.address,
    claimStart: now.toISOString(),
    claimEnd: new Date(now.getTime() + minutes * 60_000).toISOString(),
    createdAt: now.toISOString(),
  };
  appendTx(state, "CREATE_EVENT", issuer.address, { eventId: event.id, name: event.name, date: event.date, claimEnd: event.claimEnd }, now);
  state.events.push(event);
  return event;
}

export function getEvent(state: LedgerState, eventId: string): EventRecord | undefined {
  return state.events.find((e) => e.id === eventId);
}

export function isClaimOpen(event: EventRecord, now: Date): boolean {
  const t = now.getTime();
  return t >= Date.parse(event.claimStart) && t <= Date.parse(event.claimEnd);
}

/** hasBadge(wallet, eventId): public read used by the verify page and /api/check. */
export function hasBadge(state: LedgerState, wallet: string, eventId: string): boolean {
  const w = wallet.toLowerCase();
  return state.badges.some((b) => b.owner === w && b.eventId === eventId && !b.revoked);
}

export function badgesOf(state: LedgerState, wallet: string): Badge[] {
  const w = wallet.toLowerCase();
  return state.badges.filter((b) => b.owner === w);
}

function pruneNonces(state: LedgerState, nowMs: number) {
  for (const [nonce, exp] of Object.entries(state.usedNonces)) {
    if (exp < nowMs) delete state.usedNonces[nonce];
  }
}

function mint(state: LedgerState, eventId: string, wallet: string, from: string, now: Date, type: TxType, extra: Record<string, string | number> = {}) {
  const tokenId = state.badges.length + 1;
  const { tx, block } = appendTx(state, type, from, { tokenId, eventId, to: wallet, ...extra }, now);
  const badge: Badge = { tokenId, eventId, owner: wallet, issuedAt: now.toISOString(), txHash: tx.hash, blockNumber: block.number, revoked: false };
  state.badges.push(badge);
  return badge;
}

/**
 * claim(eventId, voucher): mints a badge to the caller.
 * `nonceKey` identifies the single-use voucher (or QR nonce + wallet) and is rejected if seen before.
 */
export function claim(
  state: LedgerState,
  args: { eventId: string; wallet: string; nonceKey: string; nonceExpMs: number },
  now: Date,
): Badge {
  const event = getEvent(state, args.eventId);
  if (!event) throw new LedgerError("event_not_found", 404, "Event not found");
  if (!isClaimOpen(event, now)) throw new LedgerError("claim_closed", 403, "Claiming for this event is closed");
  const wallet = args.wallet.toLowerCase();
  if (hasBadge(state, wallet, event.id)) throw new LedgerError("already_claimed", 409, "You already have this badge");
  // A revoked badge cannot be re-claimed with the live QR; only the issuer can reissue it.
  if (state.badges.some((b) => b.owner === wallet && b.eventId === event.id)) {
    throw new LedgerError("revoked", 403, "Your badge for this event was revoked by the organizer");
  }
  pruneNonces(state, now.getTime());
  if (state.usedNonces[args.nonceKey] !== undefined) throw new LedgerError("code_reused", 409, "This claim code was already used");
  state.usedNonces[args.nonceKey] = args.nonceExpMs;
  return mint(state, event.id, wallet, wallet, now, "CLAIM");
}

function requireIssuer(state: LedgerState, badge: Badge, issuerAddress: string) {
  const event = getEvent(state, badge.eventId);
  if (!event || event.issuerAddress !== issuerAddress) throw new LedgerError("not_issuer", 403, "Only the issuer can do this");
}

/** revoke(tokenId): issuer only. The badge stays in history but no longer verifies. */
export function revoke(state: LedgerState, tokenId: number, issuerAddress: string, now: Date): Badge {
  const badge = state.badges.find((b) => b.tokenId === tokenId);
  if (!badge) throw new LedgerError("token_not_found", 404, "Badge not found");
  requireIssuer(state, badge, issuerAddress);
  if (badge.revoked) throw new LedgerError("already_revoked", 409, "Badge is already revoked");
  appendTx(state, "REVOKE", issuerAddress, { tokenId, eventId: badge.eventId, owner: badge.owner }, now);
  badge.revoked = true;
  badge.revokedAt = now.toISOString();
  return badge;
}

/** reissue(tokenId, newWallet): issuer only, for lost wallets. Revokes the old badge and mints a new one. */
export function reissue(state: LedgerState, tokenId: number, newWallet: string, issuerAddress: string, now: Date): Badge {
  const old = state.badges.find((b) => b.tokenId === tokenId);
  if (!old) throw new LedgerError("token_not_found", 404, "Badge not found");
  requireIssuer(state, old, issuerAddress);
  const wallet = newWallet.toLowerCase();
  if (wallet === old.owner) throw new LedgerError("same_wallet", 400, "New wallet must be different");
  if (old.revoked || state.badges.some((b) => b.reissuedFrom === tokenId)) {
    throw new LedgerError("already_reissued", 409, "This badge was already revoked or reissued");
  }
  if (hasBadge(state, wallet, old.eventId)) throw new LedgerError("already_claimed", 409, "That wallet already has this badge");
  revoke(state, tokenId, issuerAddress, now);
  const badge = mint(state, old.eventId, wallet, issuerAddress, now, "REISSUE", { reissuedFrom: tokenId });
  badge.reissuedFrom = tokenId;
  return badge;
}

/** Soulbound: ERC-5192 locked() is always true for existing tokens and transfers always revert. */
export function locked(state: LedgerState, tokenId: number): boolean {
  if (!state.badges.some((b) => b.tokenId === tokenId)) throw new LedgerError("token_not_found", 404, "Badge not found");
  return true;
}

export function transfer(state: LedgerState, tokenId: number, _to: string): never {
  locked(state, tokenId);
  throw new LedgerError("soulbound", 403, "Badges are soulbound and cannot be transferred");
}

/** Recomputes every tx and block hash and checks each badge is backed by its mint transaction. */
export function verifyChain(state: LedgerState): boolean {
  for (let i = 0; i < state.blocks.length; i++) {
    const b = state.blocks[i];
    const expectedPrev = i === 0 ? ZERO_HASH : state.blocks[i - 1].hash;
    if (b.number !== i || b.prevHash !== expectedPrev) return false;
    for (const tx of b.txs) if (txHash(tx) !== tx.hash) return false;
    if (blockHash(b) !== b.hash) return false;
  }
  // Derived state must match a replay of the transactions (badges, revocations, events).
  const txs = state.blocks.flatMap((b) => b.txs);
  const revokedIds = new Set(txs.filter((t) => t.type === "REVOKE").map((t) => t.data.tokenId));
  for (const badge of state.badges) {
    const block = state.blocks[badge.blockNumber];
    const tx = block?.txs.find((t) => t.hash === badge.txHash);
    if (!tx || tx.data.tokenId !== badge.tokenId || tx.data.to !== badge.owner || tx.data.eventId !== badge.eventId) return false;
    if (badge.revoked !== revokedIds.has(badge.tokenId)) return false;
  }
  for (const event of state.events) {
    const tx = txs.find((t) => t.type === "CREATE_EVENT" && t.data.eventId === event.id);
    if (!tx || tx.from !== event.issuerAddress || tx.data.name !== event.name || tx.data.date !== event.date || tx.data.claimEnd !== event.claimEnd) return false;
  }
  return true;
}
