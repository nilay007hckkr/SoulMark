import { clientIp, cookieSecure, deviceFor, setDeviceCookie, VOUCHER_COOKIE } from "@/lib/http";
import { findScan, recordScan } from "@/lib/presence";
import { issueVoucher, verifyClaimToken, VOUCHER_TTL_MS } from "@/lib/qrToken";
import { allowHit } from "@/lib/rateLimit";
import { loadPresence, savePresence, secrets } from "@/lib/store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const scanHits: Map<string, { count: number; since: number }> =
  ((globalThis as Record<string, unknown>).__smScanHits as Map<string, { count: number; since: number }>) ?? new Map();
(globalThis as Record<string, unknown>).__smScanHits = scanHits;

/**
 * The QR on the big screen points here. A fresh, correctly signed QR is exchanged for a
 * single-use claim voucher (httpOnly cookie, 10 minutes) so first-time users can sign in
 * without the 20-second QR expiring under them. The scan is recorded against this phone and
 * the claim link carries the scan id, so a forwarded link can be traced back to whoever shared it.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const now = Date.now();
  const { qrSecret } = secrets();
  const device = deviceFor(req);
  const check = verifyClaimToken(token, qrSecret, now);
  let location = `/claim?t=${encodeURIComponent(token)}`;
  let voucher: string | null = null;
  if (check.ok) {
    voucher = issueVoucher(check.payload, qrSecret, now).voucher;
    const ip = clientIp(req);
    const presence = loadPresence();
    // One record per phone per QR window; record-flooding is throttled so it can't evict real scans.
    let scan = findScan(presence, { nonce: check.payload.n, deviceId: device.id });
    if (!scan && allowHit(scanHits, ip, now, 60, 60_000) && allowHit(scanHits, "__all__", now, 1_000, 60_000)) {
      scan = recordScan(presence, { eventId: check.payload.e, nonce: check.payload.n, deviceId: device.id, ip, at: now });
      savePresence(presence);
    }
    if (scan) location += `&s=${scan.id}`;
  }
  // Relative redirect keeps the user on the same host the cookies were set for.
  const res = new NextResponse(null, { status: 303, headers: { location } });
  if (voucher) {
    res.cookies.set(VOUCHER_COOKIE, voucher, { httpOnly: true, sameSite: "lax", path: "/", maxAge: VOUCHER_TTL_MS / 1000, secure: cookieSecure(req) });
  }
  setDeviceCookie(res, req, device);
  return res;
}
