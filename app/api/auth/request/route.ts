import { requestOtp } from "@/lib/auth";
import { fail, handleError, json, readBody } from "@/lib/http";
import { demoMode, loadAuth, saveAuth } from "@/lib/store";
import { normalizeEmail } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return fail(400, "Enter a valid email address");
    const auth = loadAuth();
    const code = requestOtp(auth, email, Date.now());
    saveAuth(auth);
    if (!demoMode()) console.info(`[soulmark] sign-in key for ${email}: ${code}`);
    return json({ ok: true, email, resendInSec: 30, expiresInSec: 300, ...(demoMode() ? { demoCode: code } : {}) });
  } catch (e) {
    return handleError(e);
  }
}
