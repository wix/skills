// Rentals over REST — the twin of app/wix/rentals/rentals.ts. Same exports, same DTOs; every body
// comes from rentals-core (the SAME file the SDK transport uses, deployed flat next to this one), so
// this file is only the transport: literal paths, one fetch per step, all with the visitor token
// (see ./client). Failures are loud where a visitor acts (renting) and silent-with-a-default where
// they only inform (form, preview).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slot-end-options.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/pricing/pricing-api/preview-price.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import {
  FALLBACK_FIELDS,
  RENTALS_APP_ID,
  RENTALS_FORM_ID,
  RENTALS_PAGE_SIZE,
  bookingIdOf,
  bookingOptions,
  bookingRequest,
  cartIdOf,
  cartRequest,
  checkoutRedirectRequest,
  checkoutRequired,
  confirmedResult,
  contactOf,
  dailyEndOptions,
  defaultTimeZone,
  endOptionsRequest,
  friendlyError,
  isRental,
  nextSlotsCursor,
  previewRequest,
  startsRequest,
  toDetail,
  toFormFields,
  toHourlyEndOptions,
  toQuote,
  toStartOptions,
  toSummary,
  type Raw,
  type StartWindow,
} from "./rentals-core.js";
import type { EndOption, RentalDetail, RentalFormField, RentalQuote, RentalResult, RentalSummary, StartOption } from "./types.js";

export { RENTALS_APP_ID, RENTALS_FORM_ID, RENTALS_PAGE_SIZE, dailyEndOptions, defaultTimeZone };

export interface RentalsPage {
  items: RentalSummary[];
  hasMore: boolean;
}

/**
 * POST /bookings/v2/services/query  { query: { filter: { appId, hidden: false }, paging: { limit, offset } } }
 */
export async function fetchRentals({ limit = RENTALS_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<RentalsPage> {
  const res = await wixRequest<Raw>("/bookings/v2/services/query", { body: { query: { filter: { appId: RENTALS_APP_ID, hidden: false }, paging: { limit, offset } } } });
  const items = ((res.services ?? []) as Raw[]).filter(isRental).map((r) => toSummary(r, imgSrc));
  const total = Number(res.pagingMetadata?.total ?? 0);
  return { items, hasMore: total ? offset + (res.services?.length ?? 0) < total : false };
}

/** POST /bookings/v2/services/query  filtered on mainSlug.name — null when not found or not a rental. */
export async function fetchRentalBySlug(slug: string): Promise<RentalDetail | null> {
  const res = await wixRequest<Raw>("/bookings/v2/services/query", { body: { query: { filter: { "mainSlug.name": slug, appId: RENTALS_APP_ID, hidden: false }, paging: { limit: 1 } } } });
  const raw = (res.services ?? [])[0] as Raw | undefined;
  return raw && isRental(raw) ? toDetail(raw, imgSrc) : null;
}

export interface StartsPage {
  options: StartOption[];
  timeZone: string | null;
}

/** POST /service-availability/v2/time-slots  (cursor followed) — the starts a customer can pick. */
export async function fetchStarts(rental: Pick<RentalDetail, "id" | "unit" | "resourceTypeId">, window: StartWindow = {}): Promise<StartsPage> {
  const raws: Raw[] = [];
  let timeZone: string | null = null;
  let cursor: string | undefined;
  do {
    const res = await wixRequest<Raw>("/service-availability/v2/time-slots", { body: startsRequest(rental, { ...window, cursor }) });
    raws.push(...((res.timeSlots ?? []) as Raw[]));
    timeZone ??= res.timeZone ?? null;
    cursor = nextSlotsCursor(res) ?? undefined;
  } while (cursor);
  return { options: toStartOptions(raws, rental.unit), timeZone };
}

/**
 * HOURLY: POST /service-availability/v2/time-slots/end-options  { serviceId, localStartDate, timeZone, location }
 * (the response field is `endOptions`). DAILY: walked locally from the starts already fetched.
 */
export async function fetchEndOptions(rental: Pick<RentalDetail, "id" | "unit" | "minUnits" | "maxUnits">, start: StartOption, { timeZone, availableDayKeys = [] }: { timeZone?: string | null; availableDayKeys?: string[] } = {}): Promise<EndOption[]> {
  if (rental.unit === "DAY") return dailyEndOptions(start, availableDayKeys, rental);
  const res = await wixRequest<Raw>("/service-availability/v2/time-slots/end-options", { body: { serviceId: rental.id, ...endOptionsRequest(start, timeZone, "id") } });
  return toHourlyEndOptions(res, start);
}

/** POST /bookings/v2/pricing/preview  { bookingLineItems: [...] } — falls back to rate × length. */
export async function fetchQuote(rental: Pick<RentalDetail, "id" | "rateAmount" | "currency" | "unit">, start: StartOption, end: EndOption, timeZone: string = defaultTimeZone()): Promise<RentalQuote> {
  try {
    const res = await wixRequest<Raw>("/bookings/v2/pricing/preview", { body: { bookingLineItems: previewRequest(rental, start, end.endLocal, timeZone) } });
    return toQuote(res, rental, end.units);
  } catch {
    return toQuote(null, rental, end.units);
  }
}

/** GET /form-schema-service/v4/forms/{id}/summary (+ the schema for `required`); contact basics when unreadable. */
export async function fetchRentalForm(formId: string | null): Promise<RentalFormField[]> {
  const id = encodeURIComponent(formId ?? RENTALS_FORM_ID);
  try {
    const [summary, form] = await Promise.all([
      wixRequest<Raw>(`/form-schema-service/v4/forms/${id}/summary`, { method: "GET" }),
      wixRequest<Raw>(`/form-schema-service/v4/forms/${id}`, { method: "GET" }).catch(() => null),
    ]);
    return toFormFields(summary?.formSummary, form?.form);
  } catch {
    return FALLBACK_FIELDS;
  }
}

/**
 * POST /bookings/v2/bookings → POST /ecom/v2/carts → POST /ecom/v2/carts/{id}/calculate →
 * POST /headless/v1/redirect-session (paid) | POST /ecom/v2/carts/{id}/place-order (free / offline).
 */
export async function rentResource(rental: RentalDetail, start: StartOption, end: EndOption, formValues: Record<string, unknown>, timeZone: string = defaultTimeZone()): Promise<RentalResult> {
  let created: Raw;
  try {
    created = await wixRequest<Raw>("/bookings/v2/bookings", { body: { booking: bookingRequest(rental, start, end.endLocal, timeZone, "id"), ...bookingOptions(formValues) } });
  } catch (e) {
    throw new Error(friendlyError(e instanceof Error ? e.message : String(e)));
  }
  const bookingId = bookingIdOf(created);
  if (!bookingId) throw new Error("The rental couldn't be booked — the time may have just been taken.");

  const newCart = await wixRequest<Raw>("/ecom/v2/carts", { body: cartRequest([bookingId], contactOf(created), start.location?.type === "BUSINESS" ? start.location.id : null) });
  const cartId = cartIdOf(newCart);
  if (!cartId) throw new Error("The rental couldn't be reserved — please try again.");

  const calc = await wixRequest<Raw>(`/ecom/v2/carts/${cartId}/calculate`, { body: {} });
  if (checkoutRequired(rental, calc)) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const session = await wixRequest<Raw>("/headless/v1/redirect-session", { body: checkoutRedirectRequest(cartId, origin) });
    const url = session?.redirectSession?.fullUrl;
    if (!url) throw new Error("Checkout couldn't start — please try again.");
    return { kind: "redirect", url };
  }
  const order = await wixRequest<Raw>(`/ecom/v2/carts/${cartId}/place-order`, { body: {} });
  return confirmedResult(bookingId, order);
}
