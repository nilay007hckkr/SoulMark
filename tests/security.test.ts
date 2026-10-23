import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthError, createAuthState, createSession, endSession, OTP_MAX_ATTEMPTS, requestOtp, sessionUser, verifyOtp } from "../lib/auth.ts";
import { issueClaimToken, issueVoucher, signPayload, verifyClaimToken, verifyVoucher } from "../lib/qrToken.ts";
import { cleanText, isIsoDate, normalizeAddress, normalizeEmail, safeNext } from "../lib/validate.ts";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

test("fresh QR tokens verify; expired ones are flagged", () => {
  const { token, payload } = issueClaimToken("evt_12345678", SECRET, NOW);
  const ok = verifyClaimToken(token, SECRET, NOW + 5_000);
  assert.equal(ok.ok, true);
  const late = verifyClaimToken(token, SECRET, payload.exp + 1);
  assert.equal(late.ok, false);
  assert.equal(!late.ok && late.reason, "expired");
});

test("forged or tampered QR tokens are rejected", () => {
  const { token } = issueClaimToken("evt_12345678", SECRET, NOW);
  assert.equal(verifyClaimToken(token, "other-secret", NOW).ok, false);
  const [body, sig] = token.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ e: "evt_99999999", iat: NOW, exp: NOW + 1e9, n: "x" })).toString("base64url");
  assert.equal(verifyClaimToken(`${forgedBody}.${sig}`, SECRET, NOW).ok, false);
  assert.equal(verifyClaimToken(`${body}.`, SECRET, NOW).ok, false);
  assert.equal(verifyClaimToken("garbage", SECRET, NOW).ok, false);
  assert.equal(verifyClaimToken("a".repeat(5000), SECRET, NOW).ok, false);
  assert.equal(verifyClaimToken(signPayload({ e: 1 }, SECRET), SECRET, NOW).ok, false);
});

test("vouchers bind to the QR nonce and expire", () => {
  const { payload } = issueClaimToken("evt_12345678", SECRET, NOW);
  const { voucher } = issueVoucher(payload, SECRET, NOW, 60_000);
  const v = verifyVoucher(voucher, SECRET, NOW + 30_000);
  assert.ok(v);
  assert.equal(v.n, payload.n);
  assert.equal(verifyVoucher(voucher, SECRET, NOW + 61_000), null);
  assert.equal(verifyVoucher(voucher, "other-secret", NOW), null);
});

test("OTP: correct key signs in and creates a stable wallet", () => {
  const s = createAuthState();
  const codeA = requestOtp(s, "a@x.io", NOW);
  assert.match(codeA, /^\d{6}$/);
  const user = verifyOtp(s, "a@x.io", codeA, NOW + 1000);
  assert.match(user.wallet, /^0x[0-9a-f]{40}$/);
  assert.match(user.handle, /^SM-[0-9A-F]{6}$/);
  const codeB = requestOtp(s, "a@x.io", NOW + 60_000);
  assert.equal(verifyOtp(s, "a@x.io", codeB, NOW + 61_000).wallet, user.wallet);
});

test("OTP: wrong keys are limited, keys are single-use and expire", () => {
  const s = createAuthState();
  const code = requestOtp(s, "b@x.io", NOW);
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) assert.throws(() => verifyOtp(s, "b@x.io", wrong, NOW), (e: unknown) => e instanceof AuthError && e.status === 401);
  assert.throws(() => verifyOtp(s, "b@x.io", code, NOW), (e: unknown) => e instanceof AuthError && e.status === 429);
  const s2 = createAuthState();
  const c2 = requestOtp(s2, "c@x.io", NOW);
  verifyOtp(s2, "c@x.io", c2, NOW);
  assert.throws(() => verifyOtp(s2, "c@x.io", c2, NOW), AuthError); // single use
  const c3 = requestOtp(s2, "c@x.io", NOW + 60_000);
  assert.throws(() => verifyOtp(s2, "c@x.io", c3, NOW + 60_000 + 6 * 60_000), AuthError); // expired
});

test("OTP resend is rate limited", () => {
  const s = createAuthState();
  requestOtp(s, "d@x.io", NOW);
  assert.throws(() => requestOtp(s, "d@x.io", NOW + 5_000), (e: unknown) => e instanceof AuthError && e.status === 429);
});

test("sessions resolve to the user and end on logout", () => {
  const s = createAuthState();
  const user = verifyOtp(s, "e@x.io", requestOtp(s, "e@x.io", NOW), NOW);
  const token = createSession(s, "e@x.io", NOW);
  assert.equal(sessionUser(s, token, NOW + 1000)?.wallet, user.wallet);
  assert.equal(sessionUser(s, "not-a-session", NOW), null);
  endSession(s, token);
  assert.equal(sessionUser(s, token, NOW + 2000), null);
});

test("input validation", () => {
  assert.equal(normalizeEmail("  Nilay@Example.COM "), "nilay@example.com");
  assert.equal(normalizeEmail("no-at-sign"), null);
  assert.equal(normalizeEmail("<script>@x.io"), null);
  assert.equal(normalizeAddress("0x" + "A".repeat(40)), "0x" + "a".repeat(40));
  assert.equal(normalizeAddress("0x123"), null);
  assert.equal(cleanText("  hi\u0000there  ", 20), "hi there");
  assert.equal(cleanText("x".repeat(81), 80), null);
  assert.equal(cleanText("", 80, { required: true }), null);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-10-23"), true);
  assert.equal(safeNext("/claim?t=abc"), "/claim?t=abc");
  assert.equal(safeNext("//evil.com"), "/wallet");
  assert.equal(safeNext("/\\evil.com"), "/wallet");
  assert.equal(safeNext("https://evil.com"), "/wallet");
});
