// Rentals over the SDK — the only file that touches raw Bookings entities on this transport: the
// rental catalog (Services V2 filtered to the Rentals app), start availability, hourly end options,
// the daily walk's day list, the price preview, the booking form, and the
// createBooking → Cart V2 → checkout-or-place sequence. Every body is built in ./rentals-core
// (shared with the REST twin in templates/rentals/rest/); this file is the transport only. Copy
// as-is; extend by calling these exports, never by editing them. Failures are loud where a visitor
// acts (renting) and silent-with-a-default where they only inform (form, preview).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slot-end-options.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/pricing/pricing-api/preview-price.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { availabilityTimeSlots, bookings as bookingsModule, pricing as pricingModule, services as servicesModule } from "@wix/bookings";
import { createCart, calculateCart, placeOrder } from "@wix/auto_sdk_ecom_cart-v-2";
import { redirects as redirectsModule } from "@wix/redirects";
import { wixFetch, wixModule } from "../sdk";
import { imgSrc } from "../media";
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
} from "./rentals-core";
import type { EndOption, RentalDetail, RentalFormField, RentalQuote, RentalResult, RentalSummary, StartOption } from "./types";

export { RENTALS_APP_ID, RENTALS_FORM_ID, RENTALS_PAGE_SIZE, dailyEndOptions, defaultTimeZone };

const services = wixModule(servicesModule);
const slots = wixModule(availabilityTimeSlots);
const bookings = wixModule(bookingsModule);
const pricing = wixModule(pricingModule);
const cart = wixModule({ createCart, calculateCart, placeOrder });
const redirects = wixModule(redirectsModule);

export interface RentalsPage {
  items: RentalSummary[];
  /** Another page follows — pass `offset + items.length`. */
  hasMore: boolean;
}

/**
 * One page of rentals: Bookings services carrying the Rentals app id (the filter that keeps haircuts
 * out of a rooms catalog on a site that has both), not hidden, with a duration range.
 */
export async function fetchRentals({ limit = RENTALS_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<RentalsPage> {
  const res = await services.queryServices().eq("appId", RENTALS_APP_ID).eq("hidden", false).limit(limit).skip(offset).find();
  return { items: ((res.items ?? []) as Raw[]).filter(isRental).map((r) => toSummary(r, imgSrc)), hasMore: res.hasNext() };
}

/** One rental by its URL slug (mainSlug.name); null when not found or not a rental. */
export async function fetchRentalBySlug(slug: string): Promise<RentalDetail | null> {
  const res = await services.queryServices().eq("mainSlug.name", slug).eq("appId", RENTALS_APP_ID).eq("hidden", false).limit(1).find();
  const raw = res.items?.[0] as Raw | undefined;
  return raw && isRental(raw) ? toDetail(raw, imgSrc) : null;
}

export interface StartsPage {
  options: StartOption[];
  /** The zone the server computed in — the one requested, or the business zone when none was sent. */
  timeZone: string | null;
}

/**
 * The starts a customer can pick in [start of `from`'s day, +days): times for an hourly rental, one
 * per available day for a daily one; follows the cursor until the window is complete. Each start
 * carries the resource it books.
 */
export async function fetchStarts(rental: Pick<RentalDetail, "id" | "unit" | "resourceTypeId">, window: StartWindow = {}): Promise<StartsPage> {
  const raws: Raw[] = [];
  let timeZone: string | null = null;
  let cursor: string | undefined;
  do {
    const res: Raw = await slots.listAvailabilityTimeSlots(startsRequest(rental, { ...window, cursor }) as any);
    raws.push(...((res.timeSlots ?? []) as Raw[]));
    timeZone ??= res.timeZone ?? null;
    cursor = nextSlotsCursor(res) ?? undefined;
  } while (cursor);
  return { options: toStartOptions(raws, rental.unit), timeZone };
}

/**
 * The lengths a customer can pick for a chosen start. HOURLY: the server's end options (capped by the
 * rental's maximum and by the resource's next booking). DAILY: the consecutive available days from the
 * start, walked here from the starts already fetched (`availableDayKeys`).
 */
export async function fetchEndOptions(rental: Pick<RentalDetail, "id" | "unit" | "minUnits" | "maxUnits">, start: StartOption, { timeZone, availableDayKeys = [] }: { timeZone?: string | null; availableDayKeys?: string[] } = {}): Promise<EndOption[]> {
  if (rental.unit === "DAY") return dailyEndOptions(start, availableDayKeys, rental);
  const res: Raw = await slots.listAvailabilityTimeSlotEndOptions(rental.id, endOptionsRequest(start, timeZone, "_id") as any);
  return toHourlyEndOptions(res, start);
}

/** The server's price for a start and length; falls back to rate × length when the preview fails. */
export async function fetchQuote(rental: Pick<RentalDetail, "id" | "rateAmount" | "currency" | "unit">, start: StartOption, end: EndOption, timeZone: string = defaultTimeZone()): Promise<RentalQuote> {
  try {
    const res: Raw = await pricing.previewPrice(previewRequest(rental, start, end.endLocal, timeZone) as any);
    return toQuote(res, rental, end.units);
  } catch {
    return toQuote(null, rental, end.units);
  }
}

/** The booking form's fields (the Rentals default form on a seeded site); contact basics when unreadable. */
export async function fetchRentalForm(formId: string | null): Promise<RentalFormField[]> {
  const id = encodeURIComponent(formId ?? RENTALS_FORM_ID);
  try {
    const json = async (path: string): Promise<Raw | null> => {
      const r = await wixFetch(path);
      return r.ok ? ((await r.json()) as Raw) : null;
    };
    const [summary, form] = await Promise.all([json(`/form-schema-service/v4/forms/${id}/summary`), json(`/form-schema-service/v4/forms/${id}`).catch(() => null)]);
    return summary ? toFormFields(summary.formSummary, form?.form) : FALLBACK_FIELDS;
  } catch {
    return FALLBACK_FIELDS;
  }
}

/**
 * Rent: createBooking (the start's resource, the customer's end) → createCart (holds it, carries the
 * contact and location, the Rentals app id on the line) → calculateCart → hosted checkout (paid) or
 * placeOrder (free / pay-in-person). Call from the browser. Throws with a friendly message on refusal.
 */
export async function rentResource(rental: RentalDetail, start: StartOption, end: EndOption, formValues: Record<string, unknown>, timeZone: string = defaultTimeZone()): Promise<RentalResult> {
  let created: Raw;
  try {
    created = await bookings.createBooking(bookingRequest(rental, start, end.endLocal, timeZone, "_id") as any, bookingOptions(formValues) as any);
  } catch (e) {
    throw new Error(friendlyError(e instanceof Error ? e.message : String(e)));
  }
  const bookingId = bookingIdOf(created);
  if (!bookingId) throw new Error("The rental couldn't be booked — the time may have just been taken.");

  const newCart: Raw = await cart.createCart(cartRequest([bookingId], contactOf(created), start.location?.type === "BUSINESS" ? start.location.id : null) as any);
  const cartId = cartIdOf(newCart);
  if (!cartId) throw new Error("The rental couldn't be reserved — please try again.");

  const calc: Raw = await cart.calculateCart(cartId);
  if (checkoutRequired(rental, calc)) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const session: Raw = await redirects.createRedirectSession(checkoutRedirectRequest(cartId, origin));
    const url = session?.redirectSession?.fullUrl;
    if (!url) throw new Error("Checkout couldn't start — please try again.");
    return { kind: "redirect", url };
  }
  const order: Raw = await cart.placeOrder(cartId);
  return confirmedResult(bookingId, order);
}
