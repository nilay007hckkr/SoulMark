import { createHash, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";
import { badgeArt } from "./art";
import { AuthError, sessionUser, type AuthUser } from "./auth";
import { getEvent, LedgerError } from "./ledger";
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

/** Constant-time PIN comparison (hash both sides so lengths match). */
export function pinMatches(given: unknown): boolean {
  if (typeof given !== "string" || !given || given.length > 64) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secrets().organizerPin).digest();
  return timingSafeEqual(a, b);
}

export function isOrganizer(req: Request): boolean {
  return pinMatches(req.headers.get("x-organizer-pin"));
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
