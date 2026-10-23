import { fail, isOrganizer, json, publicOrigin } from "@/lib/http";
import { getEvent, isClaimOpen } from "@/lib/ledger";
import { issueClaimToken, QR_ROTATE_MS } from "@/lib/qrToken";
import { loadLedger, secrets } from "@/lib/store";
import { isEventId } from "@/lib/validate";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isOrganizer(req)) return fail(401, "Organizer PIN required");
  const { id } = await ctx.params;
  if (!isEventId(id)) return fail(404, "Event not found");
  const event = getEvent(loadLedger(), id);
  if (!event) return fail(404, "Event not found");
  const now = Date.now();
  if (!isClaimOpen(event, new Date(now))) return fail(403, "Claiming for this event is closed");
  const { token } = issueClaimToken(id, secrets().qrSecret, now);
  const claimUrl = `${publicOrigin(req)}/api/scan?t=${encodeURIComponent(token)}`;
  const svg = await QRCode.toString(claimUrl, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  return json({ claimUrl, svg, expiresAt: now + QR_ROTATE_MS, rotateMs: QR_ROTATE_MS, serverNow: now });
}
