import { badgeView, currentUser, fail, json } from "@/lib/http";
import { badgesOf } from "@/lib/ledger";
import { loadLedger } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = currentUser(req);
  if (!user) return fail(401, "Not signed in");
  const ledger = loadLedger();
  const badges = badgesOf(ledger, user.wallet).map((b) => badgeView(ledger, b)).reverse();
  return json({ badges });
}
