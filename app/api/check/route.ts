import { fail, json } from "@/lib/http";
import { hasBadge, verifyChain } from "@/lib/ledger";
import { loadLedger } from "@/lib/store";
import { isEventId, normalizeAddress } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** Verifier API: GET /api/check?wallet=0x...&event=evt_... */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = normalizeAddress(url.searchParams.get("wallet"));
  const eventId = url.searchParams.get("event");
  if (!wallet) return fail(400, "wallet must be a 0x address");
  if (!isEventId(eventId)) return fail(400, "event must look like evt_xxxxxxxx");
  const ledger = loadLedger();
  return json({ wallet, eventId, hasBadge: verifyChain(ledger) && hasBadge(ledger, wallet, eventId) });
}
