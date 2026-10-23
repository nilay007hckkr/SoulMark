import { json } from "@/lib/http";
import { verifyChain } from "@/lib/ledger";
import { loadLedger } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const ledger = loadLedger();
  const height = ledger.blocks.length - 1;
  return json({ height, valid: verifyChain(ledger), blocks: ledger.blocks.slice(-25).reverse() });
}
