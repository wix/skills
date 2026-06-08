import type { APIRoute } from "astro";
import { auth, httpClient } from "@wix/essentials";

// POST /api/waitlist { sessionId, totalParticipants, contactDetails:{firstName,lastName,email,phone} }
//
// Native Wix Bookings waitlist. There is NO v2/v3 waitlist API — createBooking
// can't waitlist; the only join is the legacy v1 Register To Waitlist
// (POST /bookings/v1/waitlist/register), which needs Manage Bookings + a Wix
// contactId. So this runs server-side, elevated to app identity. CLASS only.
//
// `sessionId` is the v1-encoded session id (the `waitingResource`); the browser
// gets it from the SESSION_CAPACITY_EXCEEDED error createBooking returns for a
// full session ("…on session <id>").
//
// IMPORTANT: auth.elevate() only grants permissions for a real SDK function. The
// waitlist + Contacts calls are raw REST (no SDK wrapper), so elevate the
// authenticated fetch ITSELF — NOT a closure that calls it (a closure runs
// un-elevated/visitor and 403s).

const json = (ok: boolean, status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok, ...extra }), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { return json(false, 400, { error: "Invalid request body." }); }
  const { sessionId, totalParticipants = 1, contactDetails } = body ?? {};
  const email: string | undefined = contactDetails?.email;
  if (!sessionId || !email) return json(false, 400, { error: "Missing sessionId or email." });

  const ef = auth.elevate(httpClient.fetchWithAuth as typeof fetch) as typeof fetch;
  const api = (url: string, payload: unknown) =>
    ef(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

  try {
    // 1. Resolve a contactId (reuse by email; create if absent).
    let contactId: string | undefined;
    const q = await api("https://www.wixapis.com/contacts/v4/contacts/query", {
      query: { filter: { "info.emails.email": email } },
    });
    contactId = ((await q.json().catch(() => ({}))) as any).contacts?.[0]?.id;
    if (!contactId) {
      const c = await api("https://www.wixapis.com/contacts/v4/contacts", {
        info: {
          name: { first: contactDetails.firstName, last: contactDetails.lastName || undefined },
          emails: { items: [{ email, primary: true }] },
          ...(contactDetails.phone ? { phones: { items: [{ phone: contactDetails.phone, primary: true }] } } : {}),
        },
      });
      contactId = ((await c.json().catch(() => ({}))) as any).contact?.id;
    }
    if (!contactId) throw new Error("could not resolve contactId");

    // 2. Register on the native waitlist.
    const reg = await api("https://www.wixapis.com/bookings/v1/waitlist/register", {
      waitingResource: sessionId,
      formInfo: {
        paymentSelection: [{ rateLabel: "general", numberOfParticipants: totalParticipants }],
        contactDetails: {
          contactId,
          firstName: contactDetails.firstName,
          lastName: contactDetails.lastName || undefined,
          email,
          phone: contactDetails.phone || undefined,
        },
      },
    });
    const rj: any = await reg.json().catch(() => ({}));
    if (!reg.ok || !rj.registrationId) throw new Error(`register ${reg.status}: ${JSON.stringify(rj).slice(0, 200)}`);
    return json(true, 200, { registrationId: rj.registrationId });
  } catch (err) {
    console.error("[api/waitlist] failed:", err);
    return json(false, 502, { error: "Waitlist registration failed." });
  }
};
