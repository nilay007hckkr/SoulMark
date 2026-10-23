import { requestOtp } from "@/lib/auth";
import { clientIp, fail, handleError, json, readBody } from "@/lib/http";
import { allowHit } from "@/lib/rateLimit";
import { demoMode, loadAuth, saveAuth } from "@/lib/store";
import { normalizeEmail } from "@/lib/validate";

export const dynamic = "force-dynamic";

// Per-IP limit on sign-in key requests. Default 20 per 10 min because a whole classroom often shares one NAT IP.
const IP_LIMIT = Math.max(1, Number(process.env.OTP_IP_LIMIT) || 20);
const IP_WINDOW_MS = 10 * 60_000;
const hits: Map<string, { count: number; since: number }> =
  ((globalThis as Record<string, unknown>).__smOtpHits as Map<string, { count: number; since: number }>) ?? new Map();
(globalThis as Record<string, unknown>).__smOtpHits = hits;

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return fail(400, "Enter a valid email address");
    if (!allowHit(hits, clientIp(req), Date.now(), IP_LIMIT, IP_WINDOW_MS)) return fail(429, "Too many sign-in requests from this network — try again in a few minutes");
    const auth = loadAuth();
    const code = requestOtp(auth, email, Date.now());
    saveAuth(auth);
    if (!demoMode()) console.info(`[soulmark] sign-in key for ${email}: ${code}`);
    return json({ ok: true, email, resendInSec: 30, expiresInSec: 300, ...(demoMode() ? { demoCode: code } : {}) });
  } catch (e) {
    return handleError(e);
  }
}
