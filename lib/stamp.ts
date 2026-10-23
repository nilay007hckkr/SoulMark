/**
 * Wording for the verify stamp. Badges currently live on SoulMark's own hash-chained ledger, not a public
 * blockchain, so the stamp only says "on-chain" when a confirmed public-chain transaction hash exists.
 */
export interface StampInput {
  verified: boolean;
  chainTxHash?: string | null; // confirmed public-chain tx (none yet in Round 2)
}

export function stampLabel({ verified, chainTxHash }: StampInput): { title: string; subtitle: string; onChain: boolean } {
  if (verified && chainTxHash) return { title: "VERIFIED ON-CHAIN", subtitle: "Confirmed on a public blockchain", onChain: true };
  if (verified) return { title: "VERIFIED", subtitle: "SoulMark ledger · tamper-evident, not yet on a public chain", onChain: false };
  return { title: "NOT VERIFIED", subtitle: "No active badge on the SoulMark ledger", onChain: false };
}
