import { requestOtp } from "@/lib/auth";
import { clientIp, fail, handleError, json, readBody } from "@/lib/http";
import { sendSignInKey, smtpConfig } from "@/lib/mailer";
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
    // Per-IP limit plus a global ceiling, because X-Forwarded-For can be forged when no proxy is in front.
    const now = Date.now();
    if (!allowHit(hits, clientIp(req), now, IP_LIMIT, IP_WINDOW_MS) || !allowHit(hits, "__all__", now, IP_LIMIT * 15, IP_WINDOW_MS)) {
      return fail(429, "Too many sign-in requests from this network — try again in a few minutes");
    }
    const auth = loadAuth();
    const code = requestOtp(auth, email, Date.now());
    saveAuth(auth);
    const smtp = smtpConfig();
    let delivery: "email" | "demo" | "server-log" = demoMode() ? "demo" : "server-log";
    if (smtp) {
      try {
        await sendSignInKey(smtp, email, code);
        delivery = "email";
      } catch (e) {
        console.error("[soulmark] could not send sign-in email", e instanceof Error ? e.message : e);
        if (!demoMode()) return fail(502, "Couldn't send the email right now — try again in a moment");
      }
    }
    if (delivery === "server-log") console.info(`[soulmark] sign-in key for ${email}: ${code}`);
    return json({ ok: true, email, resendInSec: 30, expiresInSec: 300, delivery, ...(demoMode() ? { demoCode: code } : {}) });
  } catch (e) {
    return handleError(e);
  }
}
