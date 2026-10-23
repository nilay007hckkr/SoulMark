import { fail, isOrganizer, json } from "@/lib/http";
import { assessClaim, claimTimeStats, heavyScanners } from "@/lib/presence";
import { loadAuth, loadLedger, loadPresence } from "@/lib/store";
import { isEventId } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Organizer-only proxy watch: risk score per claim, who shared a forwarded link,
 * blocked proxy attempts (and whose phone was used), and claim-time stats.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isOrganizer(req)) return fail(401, "Organizer PIN required");
  const { id } = await ctx.params;
  if (!isEventId(id)) return fail(404, "Event not found");
  const ledger = loadLedger();
  if (!ledger.events.some((e) => e.id === id)) return fail(404, "Event not found");
  const presence = loadPresence();
  const auth = loadAuth();

  const byWallet = new Map(Object.values(auth.users).map((u) => [u.wallet, u]));
  const person = (wallet: string | null | undefined) => {
    if (!wallet) return null;
    const u = byWallet.get(wallet);
    return { wallet, handle: u?.handle ?? "SM-" + wallet.slice(2, 8).toUpperCase(), email: u?.email ?? "" };
  };
  const eventClaims = presence.claims.filter((c) => c.eventId === id);
  // Whoever claimed from a phone is that phone's owner for this event.
  const deviceOwner = (deviceId: string | null) => (deviceId ? person(eventClaims.find((c) => c.deviceId === deviceId)?.wallet) : null);

  const claims = eventClaims
    .map((c) => {
      const a = assessClaim(presence, c);
      return {
        tokenId: c.tokenId,
        at: new Date(c.at).toISOString(),
        person: person(c.wallet),
        risk: a.risk,
        level: a.level,
        reasons: a.reasons,
        sharer: a.sharerDeviceId ? deviceOwner(a.sharerDeviceId) ?? { wallet: "", handle: `phone ${a.sharerDeviceId.slice(0, 6)}`, email: "" } : null,
        distanceM: c.distanceM,
        claimSec: c.scanAt !== null && c.scanDeviceId === c.deviceId ? Math.round((c.at - c.scanAt) / 100) / 10 : null,
      };
    })
    .reverse();

  const blocked = presence.blocked
    .filter((b) => b.eventId === id)
    .map((b) => ({ at: new Date(b.at).toISOString(), reason: b.reason, attemptedBy: person(b.wallet), deviceOwner: person(b.deviceOwnerWallet), distanceM: b.distanceM }))
    .reverse();

  const watchers = heavyScanners(presence, id).map((w) => ({ ...w, owner: deviceOwner(w.deviceId) }));
  const flagged = claims.filter((c) => c.level !== "ok").length;
  return json({
    stats: { claims: claims.length, flagged, blocked: blocked.length, ...claimTimeStats(eventClaims) },
    claims,
    blocked,
    heavyScanners: watchers,
  });
}
