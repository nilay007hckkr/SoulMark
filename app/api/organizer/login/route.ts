import { fail, handleError, isOrganizer, json, organizerLocked, readBody } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const pin = typeof body.pin === "string" ? body.pin : "";
    const headers = new Headers(req.headers);
    headers.set("x-organizer-pin", pin);
    if (!isOrganizer(new Request(req.url, { headers }))) {
      return fail(organizerLocked(req) ? 429 : 401, organizerLocked(req) ? "Too many wrong PINs — try again in 10 minutes" : "Wrong PIN");
    }
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
