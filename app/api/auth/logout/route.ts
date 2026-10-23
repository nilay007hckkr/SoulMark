import { endSession } from "@/lib/auth";
import { getCookie, json, SESSION_COOKIE } from "@/lib/http";
import { loadAuth, saveAuth } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = loadAuth();
  endSession(auth, getCookie(req, SESSION_COOKIE));
  saveAuth(auth);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
