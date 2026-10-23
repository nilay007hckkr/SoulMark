import { checkGeofence, parseGeoPoint } from "@/lib/geo";
import { badgeView, clientIp, cookieSecure, currentUser, deviceFor, fail, getCookie, handleError, json, readBody, setDeviceCookie, VOUCHER_COOKIE } from "@/lib/http";
import { claim, getEvent } from "@/lib/ledger";
import { deviceConflict, findScan, recordBlocked, recordClaim } from "@/lib/presence";
import { verifyClaimToken, verifyVoucher } from "@/lib/qrToken";
import { loadLedger, loadPresence, saveLedger, savePresence, secrets } from "@/lib/store";

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
    const presence = loadPresence();
    const device = deviceFor(req);
    const ip = clientIp(req);
    const block = (status: number, reason: string, extra: { deviceOwnerWallet?: string | null; distanceM?: number | null } = {}) => {
      recordBlocked(presence, { eventId, at: now, reason, wallet: user.wallet, deviceId: device.id, ip, deviceOwnerWallet: extra.deviceOwnerWallet ?? null, distanceM: extra.distanceM ?? null });
      savePresence(presence);
      const res = fail(status, reason);
      setDeviceCookie(res, req, device);
      return res;
    };

    // Hard block 1: geofence (only for events where the organizer switched it on).
    const event = getEvent(ledger, eventId);
    const point = parseGeoPoint(body.location);
    const geo = checkGeofence(event?.geofence, point);
    if (!geo.ok && geo.reason === "no_location") {
      return json({ error: "This event checks that you're in the room. Allow location access to claim.", needLocation: true }, 428);
    }
    if (!geo.ok) {
      return block(403, `You're about ${geo.distanceM} m from the venue — claims only work within ${geo.allowedM} m`, { distanceM: geo.distanceM });
    }

    // Hard block 2: this phone already claimed this event for a different account (proxy marking).
    const conflict = deviceConflict(presence, eventId, device.id, user.wallet);
    if (conflict) {
      return block(409, "This phone already claimed this event for another account — proxy marking is blocked", { deviceOwnerWallet: conflict.wallet, distanceM: geo.distanceM });
    }

    const badge = claim(ledger, { eventId, wallet: user.wallet, nonceKey, nonceExpMs }, new Date(now));
    const nonce = check.ok ? check.payload.n : (check.payload?.n ?? "");
    const scan = findScan(presence, { scanId: body.scanId, nonce, deviceId: device.id });
    recordClaim(presence, {
      tokenId: badge.tokenId,
      eventId,
      wallet: user.wallet,
      deviceId: device.id,
      ip,
      at: now,
      scanId: scan?.id ?? null,
      scanDeviceId: scan?.deviceId ?? null,
      scanAt: scan?.at ?? null,
      distanceM: geo.distanceM,
    });
    saveLedger(ledger);
    savePresence(presence);
    const res = json({ badge: badgeView(ledger, badge) });
    res.cookies.set(VOUCHER_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0, secure: cookieSecure(req) });
    setDeviceCookie(res, req, device);
    return res;
  } catch (e) {
    return handleError(e);
  }
}
