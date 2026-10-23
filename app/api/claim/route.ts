import { badgeView, currentUser, fail, getCookie, handleError, json, readBody, VOUCHER_COOKIE } from "@/lib/http";
import { claim } from "@/lib/ledger";
import { verifyClaimToken, verifyVoucher } from "@/lib/qrToken";
import { loadLedger, saveLedger, secrets } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = currentUser(req);
    if (!user) return fail(401, "Sign in to claim your badge");
    const body = await readBody(req);
    const now = Date.now();
    const { qrSecret } = secrets();
    const check = verifyClaimToken(body.token, qrSecret, now);
    if (!check.ok && check.reason === "invalid") return fail(400, "This QR code is not valid — scan the one on screen");

    let eventId: string;
    let nonceKey: string;
    let nonceExpMs: number;
    if (check.ok) {
      // Scanned while signed in: the QR itself is still fresh.
      eventId = check.payload.e;
      nonceKey = `qr:${check.payload.n}:${user.wallet}`;
      nonceExpMs = check.payload.exp + 60_000;
    } else {
      // QR has rotated since the scan: accept only with the voucher issued when the fresh QR was opened.
      const voucher = verifyVoucher(getCookie(req, VOUCHER_COOKIE), qrSecret, now);
      if (!voucher || voucher.n !== check.payload.n || voucher.e !== check.payload.e) {
        return fail(400, "This QR code has expired — scan the live one on screen again");
      }
      eventId = voucher.e;
      nonceKey = `voucher:${voucher.id}`;
      nonceExpMs = voucher.exp + 60_000;
    }

    const ledger = loadLedger();
    const badge = claim(ledger, { eventId, wallet: user.wallet, nonceKey, nonceExpMs }, new Date(now));
    saveLedger(ledger);
    const res = json({ badge: badgeView(ledger, badge) });
    res.cookies.set(VOUCHER_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    return handleError(e);
  }
}
