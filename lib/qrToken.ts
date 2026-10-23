import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Rotating QR proof-of-presence.
 * The organizer screen shows a QR whose claim URL carries an HMAC-signed payload
 * {e: eventId, iat, exp, n: nonce}. It expires a few seconds after the screen rotates it,
 * so a screenshot sent to someone outside the room stops working almost immediately.
 * Opening a fresh QR link exchanges it for a short-lived, single-use claim voucher
 * (stored in an httpOnly cookie) so first-time users have time to sign in.
 */

export interface ClaimPayload {
  e: string; // event id
  iat: number; // issued at (ms)
  exp: number; // expires at (ms)
  n: string; // nonce
}

export interface VoucherPayload {
  v: 1;
  id: string; // voucher id, single use
  e: string; // event id
  n: string; // nonce of the QR it came from
  exp: number; // ms
}

export type TokenCheck =
  | { ok: true; payload: ClaimPayload }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "expired"; payload: ClaimPayload };

export const QR_ROTATE_MS = 20_000;
export const QR_GRACE_MS = 10_000;
export const VOUCHER_TTL_MS = 10 * 60_000;
const MAX_TOKEN_LENGTH = 600;

function hmac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signPayload(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

/** Returns the decoded payload only if the signature matches; null otherwise. */
export function openPayload(token: unknown, secret: string): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(hmac(parts[0], secret));
  const given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function issueClaimToken(eventId: string, secret: string, nowMs: number, ttlMs = QR_ROTATE_MS + QR_GRACE_MS) {
  const payload: ClaimPayload = { e: eventId, iat: nowMs, exp: nowMs + ttlMs, n: randomBytes(8).toString("hex") };
  return { token: signPayload(payload, secret), payload };
}

export function verifyClaimToken(token: unknown, secret: string, nowMs: number): TokenCheck {
  const p = openPayload(token, secret);
  if (!p || typeof p.e !== "string" || typeof p.iat !== "number" || typeof p.exp !== "number" || typeof p.n !== "string") {
    return { ok: false, reason: "invalid" };
  }
  const payload: ClaimPayload = { e: p.e, iat: p.iat, exp: p.exp, n: p.n };
  if (nowMs > payload.exp) return { ok: false, reason: "expired", payload };
  return { ok: true, payload };
}

export function issueVoucher(claim: ClaimPayload, secret: string, nowMs: number, ttlMs = VOUCHER_TTL_MS) {
  const payload: VoucherPayload = { v: 1, id: randomBytes(9).toString("hex"), e: claim.e, n: claim.n, exp: nowMs + ttlMs };
  return { voucher: signPayload(payload, secret), payload };
}

export function verifyVoucher(voucher: unknown, secret: string, nowMs: number): VoucherPayload | null {
  const p = openPayload(voucher, secret);
  if (!p || p.v !== 1 || typeof p.id !== "string" || typeof p.e !== "string" || typeof p.n !== "string" || typeof p.exp !== "number") {
    return null;
  }
  if (nowMs > p.exp) return null;
  return { v: 1, id: p.id, e: p.e, n: p.n, exp: p.exp };
}
