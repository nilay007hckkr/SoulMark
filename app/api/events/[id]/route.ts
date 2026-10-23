import { eventView, fail, json } from "@/lib/http";
import { loadLedger } from "@/lib/store";
import { isEventId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isEventId(id)) return fail(404, "Event not found");
  const ledger = loadLedger();
  const event = eventView(ledger, id);
  if (!event) return fail(404, "Event not found");
  const recent = ledger.badges
    .filter((b) => b.eventId === id)
    .slice(-50)
    .reverse()
    .map((b) => ({ tokenId: b.tokenId, owner: b.owner, issuedAt: b.issuedAt, revoked: b.revoked }));
  return json({ event, recent });
}
