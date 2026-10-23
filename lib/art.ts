import { createHash } from "node:crypto";
import type { BadgeArt } from "./types";

/**
 * Deterministic badge art: the pattern is derived from sha256(eventId + ":" + wallet),
 * so the same badge always renders the same way and the art is tied to the on-ledger data.
 * Pure function — safe to call on server or in tests.
 */
export function badgeArt(eventId: string, wallet: string): BadgeArt {
  const h = createHash("sha256").update(`${eventId}:${wallet.toLowerCase()}`).digest();
  const patterns: BadgeArt["pattern"][] = ["rings", "grid", "rays"];
  return {
    hueA: Math.round((h[0] / 255) * 360),
    hueB: Math.round((h[1] / 255) * 360),
    angle: Math.round((h[2] / 255) * 360),
    rings: 3 + (h[3] % 5),
    rotation: h[4] % 90,
    pattern: patterns[h[5] % patterns.length],
    code: h.subarray(6, 9).toString("hex").toUpperCase(),
  };
}
