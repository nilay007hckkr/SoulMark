import { isLatLng } from "@/lib/geo";
import { eventView, fail, handleError, isOrganizer, json, readBody } from "@/lib/http";
import { getEvent, setGeofence } from "@/lib/ledger";
import { issuer, loadLedger, saveLedger } from "@/lib/store";
import { isEventId } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** Organizer sets "this room's location" + radius, or switches the geofence off live (e.g. bad indoor GPS). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!isOrganizer(req)) return fail(401, "Organizer PIN required");
    const { id } = await ctx.params;
    if (!isEventId(id)) return fail(404, "Event not found");
    const body = await readBody(req);
    if (typeof body.enabled !== "boolean") return fail(400, "enabled must be true or false");
    const ledger = loadLedger();
    const event = getEvent(ledger, id);
    if (!event) return fail(404, "Event not found");
    const prev = event.geofence;
    const lat = body.lat ?? prev?.lat;
    const lng = body.lng ?? prev?.lng;
    let radiusM = Number(body.radiusM ?? prev?.radiusM ?? 100);
    // Switching off must always work, even if a bad radius was sent with it.
    if (!body.enabled) radiusM = Math.min(5000, Math.max(10, Number.isFinite(radiusM) ? radiusM : 100));
    if (!isLatLng(lat, lng)) {
      if (body.enabled) return fail(400, "Set the room's location first (latitude/longitude)");
      return json({ event: eventView(ledger, id) }); // nothing to switch off
    }
    setGeofence(ledger, id, { enabled: body.enabled, lat: lat as number, lng: lng as number, radiusM }, issuer().address, new Date());
    saveLedger(ledger);
    return json({ event: eventView(ledger, id) });
  } catch (e) {
    return handleError(e);
  }
}
