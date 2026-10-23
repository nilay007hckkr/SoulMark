import { badgeView, fail, handleError, isOrganizer, json } from "@/lib/http";
import { revoke } from "@/lib/ledger";
import { issuer, loadLedger, saveLedger } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ tokenId: string }> }) {
  try {
    if (!isOrganizer(req)) return fail(401, "Organizer PIN required");
    const tokenId = Number((await ctx.params).tokenId);
    if (!Number.isInteger(tokenId) || tokenId < 1) return fail(400, "Invalid badge id");
    const ledger = loadLedger();
    const badge = revoke(ledger, tokenId, issuer().address, new Date());
    saveLedger(ledger);
    return json({ badge: badgeView(ledger, badge) });
  } catch (e) {
    return handleError(e);
  }
}
