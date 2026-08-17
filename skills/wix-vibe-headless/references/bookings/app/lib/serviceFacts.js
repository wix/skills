// Small facts derived from a Service payload, shared by the card and the detail page so "60 MIN",
// the price, and "1-to-1" are computed once instead of drifting between the two call sites.

/**
 * Session length in minutes for an APPOINTMENT, else null: a CLASS/COURSE leaves
 * schedule.availabilityConstraints empty because its length belongs to the scheduled sessions, not
 * the service. For a class, derive it from a fetched slot (localEndDate − localStartDate).
 * @param {object} service
 * @returns {number|null}
 */
export function serviceDuration(service) {
  const c = service?.schedule?.availabilityConstraints;
  return c?.sessionDurations?.[0] ?? c?.durations?.[0]?.minutes ?? null;
}

/**
 * Price label for every rateType. Reading payment.fixed alone renders nothing at all for a VARIED or
 * NO_FEE service, which is why this branches instead.
 *   FIXED       -> "€95.00" (formattedValue when present, else built from value+currency)
 *   VARIED      -> "From €85.00" (payment.varied.minPrice, falling back to defaultPrice)
 *   NO_FEE      -> "Free"
 *   CUSTOM      -> "" (business sets a price at booking time — nothing to show)
 *   SUBSCRIPTION-> "" (paid via a pricing plan, not a per-booking price)
 * @param {object} service
 * @returns {string}
 */
export function servicePriceLabel(service) {
  const payment = service?.payment;
  const money = (m) => m?.formattedValue
    || (m?.currency && new Intl.NumberFormat(undefined, { style: "currency", currency: m.currency }).format(Number(m.value)));
  switch (payment?.rateType) {
    case "FIXED":
      return money(payment.fixed?.price) || "";
    case "VARIED": {
      const from = money(payment.varied?.minPrice ?? payment.varied?.defaultPrice);
      return from ? `From ${from}` : "";
    }
    case "NO_FEE":
      return "Free";
    default:
      return ""; // CUSTOM / SUBSCRIPTION — no single number to show
  }
}

/**
 * "1-to-1" for a single-person service, "Up to N" otherwise. defaultCapacity is the service's own
 * cap — for a CLASS this is usually the room/session size, for an APPOINTMENT usually 1.
 * @param {object} service
 * @returns {string|null}
 */
export function serviceCapacityLabel(service) {
  const cap = service?.defaultCapacity;
  if (!cap) return null;
  return cap === 1 ? "1-to-1" : `Up to ${cap}`;
}

/**
 * Where the service happens, from locations[].type — NOT from payment.options, which says how a
 * customer may *pay* (`online` there means "can pay online", not "happens online"). A video service
 * is flagged by conferencing.enabled. `calculatedAddress` is present on BUSINESS/CUSTOM locations
 * and empty for CUSTOMER; when it's there, prefer the actual place name.
 *   BUSINESS -> the business's address ("At Serene Spa" / "In person")
 *   CUSTOMER -> the customer's address ("At your location")
 *   CUSTOM   -> a specific address for this service
 * @param {object} service
 * @returns {string}
 */
export function serviceLocationLabel(service) {
  if (service?.conferencing?.enabled) return "Online";
  const types = new Set((service?.locations || []).map((l) => l?.type).filter(Boolean));
  const named = (service?.locations || [])
    .map((l) => l?.calculatedAddress?.formatted || l?.business?.name)
    .find(Boolean);
  if (named) return named;
  if (types.has("CUSTOMER")) return "At your location";
  if (types.has("BUSINESS") || types.has("CUSTOM")) return "In person";
  return "";
}

/**
 * The reschedule footnote, e.g. "Free to reschedule up to 24 hours before." `enabled` without
 * `limitLatestReschedule` means any time; with it, the window is latestRescheduleInMinutes. Empty
 * when rescheduling is off, so the page shows no promise rather than a wrong one.
 * @param {object} service
 * @returns {string}
 */
export function serviceRescheduleNote(service) {
  const p = service?.bookingPolicy?.reschedulePolicy;
  if (!p?.enabled) return "";
  if (!p.limitLatestReschedule) return "Free to reschedule any time before your appointment.";
  const hours = Math.round((p.latestRescheduleInMinutes ?? 0) / 60);
  return hours > 0
    ? `Free to reschedule up to ${hours} hour${hours === 1 ? "" : "s"} before.`
    : "Free to reschedule right up until your appointment.";
}
