import { badgeView, fail, json } from "@/lib/http";
import { badgesOf, verifyChain } from "@/lib/ledger";
import { loadLedger } from "@/lib/store";
import { normalizeAddress } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet: raw } = await ctx.params;
  const wallet = normalizeAddress(raw);
  if (!wallet) return fail(400, "That is not a valid wallet address (0x followed by 40 hex characters)");
  const ledger = loadLedger();
  const chainValid = verifyChain(ledger);
  const badges = badgesOf(ledger, wallet).map((b) => badgeView(ledger, b)).reverse();
  const verified = chainValid && badges.some((b) => !b.revoked);
  return json({ wallet, verified, badges, chainValid });
}
