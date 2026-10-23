import { eventView, fail, handleError, isOrganizer, json, readBody } from "@/lib/http";
import { createEvent } from "@/lib/ledger";
import { issuer, loadLedger, saveLedger } from "@/lib/store";
import { cleanText, isIsoDate } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  const ledger = loadLedger();
  const events = ledger.events.map((e) => eventView(ledger, e.id)).reverse();
  return json({ events });
}

export async function POST(req: Request) {
  try {
    if (!isOrganizer(req)) return fail(401, "Organizer PIN required");
    const body = await readBody(req);
    const name = cleanText(body.name, 80, { required: true });
    if (!name) return fail(400, "Event name is required (max 80 characters)");
    if (!isIsoDate(body.date)) return fail(400, "Date must be YYYY-MM-DD");
    const venue = cleanText(body.venue, 80);
    if (venue === null) return fail(400, "Venue is too long (max 80 characters)");
    const description = cleanText(body.description, 280);
    if (description === null) return fail(400, "Description is too long (max 280 characters)");
    const claimMinutes = Number(body.claimMinutes ?? 120);
    const ledger = loadLedger();
    const event = createEvent(ledger, { name, date: body.date, venue, description, claimMinutes }, issuer(), new Date());
    saveLedger(ledger);
    return json({ event: eventView(ledger, event.id) }, 201);
  } catch (e) {
    return handleError(e);
  }
}
