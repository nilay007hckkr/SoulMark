import { clientIp, cookieSecure, deviceFor, setDeviceCookie, VOUCHER_COOKIE } from "@/lib/http";
import { recordScan } from "@/lib/presence";
import { issueVoucher, verifyClaimToken, VOUCHER_TTL_MS } from "@/lib/qrToken";
import { loadPresence, savePresence, secrets } from "@/lib/store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
    const presence = loadPresence();
    const scan = recordScan(presence, { eventId: check.payload.e, nonce: check.payload.n, deviceId: device.id, ip: clientIp(req), at: now });
    savePresence(presence);
    location += `&s=${scan.id}`;
  }
  // Relative redirect keeps the user on the same host the cookies were set for.
  const res = new NextResponse(null, { status: 303, headers: { location } });
  if (voucher) {
    res.cookies.set(VOUCHER_COOKIE, voucher, { httpOnly: true, sameSite: "lax", path: "/", maxAge: VOUCHER_TTL_MS / 1000, secure: cookieSecure(req) });
  }
  setDeviceCookie(res, req, device);
  return res;
}
