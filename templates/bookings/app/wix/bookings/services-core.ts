// Service rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./services.ts
// (the SDK, managed Astro and React) and the REST twin in templates/bookings/rest/services.ts
// (fetch, a static site or a port to another language). Every rule about price, "Free", duration,
// media, staff, locations, deposits, the CTA state, and the payment option lives HERE, once. A raw
// entity may come from the SDK (`_id`, dates as Date, media as a `wix:image://` string) or from REST
// (`id`, dates as ISO strings, media as an { id, url, width, height } object); the mappers accept
// both. Imports are type-only so a strip to JS emits no imports.
import type {
  BookingCategory,
  BookingsSettings,
  CourseSpan,
  CtaState,
  Deposit,
  LocationOption,
  RateType,
  ServiceDetail,
  ServiceLocation,
  ServiceSummary,
  ServiceType,
  StaffSummary,
} from "./types";

/** A raw Services V2 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** The Wix Bookings app id — the cart's catalogReference.appId and the services filter. */
export const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
/** Staff-member resource type id (ANY_RESOURCE fallback + staff filtering). */
export const STAFF_RESOURCE_TYPE_ID = "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155";
/**
 * Requested on every service read: without STAFF_MEMBER_DETAILS `staffMemberDetails` is absent (staff
 * = []); without DISCOUNT_INFO_DETAILS `payment.discountInfo` is absent (no discount is ever shown).
 */
export const SERVICES_CONDITIONAL_FIELDS = ["STAFF_MEMBER_DETAILS", "DISCOUNT_INFO_DETAILS"] as const;
/** Listing page size — Wix's own list pages 20 at a time. */
export const SERVICES_PAGE_SIZE = 20;
/**
 * Reserved location-filter id for "held somewhere else" (custom or customer locations) — the same
 * literal Wix's service list accepts in `?location=`, never a real location GUID.
 */
export const OTHER_LOCATIONS_ID = "OTHER_LOCATIONS";

const SERVICE_TYPES: readonly string[] = ["APPOINTMENT", "CLASS", "COURSE"];
const RATE_TYPES: readonly string[] = ["FIXED", "VARIED", "CUSTOM", "NO_FEE", "SUBSCRIPTION"];

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

export interface ServicesFilterOptions {
  slug?: string;
  categoryId?: string | null;
  /** A business location id, or OTHER_LOCATIONS_ID for the custom/customer bucket. */
  locationId?: string | null;
}

/**
 * The filter every services read shares, in REST query-language form: this app's services, never
 * hidden ones (filtered by the SERVER — a page is never under-filled by hidden services), optionally
 * one slug (`mainSlug.name`), one category (`category.id`), one business location
 * (`locations.business.id`) or the "other locations" bucket (`locations.type` CUSTOM/CUSTOMER).
 * The SDK transport applies the same rules with its query builder.
 */
export function servicesFilter({ slug, categoryId, locationId }: ServicesFilterOptions = {}): Raw {
  return {
    appId: BOOKINGS_APP_ID,
    hidden: false,
    ...(slug ? { "mainSlug.name": slug } : {}),
    ...(categoryId ? { "category.id": categoryId } : {}),
    ...(locationId === OTHER_LOCATIONS_ID
      ? { "locations.type": { $hasSome: ["CUSTOM", "CUSTOMER"] } }
      : locationId
        ? { "locations.business.id": locationId }
        : {}),
  };
}

/** The Query Categories body: only categories that hold at least one bookable service come back. */
export const CATEGORIES_QUERY: Raw = { filter: { services: {} } };
/** The Query Locations body: only business locations that host a visible service of this app. */
export const LOCATIONS_QUERY: Raw = { filter: { services: { appId: BOOKINGS_APP_ID, hidden: false } } };

/**
 * Whether an offset page has a successor: from the response's total when the server counted, else
 * from a full page (a short page is the last one).
 */
export function hasMorePage(meta: Raw | undefined | null, offset: number, count: number, limit: number): boolean {
  const total = meta?.total;
  if (typeof total === "number" && !meta?.tooManyToCount) return offset + count < total;
  return count >= limit;
}

/**
 * A media value the image helpers can resolve. The SDK hands over a `wix:image://v1/<id>/<name>#…`
 * string (or an https URL); REST hands over the image OBJECT with a bare file id — rebuilt into the
 * same `wix:image://` form the SDK produces, so imgSrc scales both identically.
 */
export function mediaValue(image: unknown): unknown {
  if (!image || typeof image === "string") return image;
  const o = image as Raw;
  const url: string = o.url ?? "";
  if (/^(https?:|wix:image:)/.test(url)) return url;
  if (o.id) return `wix:image://v1/${o.id}/${encodeURIComponent(o.filename ?? "")}#originWidth=${o.width ?? 0}&originHeight=${o.height ?? 0}`;
  return url;
}

/**
 * A Money value → display string, the way Wix's own bookings surfaces format it: whole amounts
 * without decimals ("€75"), fractional ones with two ("€49.99"); "" when the value or the currency
 * is missing — never a guessed currency (a USD default mislabels every non-USD site).
 */
export function formatPrice(value: string | number | undefined | null, currency: string | undefined | null, locale?: string): string {
  if (value == null || value === "" || !currency) return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  const digits = amount % 1 === 0 ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "symbol", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Money as the API sends it ({ value, currency }) → display string ("" when incomplete). */
export const formatMoney = (money: Raw | undefined | null, locale?: string): string => formatPrice(money?.value, money?.currency, locale);

/** "1 hr 30 min" / "45 min" / "2 hr" through Intl unit formatting ("" when unknown). */
export function durationLabel(minutes: number | null | undefined, locale?: string): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "";
  try {
    const unit = (u: "hour" | "minute", n: number) => new Intl.NumberFormat(locale, { style: "unit", unit: u, unitDisplay: "short" }).format(n);
    if (minutes < 60) return unit("minute", minutes);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? unit("hour", hours) : `${unit("hour", hours)} ${unit("minute", rest)}`;
  } catch {
    return `${minutes} min`;
  }
}

/** A service offers add-ons when any of its groups holds add-on ids. */
export const hasAddOns = (raw: Raw): boolean => ((raw.addOnGroups ?? []) as Raw[]).some((g) => (g.addOnIds ?? []).length > 0);

export interface ResolvedPrice {
  rateType: RateType;
  price: string;
  priceFrom: boolean;
  basePrice: string;
  discountName: string;
  calculatedAtCheckout: boolean;
  hasPricingPlans: boolean;
  free: boolean;
}

/**
 * The price a tile shows, by `payment.rateType` — Wix's own rule: FIXED → the price; VARIED → the
 * minimum with a "From" flag; CUSTOM → the owner's free text; NO_FEE → "Free" (Wix shows nothing;
 * a headless brief expects the word). A discount (from DISCOUNT_INFO_DETAILS) yields a concrete
 * discounted price only for a single FIXED price with no add-ons; otherwise it is "calculated at
 * checkout". A FIXED price of 0 counts as free too — it books without a checkout.
 */
export function resolvePrice(raw: Raw): ResolvedPrice {
  const payment: Raw = raw.payment ?? {};
  const rateType = (RATE_TYPES.includes(payment.rateType) ? payment.rateType : "NO_FEE") as RateType;
  const hasPricingPlans = ((payment.pricingPlanIds ?? []) as string[]).length > 0;
  let price = "";
  let priceFrom = false;
  let free = false;
  switch (rateType) {
    case "FIXED":
      price = formatMoney(payment.fixed?.price);
      free = Number(payment.fixed?.price?.value ?? 0) === 0;
      if (free) price = "Free";
      break;
    case "VARIED":
      price = formatMoney(payment.varied?.minPrice ?? payment.varied?.defaultPrice);
      priceFrom = !!price;
      break;
    case "CUSTOM":
      price = payment.custom?.description ?? "";
      break;
    case "NO_FEE":
      price = "Free";
      free = true;
      break;
    default:
      break;
  }
  const discountName: string = payment.discountInfo?.discountName ?? "";
  const after = discountName && rateType === "FIXED" && !free && !hasAddOns(raw) ? formatMoney(payment.discountInfo?.priceAfterDiscount) : "";
  return {
    rateType,
    price: after || price,
    priceFrom,
    basePrice: after ? price : "",
    discountName,
    calculatedAtCheckout: !!discountName && !after,
    hasPricingPlans,
    free,
  };
}

/**
 * Deposit terms from the service's payment: `options.deposit` says a deposit is taken; the amount is
 * `fixed|varied.deposit` (a percentage deposit stores no amount — the server resolves it, so the
 * amount stays ""); `fullUpfrontPaymentAllowed` lets the visitor pay everything now instead.
 */
export function depositOf(raw: Raw): Deposit | null {
  const payment: Raw = raw.payment ?? {};
  const rate: Raw = payment.fixed ?? payment.varied ?? {};
  const value = rate.deposit?.value ?? rate.depositDetails?.amount?.value;
  const takesDeposit = payment.options?.deposit === true || (!!value && Number(value) > 0);
  if (!takesDeposit) return null;
  return {
    amount: formatMoney(rate.deposit ?? rate.depositDetails?.amount),
    fullUpfrontAllowed: rate.fullUpfrontPaymentAllowed === true,
  };
}

/** A service `locations[]` entry → DTO (BUSINESS carries the location's id and name). */
export function toLocation(raw: Raw): ServiceLocation {
  const type = (["BUSINESS", "CUSTOM", "CUSTOMER"].includes(raw.type) ? raw.type : "CUSTOM") as ServiceLocation["type"];
  return {
    id: type === "BUSINESS" ? rawId(raw.business) || rawId(raw) || null : null,
    name: raw.business?.name ?? raw.custom?.address?.formattedAddress ?? (type === "CUSTOMER" ? "Your location" : ""),
    type,
  };
}

/** A Query Locations response → the listing's location options (sorted by name) and the "other locations" flag. */
export function toLocationOptions(res: Raw | null | undefined): { locations: LocationOption[]; hasOtherLocations: boolean } {
  const locations = ((res?.businessLocations?.locations ?? []) as Raw[])
    .map((l) => ({ id: rawId(l.business) || rawId(l), name: l.business?.name ?? "" }))
    .filter((l) => l.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { locations, hasOtherLocations: res?.customLocations?.exists === true || res?.customerLocations?.exists === true };
}

/** Staff from `staffMemberDetails` (needs STAFF_MEMBER_DETAILS), photo through the injected imgSrc. */
export function toStaff(raw: Raw, imgSrc: ImgSrc): StaffSummary[] {
  return ((raw.staffMemberDetails?.staffMembers ?? []) as Raw[])
    .map((m) => ({ id: m.staffMemberId ?? "", name: m.name ?? "", imageUrl: imgSrc(mediaValue(m.mainMedia?.image), 160, 160) }))
    .filter((m) => m.id);
}

/** An API date (Date on the SDK, ISO string on REST) → ISO string, or null. */
export function toIso(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const isMissingOrPast = (iso: string | null, now: number): boolean => !iso || new Date(iso).getTime() <= now;

/**
 * Whether policy already forbids booking (Wix's rule): the late-booking limit before the first
 * session has passed, or the first session started and booking after start is off, or a course's
 * last session ended. Only meaningful for services with a fixed first session (classes, courses).
 */
export function isTooLateToBook(raw: Raw, now = Date.now()): boolean {
  const policy: Raw = raw.bookingPolicy ?? {};
  const afterStart = policy.bookAfterStartPolicy?.enabled === true;
  const first = toIso(raw.schedule?.firstSessionStart);
  const last = toIso(raw.schedule?.lastSessionEnd);
  let tooLate = false;
  if (!afterStart && first && policy.limitLateBookingPolicy?.enabled) {
    const latest = new Date(first).getTime() - (policy.limitLateBookingPolicy.latestBookingInMinutes ?? 0) * 60_000;
    tooLate = now > latest;
  }
  const courseEnded = raw.type === "COURSE" && isMissingOrPast(last, now);
  const started = !!first && isMissingOrPast(first, now);
  return courseEnded || (started && !afterStart) || tooLate;
}

/**
 * The CTA state: a course that is full or too late to book is only viewable; manual approval turns
 * "Book" into "Request to book"; otherwise book. `courseFull` comes from the course's sessions
 * (the booking flow supplies it; the listing passes false).
 */
export function ctaStateOf(service: Pick<ServiceSummary, "type" | "requiresManualApproval" | "tooLateToBook">, courseFull = false): CtaState {
  if (service.type === "COURSE" && (courseFull || service.tooLateToBook)) return "viewCourse";
  if (service.requiresManualApproval) return "requestToBook";
  return "book";
}

/** A COURSE's span from its schedule; null for other types. */
export function courseSpanOf(raw: Raw, now = Date.now()): CourseSpan | null {
  if (raw.type !== "COURSE") return null;
  const endDate = toIso(raw.schedule?.lastSessionEnd);
  return { startDate: toIso(raw.schedule?.firstSessionStart), endDate, ended: isMissingOrPast(endDate, now) };
}

/** True for the three known types; an unknown type never becomes a DTO (Wix's own list would not render it either). */
export const isKnownType = (raw: Raw): boolean => SERVICE_TYPES.includes(raw.type);

export function toSummary(raw: Raw, imgSrc: ImgSrc): ServiceSummary {
  const priced = resolvePrice(raw);
  const durationMinutes: number | null = raw.schedule?.availabilityConstraints?.sessionDurations?.[0] ?? null;
  const type = (isKnownType(raw) ? raw.type : "APPOINTMENT") as ServiceType;
  const requiresManualApproval = raw.onlineBooking?.requireManualApproval === true;
  const tooLateToBook = isTooLateToBook(raw);
  return {
    id: rawId(raw),
    slug: raw.mainSlug?.name ?? raw.supportedSlugs?.[0]?.name ?? "",
    name: raw.name ?? "",
    tagLine: raw.tagLine ?? "",
    type,
    ...priced,
    durationMinutes,
    durationLabel: durationLabel(durationMinutes),
    imageUrl: imgSrc(mediaValue(raw.media?.mainMedia?.image), 800, 800),
    categoryId: rawId(raw.category) || null,
    categoryName: raw.category?.name ?? "",
    scheduleId: rawId(raw.schedule) || null,
    staff: toStaff(raw, imgSrc),
    locations: ((raw.locations ?? []) as Raw[]).map(toLocation),
    conferencing: raw.conferencing?.enabled === true,
    hasAddOns: hasAddOns(raw),
    requiresManualApproval,
    onlineBookingEnabled: raw.onlineBooking?.enabled !== false,
    tooLateToBook,
    ctaState: ctaStateOf({ type, requiresManualApproval, tooLateToBook }),
    defaultCapacity: raw.defaultCapacity ?? null,
    maxParticipantsPerBooking: raw.bookingPolicy?.participantsPolicy?.maxParticipantsPerBooking ?? null,
    deposit: depositOf(raw),
    offeredDays: [],
  };
}

export function toDetail(raw: Raw, imgSrc: ImgSrc): ServiceDetail {
  const summary = toSummary(raw, imgSrc);
  const online = raw.payment?.options?.online === true;
  const inPerson = raw.payment?.options?.inPerson === true;
  // Derive — never hardcode "ONLINE": a free/pay-in-person service booked ONLINE gets rejected by the
  // cart with INSUFFICIENT_INVENTORY. Online-only → ONLINE; in-person-only → OFFLINE; both/neither → ONLINE.
  const paymentOption: "ONLINE" | "OFFLINE" = !online && inPerson ? "OFFLINE" : "ONLINE";
  return {
    ...summary,
    description: raw.description ?? "",
    formId: rawId(raw.form) || null,
    paymentOption,
    cancellationFeeEnabled: raw.bookingPolicy?.cancellationFeePolicy?.enabled === true,
    course: courseSpanOf(raw),
  };
}

export function toCategory(raw: Raw): BookingCategory {
  return { id: rawId(raw), name: raw.name ?? "" };
}

/** Categories in the owner's order (`sortOrder`), ids present. */
export function toCategories(raws: Raw[]): BookingCategory[] {
  return [...raws].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(toCategory).filter((c) => c.id);
}

/** Bookings settings (the SDK returns the entity, REST wraps it in `bookingsSettings`); the Wix default is the business zone. */
export function toBookingsSettings(raw: Raw | null | undefined): BookingsSettings {
  const settings: Raw = raw?.bookingsSettings ?? raw ?? {};
  return {
    displayTimeZone: settings.displayTimeZone?.basedOn === "CUSTOMER_TIME_ZONE" ? "CUSTOMER" : "BUSINESS",
    customerCanChange: settings.displayTimeZone?.customerCanChange === true,
  };
}

/** The settings when they can't be read — Wix's own fallback: business zone, no switching. */
export const DEFAULT_BOOKINGS_SETTINGS: BookingsSettings = { displayTimeZone: "BUSINESS", customerCanChange: false };
