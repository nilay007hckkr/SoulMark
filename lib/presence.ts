import { randomBytes } from "node:crypto";

/**
 * Proxy-attendance detection (off-chain audit data, kept in data/presence.json).
 *
 * Every QR scan is recorded against the phone that made it (sm_device cookie). The redirect after a scan
 * carries that scan's id, so the claim link is personal: if it is forwarded and opened on another phone,
 * we know exactly whose scan it was, which identifies the person who shared it. A phone that tries to
 * claim the same event for a second account is the classic proxy marker, and that claim is blocked.
 */

export interface ScanRecord {
  id: string;
  eventId: string;
  nonce: string;
  deviceId: string;
  ip: string;
  at: number; // ms
}

export interface ClaimRecord {
  tokenId: number;
  eventId: string;
  wallet: string;
  deviceId: string;
  ip: string;
  at: number;
  scanId: string | null;
  scanDeviceId: string | null;
  scanAt: number | null;
  distanceM: number | null;
}

export interface BlockedRecord {
  eventId: string;
  at: number;
  reason: string;
  wallet: string | null;
  deviceId: string;
  ip: string;
  deviceOwnerWallet: string | null;
  distanceM: number | null;
}

export interface PresenceState {
  scans: ScanRecord[];
  claims: ClaimRecord[];
  blocked: BlockedRecord[];
}

export interface Assessment {
  risk: number; // 0-100
  level: "ok" | "watch" | "high";
  reasons: string[];
  sharerDeviceId: string | null;
}

const MAX_SCANS = 5_000;
const MAX_BLOCKED = 1_000;
export const SLOW_CLAIM_MS = 120_000;
export const REPEATED_SCANS = 4;

export function createPresence(): PresenceState {
  return { scans: [], claims: [], blocked: [] };
}

export function newDeviceId(): string {
  return randomBytes(16).toString("hex");
}

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export function recordScan(state: PresenceState, scan: Omit<ScanRecord, "id">): ScanRecord {
  const rec: ScanRecord = { id: randomBytes(9).toString("hex"), ...scan };
  state.scans.push(rec);
  if (state.scans.length > MAX_SCANS) state.scans.splice(0, state.scans.length - MAX_SCANS);
  return rec;
}

/** The scan behind a claim: the one named in the claim link, or this phone's own scan of the same QR. */
export function findScan(state: PresenceState, args: { scanId?: unknown; nonce: string; deviceId: string }): ScanRecord | null {
  if (typeof args.scanId === "string" && args.scanId) {
    const byId = state.scans.find((s) => s.id === args.scanId && s.nonce === args.nonce);
    if (byId) return byId;
  }
  for (let i = state.scans.length - 1; i >= 0; i--) {
    const s = state.scans[i];
    if (s.nonce === args.nonce && s.deviceId === args.deviceId) return s;
  }
  return null;
}

/** Another account already claimed this event from this phone: the proxy-marking pattern. */
export function deviceConflict(state: PresenceState, eventId: string, deviceId: string, wallet: string): ClaimRecord | null {
  return state.claims.find((c) => c.eventId === eventId && c.deviceId === deviceId && c.wallet !== wallet) ?? null;
}

export function recordClaim(state: PresenceState, claim: ClaimRecord) {
  state.claims.push(claim);
}

export function recordBlocked(state: PresenceState, blocked: BlockedRecord) {
  state.blocked.push(blocked);
  if (state.blocked.length > MAX_BLOCKED) state.blocked.splice(0, state.blocked.length - MAX_BLOCKED);
}

/** Most common client IP among an event's claims: the room's network (needs 3+ claims to be meaningful). */
export function roomNetwork(claims: ClaimRecord[]): string | null {
  if (claims.length < 3) return null;
  const counts = new Map<string, number>();
  for (const c of claims) counts.set(c.ip, (counts.get(c.ip) ?? 0) + 1);
  let best: string | null = null;
  let max = 0;
  for (const [ip, n] of counts) if (n > max) [best, max] = [ip, n];
  return max >= 2 ? best : null;
}

/** Risk score for one claim. Soft signals only; hard cases (outside geofence, second account on one phone) are blocked earlier. */
export function assessClaim(state: PresenceState, claim: ClaimRecord): Assessment {
  const reasons: string[] = [];
  let risk = 0;
  let sharerDeviceId: string | null = null;
  if (claim.scanDeviceId && claim.scanDeviceId !== claim.deviceId) {
    risk += 60;
    sharerDeviceId = claim.scanDeviceId;
    reasons.push("Claim link was scanned on another phone and forwarded");
  } else if (!claim.scanId) {
    risk += 35;
    reasons.push("Claimed without scanning the QR on this phone");
  }
  const eventClaims = state.claims.filter((c) => c.eventId === claim.eventId);
  const room = roomNetwork(eventClaims);
  if (room && claim.ip !== room) {
    risk += 25;
    reasons.push("Different network from the room");
  }
  if (claim.scanAt !== null && claim.at - claim.scanAt > SLOW_CLAIM_MS) {
    risk += 10;
    reasons.push(`Slow claim (${Math.round((claim.at - claim.scanAt) / 1000)}s after scan)`);
  }
  const scans = state.scans.filter((s) => s.eventId === claim.eventId && s.deviceId === claim.deviceId).length;
  if (scans >= REPEATED_SCANS) {
    risk += 15;
    reasons.push(`This phone scanned the QR ${scans} times (possible sharing)`);
  }
  risk = Math.min(100, risk);
  return { risk, level: risk >= 60 ? "high" : risk >= 25 ? "watch" : "ok", reasons, sharerDeviceId };
}

/** Early warning: phones that keep scanning the QR without claiming are likely capturing it to share. */
export function heavyScanners(state: PresenceState, eventId: string): { deviceId: string; scans: number }[] {
  const counts = new Map<string, number>();
  for (const s of state.scans) if (s.eventId === eventId) counts.set(s.deviceId, (counts.get(s.deviceId) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= REPEATED_SCANS).map(([deviceId, scans]) => ({ deviceId, scans }));
}

/** Median and p90 of scan-to-claim time in seconds, plus how many took over 10 s (success criterion: < 10 s). */
export function claimTimeStats(claims: ClaimRecord[]) {
  const secs = claims.filter((c) => c.scanAt !== null && c.scanDeviceId === c.deviceId).map((c) => (c.at - (c.scanAt as number)) / 1000).sort((a, b) => a - b);
  const pick = (q: number) => (secs.length ? Math.round(secs[Math.min(secs.length - 1, Math.floor(q * secs.length))] * 10) / 10 : null);
  return { medianClaimSec: pick(0.5), p90ClaimSec: pick(0.9), over10s: secs.filter((s) => s > 10).length };
}
