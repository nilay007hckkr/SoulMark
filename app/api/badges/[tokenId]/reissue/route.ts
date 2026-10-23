import { badgeView, fail, handleError, isOrganizer, json, readBody } from "@/lib/http";
import { reissue } from "@/lib/ledger";
import { issuer, loadLedger, saveLedger } from "@/lib/store";
import { normalizeAddress } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ tokenId: string }> }) {
  try {
    if (!isOrganizer(req)) return fail(401, "Organizer PIN required");
    const tokenId = Number((await ctx.params).tokenId);
    if (!Number.isInteger(tokenId) || tokenId < 1) return fail(400, "Invalid badge id");
    const body = await readBody(req);
    const newWallet = normalizeAddress(body.newWallet);
    if (!newWallet) return fail(400, "New wallet must be a 0x address");
    const ledger = loadLedger();
    const badge = reissue(ledger, tokenId, newWallet, issuer().address, new Date());
    saveLedger(ledger);
    return json({ badge: badgeView(ledger, badge) });
  } catch (e) {
    return handleError(e);
  }
}
