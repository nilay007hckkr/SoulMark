import { createHash, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";
import { badgeArt } from "./art";
import { AuthError, sessionUser, type AuthUser } from "./auth";
import { getEvent, LedgerError } from "./ledger";
import { isDeviceId, newDeviceId } from "./presence";
import { loadAuth, secrets } from "./store";
import type { Badge, LedgerState } from "./types";

export const SESSION_COOKIE = "sm_session";
export const VOUCHER_COOKIE = "sm_voucher";

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function fail(status: number, error: string) {
  return json({ error }, status);
}

/** Maps known domain errors to clean JSON responses; anything else is a 500 without internals. */
export function handleError(e: unknown) {
  if (e instanceof LedgerError || e instanceof AuthError) return fail(e.status, e.message);
  console.error("[soulmark] unexpected error", e);
  return fail(500, "Something went wrong — please try again");
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length") ?? 0) > 10_000) throw new LedgerError("too_large", 413, "Request body too large");
  const text = await req.text();
  if (text.length > 10_000) throw new LedgerError("too_large", 413, "Request body too large");
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new LedgerError("bad_json", 400, "Request body must be a JSON object");
}

export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function currentUser(req: Request): AuthUser | null {
  return sessionUser(loadAuth(), getCookie(req, SESSION_COOKIE), Date.now());
}

// Brute-force guard for the organizer PIN: after 10 wrong PINs from one client within 10 minutes,
// every PIN check from that client fails for 10 minutes. Kept on globalThis so all route bundles share it.
const PIN_MAX_FAILS = 10;
const PIN_GLOBAL_MAX_FAILS = 50;
const PIN_WINDOW_MS = 10 * 60_000;
const GLOBAL_KEY = "__all__";
const pinFails: Map<string, { count: number; since: number }> =
  ((globalThis as Record<string, unknown>).__smPinFails as Map<string, { count: number; since: number }>) ?? new Map();
(globalThis as Record<string, unknown>).__smPinFails = pinFails;

/**
 * Best-effort client IP. `next start` only fills X-Forwarded-For with the socket peer when the header is
 * missing, so without a proxy in front a client can forge it. Per-IP limits are therefore backed by
 * global ceilings (see pinMatches and the sign-in route), and the "different network" signal is soft.
 * With TRUST_PROXY=true (behind a tunnel) we use CF-Connecting-IP or the entry the proxy added.
 */
export function clientIp(req: Request): string {
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.TRUST_PROXY === "true") {
    const cf = req.headers.get("cf-connecting-ip")?.trim();
    if (cf) return cf.slice(0, 64);
    if (xff.length >= 2) return xff[xff.length - 2].slice(0, 64);
  }
  return (xff[xff.length - 1] ?? "local").slice(0, 64);
}

function clientKey(req: Request): string {
  return clientIp(req);
}

/** Secure cookies whenever the app is served over HTTPS (directly or via a proxy/tunnel). */
export function cookieSecure(req: Request): boolean {
  return (process.env.PUBLIC_BASE_URL ?? "").startsWith("https://") || req.headers.get("x-forwarded-proto") === "https";
}

export const DEVICE_COOKIE = "sm_device";

/** Random per-phone id (httpOnly cookie, 1 year). Clearing cookies resets it, so it stops casual proxying, not a determined attacker. */
export function deviceFor(req: Request): { id: string; isNew: boolean } {
  const existing = getCookie(req, DEVICE_COOKIE);
  return isDeviceId(existing) ? { id: existing, isNew: false } : { id: newDeviceId(), isNew: true };
}

export function setDeviceCookie(res: NextResponse, req: Request, device: { id: string; isNew: boolean }) {
  if (device.isNew) {
    res.cookies.set(DEVICE_COOKIE, device.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 3600, secure: cookieSecure(req) });
  }
}

/** Constant-time PIN comparison (hash both sides so lengths match), rate limited per client. */
export function pinMatches(given: unknown, client = "local"): boolean {
  const now = Date.now();
  for (const key of [client, GLOBAL_KEY]) {
    const rec = pinFails.get(key);
    if (rec && now - rec.since > PIN_WINDOW_MS) pinFails.delete(key);
  }
  if ((pinFails.get(client)?.count ?? 0) >= PIN_MAX_FAILS) return false;
  // Global ceiling: forged X-Forwarded-For values can't buy unlimited guesses.
  if ((pinFails.get(GLOBAL_KEY)?.count ?? 0) >= PIN_GLOBAL_MAX_FAILS) return false;
  let ok = false;
  if (typeof given === "string" && given && given.length <= 64) {
    const a = createHash("sha256").update(given).digest();
    const b = createHash("sha256").update(secrets().organizerPin).digest();
    ok = timingSafeEqual(a, b);
  }
  if (!ok && given) {
    for (const key of [client, GLOBAL_KEY]) {
      const cur = pinFails.get(key) ?? { count: 0, since: now };
      cur.count += 1;
      pinFails.set(key, cur);
    }
  }
  return ok;
}

export function isOrganizer(req: Request): boolean {
  return pinMatches(req.headers.get("x-organizer-pin"), clientKey(req));
}

export function organizerLocked(req: Request): boolean {
  return (pinFails.get(clientKey(req))?.count ?? 0) >= PIN_MAX_FAILS || (pinFails.get(GLOBAL_KEY)?.count ?? 0) >= PIN_GLOBAL_MAX_FAILS;
}

export function badgeView(state: LedgerState, badge: Badge) {
  return { ...badge, art: badgeArt(badge.eventId, badge.owner), event: getEvent(state, badge.eventId) };
}

export function eventView(state: LedgerState, eventId: string) {
  const event = getEvent(state, eventId);
  if (!event) return null;
  const claimed = state.badges.filter((b) => b.eventId === eventId && !b.revoked).length;
  return { ...event, claimed };
}

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal && !ni.address.startsWith("169.254.")) return ni.address;
    }
  }
  return null;
}

/** Public origin for QR links. PUBLIC_BASE_URL wins; localhost is swapped for the LAN IP so phones can reach it. */
export function publicOrigin(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured && /^https?:\/\/[A-Za-z0-9.:-]+\/?$/.test(configured)) return configured.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  if (!/^[A-Za-z0-9.:\[\]-]+$/.test(host)) return "http://localhost:3000";
  const [hostname, port] = host.split(":");
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    const lan = lanAddress();
    if (lan) return `${proto}://${lan}${port ? `:${port}` : ""}`;
  }
  return `${proto}://${host}`;
}
