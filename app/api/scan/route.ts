import { publicOrigin, VOUCHER_COOKIE } from "@/lib/http";
import { issueVoucher, verifyClaimToken, VOUCHER_TTL_MS } from "@/lib/qrToken";
import { secrets } from "@/lib/store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The QR on the big screen points here. A fresh, correctly signed QR is exchanged for a
 * single-use claim voucher (httpOnly cookie, 10 minutes) so first-time users can sign in
 * without the 20-second QR expiring under them. Then we redirect to the claim screen.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const target = new URL(`/claim?t=${encodeURIComponent(token)}`, publicOrigin(req));
  const res = NextResponse.redirect(target, 303);
  const now = Date.now();
  const { qrSecret } = secrets();
  const check = verifyClaimToken(token, qrSecret, now);
  if (check.ok) {
    const { voucher } = issueVoucher(check.payload, qrSecret, now);
    res.cookies.set(VOUCHER_COOKIE, voucher, { httpOnly: true, sameSite: "lax", path: "/", maxAge: VOUCHER_TTL_MS / 1000 });
  }
  return res;
}
