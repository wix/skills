import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { bookings } from "@wix/bookings";

// POST /api/confirm-booking { bookingId, revision }
//
// createBooking() leaves the booking CREATED — which does NOT occupy a seat, so
// the class/appointment stays bookable and OVERBOOKS (remainingCapacity never
// drops). confirmBooking() promotes it to CONFIRMED (holds the seat); with
// flowControlSettings.checkAvailabilityValidation it REJECTS the confirm if the
// session filled up since the slot was picked — the real overbooking guard.
// confirmBooking requires Manage Bookings, so elevate (app identity) here;
// confirmBooking is a real SDK method, so auth.elevate(...) works directly.

const json = (ok: boolean, status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok, ...extra }), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { return json(false, 400, { error: "Invalid request body." }); }
  const { bookingId, revision } = body ?? {};
  if (!bookingId || !revision) return json(false, 400, { error: "Missing bookingId or revision." });

  try {
    const res = await auth.elevate(bookings.confirmBooking)(bookingId, String(revision), {
      paymentStatus: "NOT_PAID", // pay-on-site reservation
      flowControlSettings: { checkAvailabilityValidation: true },
    });
    return json(true, 200, { status: res.booking?.status });
  } catch (err) {
    console.error("[api/confirm-booking] failed:", err);
    return json(false, 409, { error: "unavailable" }); // most likely: session just filled up
  }
};
