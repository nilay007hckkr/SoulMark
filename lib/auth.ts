import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Email + 6-digit key sign-in with an embedded wallet (no seed phrase).
 * In demo mode the key is returned to the client because no email is sent.
 */

export interface AuthUser {
  email: string;
  wallet: string;
  handle: string;
  createdAt: string;
}

export interface AuthState {
  users: Record<string, AuthUser>;
  otps: Record<string, { hash: string; exp: number; attempts: number; sentAt: number }>;
  sessions: Record<string, { email: string; exp: number }>;
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_RESEND_MS = 20_000;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export function createAuthState(): AuthState {
  return { users: {}, otps: {}, sessions: {} };
}

export function requestOtp(state: AuthState, email: string, nowMs: number): string {
  const prev = state.otps[email];
  if (prev && nowMs - prev.sentAt < OTP_RESEND_MS) throw new AuthError(429, "Please wait a few seconds before asking for a new key");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  state.otps[email] = { hash: hash(`${email}:${code}`), exp: nowMs + OTP_TTL_MS, attempts: 0, sentAt: nowMs };
  return code;
}

export function verifyOtp(state: AuthState, email: string, code: string, nowMs: number): AuthUser {
  const otp = state.otps[email];
  if (!otp) throw new AuthError(400, "Ask for a new key first");
  if (nowMs > otp.exp) {
    delete state.otps[email];
    throw new AuthError(400, "That key has expired — ask for a new one");
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new AuthError(429, "Too many wrong keys — ask for a new one");
  const a = Buffer.from(otp.hash);
  const b = Buffer.from(hash(`${email}:${code}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    otp.attempts += 1;
    throw new AuthError(401, "Wrong key — check the code and try again");
  }
  delete state.otps[email];
  let user = state.users[email];
  if (!user) {
    const wallet = "0x" + randomBytes(20).toString("hex");
    user = { email, wallet, handle: "SM-" + wallet.slice(2, 8).toUpperCase(), createdAt: new Date(nowMs).toISOString() };
    state.users[email] = user;
  }
  return user;
}

export function createSession(state: AuthState, email: string, nowMs: number): string {
  for (const [k, s] of Object.entries(state.sessions)) if (s.exp < nowMs) delete state.sessions[k];
  const token = randomBytes(32).toString("base64url");
  state.sessions[hash(token)] = { email, exp: nowMs + SESSION_TTL_MS };
  return token;
}

export function sessionUser(state: AuthState, token: string | undefined, nowMs: number): AuthUser | null {
  if (!token || token.length > 100) return null;
  const s = state.sessions[hash(token)];
  if (!s || s.exp < nowMs) return null;
  return state.users[s.email] ?? null;
}

export function endSession(state: AuthState, token: string | undefined) {
  if (token) delete state.sessions[hash(token)];
}
