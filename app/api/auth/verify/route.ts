import { createSession, verifyOtp, type AuthUser } from "@/lib/auth";
import { cookieSecure, fail, handleError, json, readBody, SESSION_COOKIE } from "@/lib/http";
import { loadAuth, saveAuth } from "@/lib/store";
import { isOtpCode, normalizeEmail } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return fail(400, "Enter a valid email address");
    if (!isOtpCode(body.code)) return fail(400, "The key is 6 digits");
    const auth = loadAuth();
    const now = Date.now();
    let user: AuthUser;
    try {
      user = verifyOtp(auth, email, body.code, now);
    } finally {
      saveAuth(auth); // persist failed-attempt counters too
    }
    const token = createSession(auth, email, now);
    saveAuth(auth);
    const res = json({ wallet: user.wallet, handle: user.handle, email: user.email });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 3600,
      secure: cookieSecure(req),
    });
    return res;
  } catch (e) {
    return handleError(e);
  }
}
