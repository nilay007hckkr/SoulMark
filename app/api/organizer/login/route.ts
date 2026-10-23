import { fail, handleError, json, pinMatches, readBody } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    if (!pinMatches(body.pin)) return fail(401, "Wrong PIN");
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
