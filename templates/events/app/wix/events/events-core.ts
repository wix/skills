// Event rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./events.ts (the
// SDK, managed Astro and React) and the REST twin in templates/events/rest/events.ts (fetch, a
// static site or a port to another language). Every rule about statuses, fieldsets, prices,
// dates, images, categories, and the organizer's RSVP form lives HERE, once. A raw event may come
// from the SDK (`_id`, mainImage as a wix:image string, Date objects) or from REST (`id`, mainImage
// as { id, url }, ISO strings); the mappers accept both. Imports are type-only so a strip to JS
// emits no imports.
import type {
  EventCategory,
  EventDetail,
  EventStatus,
  EventSummary,
  RegistrationStatus,
  RegistrationType,
  RsvpForm,
  RsvpFormControl,
  RsvpFormInput,
  TaxSettings,
} from "./types";

/** A raw Events V3 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** The Wix Events app id (reference only — frontend calls need no app-id constant). */
export const EVENTS_APP_ID = "140603ad-af8d-84a5-2c80-a0f60cb47351";

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

// Fieldsets are opt-in: without REGISTRATION there's no registration type to branch on;
// without CATEGORIES the category names never arrive; DETAILS carries the formatted date
// and mainImage; TEXTS carries the long description; URLS the Wix event page url; FORM the
// organizer's RSVP form (createRsvp validates submissions against it).
export const LIST_FIELDS = ["DETAILS", "REGISTRATION", "CATEGORIES"] as const;
export const DETAIL_FIELDS = ["DETAILS", "TEXTS", "REGISTRATION", "URLS", "CATEGORIES", "FORM"] as const;

/** Default listing: only these are registerable. `past` is ENDED; `all` is the three (never CANCELED/DRAFT). */
export const LIVE_STATUSES = ["UPCOMING", "STARTED"] as const;
export const PAST_STATUSES = ["ENDED"] as const;
export type StatusFilter = "upcoming" | "past" | "all";
export function statusesFor(status: StatusFilter = "upcoming"): EventStatus[] {
  if (status === "past") return [...PAST_STATUSES];
  if (status === "all") return [...LIVE_STATUSES, ...PAST_STATUSES];
  return [...LIVE_STATUSES];
}

export const START_DATE_FIELD = "dateAndTimeSettings.startDate";
/** The stable secondary sort. The SDK spells it `_createdDate` and renames on the wire; REST is `createdDate`. */
export const CREATED_DATE_FIELD_SDK = "_createdDate";
export const CREATED_DATE_FIELD_REST = "createdDate";
/** Server-side category filter field. SDK `categories._id` → REST `categories.id` (the same rename). */
export const CATEGORY_ID_FIELD_SDK = "categories._id";
export const CATEGORY_ID_FIELD_REST = "categories.id";
/** Wix's page size; a listing loads more pages on demand. */
export const DEFAULT_PAGE_SIZE = 20;

export interface ListOptions {
  /** Page size, 1..1000 (default 20). */
  limit?: number;
  /** Items to skip (default 0). */
  offset?: number;
  /** Server-side filter to one category (a manual category or a recurring series' id). */
  categoryId?: string;
  status?: StatusFilter;
}

/**
 * The Query Events body for the listing in REST spelling: statuses, soonest first then newest
 * first, a positive limit, an offset. `paging.limit` defaults to 0 — a bare query answers
 * `total: N, events: []` with no error — so the limit is always sent. The SDK builder spells
 * the same parts with `_createdDate` / `categories._id`.
 */
export function listQuery({ limit = DEFAULT_PAGE_SIZE, offset = 0, categoryId, status }: ListOptions = {}): Raw {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("limit must be between 1 and 1000.");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer.");
  const filter: Raw = { status: { $in: statusesFor(status) } };
  if (categoryId) filter[CATEGORY_ID_FIELD_REST] = { $in: [categoryId] };
  return {
    filter,
    sort: [
      { fieldName: START_DATE_FIELD, order: "ASC" },
      { fieldName: CREATED_DATE_FIELD_REST, order: "DESC" },
    ],
    paging: { limit, offset },
  };
}

/** Query Categories body: only MANUAL categories (AUTO / RECURRING_EVENT / HIDDEN never become pills). */
export const CATEGORY_STATES = ["MANUAL"] as const;
export function categoriesQuery(): Raw {
  return { filter: { states: { $hasSome: [...CATEGORY_STATES] } }, paging: { limit: 100 } };
}

/** How many more pages: a page is the last when offset + page length reaches the total. */
export function hasMorePages(loaded: number, total: number | undefined | null): boolean {
  return typeof total === "number" && loaded < total;
}

/**
 * Format a decimal amount in a currency with the visitor's locale — the one money formatter for
 * this vertical. No currency → the bare amount (never a made-up "$"). "" when there is no value.
 */
export function formatAmount(value: string | number | null | undefined, currency: string | null | undefined): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (!currency) return n.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** A Wix Money `{ value, amount (deprecated), currency }` → formatted string (value read before the deprecated amount). */
export function formatMoney(money: Raw | null | undefined): string {
  if (!money) return "";
  return formatAmount(money.value ?? money.amount, money.currency);
}

/** Any date the API hands back (Date on the SDK, ISO string on REST) → ISO string, "" when absent/invalid. */
export function isoOf(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * A moment formatted in the EVENT's time zone (medium date + short time) — sale periods,
 * registration openings. The browser's zone is wrong for a venue event; a missing/invalid zone
 * falls back to the visitor's.
 */
export function formatInZone(value: unknown, timeZoneId: string | null | undefined): string {
  const iso = isoOf(value);
  if (!iso) return "";
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat(undefined, timeZoneId ? { ...opts, timeZone: timeZoneId } : opts).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  }
}

/** "From €45" (ticketed), "Free" (RSVP / free tickets), "" when nothing applies. */
export function lowestPriceLabel(reg: Raw): string {
  const type = reg.type ?? reg.initialType;
  if (type === "RSVP") return "Free";
  if (type !== "TICKETING") return "";
  const lowest: Raw | undefined = reg.tickets?.lowestPrice;
  if (!lowest) return "";
  if (Number(lowest.value ?? lowest.amount ?? 0) === 0) return "Free";
  const formatted = lowest.formattedValue || formatMoney(lowest);
  return formatted ? `From ${formatted}` : "";
}

// event.description is Ricos rich content ({ nodes: [...] }), NOT a string — calling string
// methods on it crashes the page. Extract plain paragraphs; detailedDescription (legacy plain
// text) is the fallback. A description of one empty PARAGRAPH node (what the dashboard saves
// for "no description") yields [] here, matching Wix's hasDescription() rule.
export function toParagraphs(rich: Raw | undefined | null, legacy: string | undefined): string[] {
  const collect = (nodes: Raw[] | undefined): string =>
    (nodes ?? [])
      .map((n: Raw) => (typeof n.textData?.text === "string" ? n.textData.text : collect(n.nodes)))
      .join("");
  const out: string[] = [];
  for (const node of rich?.nodes ?? []) {
    const text = collect([node]).trim();
    if (text) out.push(text);
  }
  if (!out.length && legacy) out.push(legacy);
  return out;
}

/**
 * The main image in the form imgSrc scales: the SDK carries it as a `wix:image://` string; REST
 * as `{ id, url, altText }` — rebuilt into the id form so both transports resolve one URL shape.
 */
export function mainImageOf(raw: Raw): unknown {
  const m = raw.mainImage;
  if (m && typeof m === "object" && typeof m.id === "string" && m.id) {
    return `wix:image://v1/${m.id}/${encodeURIComponent(String(m.altText || "image"))}`;
  }
  return m;
}

/** A category entity (Categories API or the event's CATEGORIES fieldset) → pill DTO. */
export function toCategory(raw: Raw): EventCategory {
  return { id: rawId(raw), name: raw.name ?? "" };
}

/**
 * The event's assigned categories that are real, visitor-facing groupings: the CATEGORIES
 * fieldset also lists the RECURRING_EVENT category every series gets and hidden ones — neither
 * is a filter pill. (`type` and `hidden` per the SDK's EventCategory.)
 */
export function manualCategories(raw: Raw): EventCategory[] {
  return ((raw.categories?.categories ?? []) as Raw[])
    .filter((c) => c.type !== "RECURRING_EVENT" && c.hidden !== true)
    .map(toCategory)
    .filter((c) => c.id);
}

/** Categories from Query Categories, MANUAL only (the query already filters; this is the safety net). */
export function toCategories(list: Raw[] | undefined): EventCategory[] {
  return (list ?? [])
    .filter((c) => !Array.isArray(c.states) || c.states.includes("MANUAL"))
    .map(toCategory)
    .filter((c) => c.id);
}

export function toSummary(raw: Raw, imgSrc: ImgSrc): EventSummary {
  const reg: Raw = raw.registration ?? {};
  const dts: Raw = raw.dateAndTimeSettings ?? {};
  const dateTbd = dts.dateAndTimeTbd === true;
  const registrationType = (reg.type ?? reg.initialType ?? "NONE") as RegistrationType;
  return {
    id: rawId(raw), // _id on the SDK, id on REST — never a bare .id on the SDK (undefined there)
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    shortDescription: raw.shortDescription ?? "",
    status: (raw.status ?? "UPCOMING") as EventStatus,
    // Wix's server-formatted schedule (site locale, event zone); the organizer's TBD message when there is no date.
    dateLabel: dateTbd ? dts.dateAndTimeTbdMessage || dts.formatted?.dateAndTime || "" : (dts.formatted?.dateAndTime ?? ""),
    startDateIso: dateTbd ? "" : isoOf(dts.startDate),
    endDateIso: dateTbd ? "" : isoOf(dts.endDate),
    timeZoneId: dts.timeZoneId ?? "",
    dateTbd,
    dateTbdMessage: dts.dateAndTimeTbdMessage ?? "",
    hideEndDate: dts.hideEndDate === true,
    showTimeZone: dts.showTimeZone !== false,
    locationName: raw.location?.name ?? "",
    locationType: raw.location?.locationTbd
      ? "TBD"
      : ((raw.location?.type as "VENUE" | "ONLINE") ?? "TBD"),
    imageUrl: imgSrc(mainImageOf(raw), 1200, 800),
    // `type` is the current flavor (can become EXTERNAL later); initialType is the immutable
    // seeded one — read type first.
    registrationType,
    priceLabel: lowestPriceLabel(reg),
    // The API reports tickets.soldOut true on an RSVP event too (it has no tickets at all) — sold
    // out is a ticketing signal only.
    soldOut: registrationType === "TICKETING" && reg.tickets?.soldOut === true,
    // `categories` is absent on the typed Event (an SDK type gap) — the Raw boundary reads
    // the runtime field the CATEGORIES fieldset populates.
    categories: manualCategories(raw),
    recurrenceStatus: dts.recurrenceStatus ?? "ONE_TIME",
    recurringCategoryId: dts.recurringEvents?.categoryId ?? "",
  };
}

const INPUT_TYPES = new Set(["TEXT", "NUMBER", "TEXT_ARRAY", "DATE_TIME", "ADDRESS"]);

function toFormInput(raw: Raw): RsvpFormInput {
  const type = INPUT_TYPES.has(raw.type) ? raw.type : raw.array === true ? "TEXT_ARRAY" : "TEXT";
  return {
    name: raw.name ?? "",
    label: raw.label ?? raw.name ?? "",
    mandatory: raw.mandatory === true,
    type,
    options: Array.isArray(raw.options) ? raw.options.map(String) : [],
    maxLength: Number(raw.maxLength) > 0 ? Number(raw.maxLength) : 0,
  };
}

/**
 * The organizer's RSVP form from the FORM fieldset. createRsvp validates `form.inputValues`
 * against `form.controls[].inputs`: an unknown input name, a missing mandatory value (for a YES),
 * or a value outside the predefined options is INVALID_FORM_RESPONSE — so the form is rendered
 * from this, never hardcoded. Deleted controls are skipped; controls keep `orderIndex` order.
 * GUEST_CONTROL is lifted out: its answer travels as `additionalGuestDetails`, not as an input
 * value (the Create RSVP contract). Its max is read from the count input's numeric options, else
 * the names input's `maxSize`.
 */
export function toRsvpForm(form: Raw | undefined | null): RsvpForm | null {
  if (!form || !Array.isArray(form.controls)) return null;
  const live = (form.controls as Raw[])
    .filter((c) => c.deleted !== true)
    .slice()
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const controls: RsvpFormControl[] = [];
  let guestControl: RsvpForm["guestControl"] = null;
  for (const c of live) {
    const inputs = ((c.inputs ?? []) as Raw[]).map(toFormInput).filter((i) => i.name);
    if (c.type === "GUEST_CONTROL") {
      const count = inputs.find((i) => i.type === "NUMBER") ?? inputs[0];
      const names = inputs.find((i) => i.type === "TEXT_ARRAY");
      const numeric = (count?.options ?? []).map(Number).filter((n) => Number.isFinite(n));
      const fromOptions = numeric.length ? Math.max(...numeric) : 0;
      const rawNames = ((c.inputs ?? []) as Raw[]).find((i) => i.type === "TEXT_ARRAY" || i.array === true);
      const maxGuests = fromOptions || Number(rawNames?.maxSize ?? 0) || 0;
      guestControl = { label: count?.label ?? "Guests", maxGuests, namesLabel: names?.label ?? "Guest names" };
      continue;
    }
    controls.push({ id: rawId(c) || c.name || `${controls.length}`, type: c.type ?? "INPUT", system: c.system === true, inputs });
  }
  return { controls, guestControl };
}

/** `registration.tickets.taxSettings` → DTO (null when the organizer configured no tax). */
export function toTaxSettings(ts: Raw | undefined | null): TaxSettings | null {
  if (!ts || !ts.type) return null;
  const rate = Number(ts.rate);
  return {
    name: ts.name ?? "Tax",
    ratePercent: Number.isFinite(rate) ? rate : 0,
    includedInPrice: ts.type === "INCLUDED_IN_PRICE",
    appliedToDonations: ts.appliedToDonations === true,
  };
}

/** The venue's one-line address: Wix's `formatted` (a runtime field), else the parts joined. */
export function formattedAddress(address: Raw | undefined | null): string {
  if (!address) return "";
  if (typeof address.formatted === "string" && address.formatted) return address.formatted;
  if (typeof address.formattedAddress === "string" && address.formattedAddress) return address.formattedAddress;
  return [address.addressLine1 ?? address.addressLine, address.addressLine2, address.city, address.subdivision, address.postalCode, address.country]
    .filter((p) => typeof p === "string" && p.trim())
    .join(", ");
}

/** Coordinates when Wix geocoded the venue (`address.location` on events; `geocode` on ticket definitions). */
export function coordinatesOf(address: Raw | undefined | null): { lat: number; lng: number } | null {
  const geo: Raw | undefined = address?.location ?? address?.geocode;
  const lat = Number(geo?.latitude);
  const lng = Number(geo?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
}

/** A Wix PageUrl: the SDK hands a string; REST hands `{ base, path }` (joined the way the SDK does). */
export function pageUrlOf(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const v = value as Raw;
  if (typeof v.base !== "string") return "";
  const base = /^https?:\/\//.test(v.base) ? v.base : `https://${v.base}`;
  return `${base}${v.path ?? ""}`;
}

export function toDetail(raw: Raw, imgSrc: ImgSrc): EventDetail {
  const summary = toSummary(raw, imgSrc);
  const reg: Raw = raw.registration ?? {};
  const status = (typeof reg.status === "string" ? reg.status : "UNKNOWN_REGISTRATION_STATUS") as RegistrationStatus;
  const paused = reg.registrationPaused === true || reg.registrationDisabled === true;
  const opensAt = status === "SCHEDULED_RSVP" ? isoOf(reg.rsvp?.startDate) : "";
  const formatted: Raw = raw.dateAndTimeSettings?.formatted ?? {};
  const limit = Number(reg.tickets?.ticketLimitPerOrder);
  return {
    ...summary,
    aboutParagraphs: toParagraphs(raw.description, raw.detailedDescription),
    formatted: {
      startDate: formatted.startDate ?? "",
      startTime: formatted.startTime ?? "",
      endDate: formatted.endDate ?? "",
      endTime: formatted.endTime ?? "",
    },
    address: summary.locationType === "VENUE" ? formattedAddress(raw.location?.address) : "",
    coordinates: summary.locationType === "VENUE" ? coordinatesOf(raw.location?.address) : null,
    registrationStatus: status,
    // Wix: closed is exactly the two CLOSED_* statuses. Open = an OPEN_* status the organizer hasn't paused;
    // SCHEDULED_RSVP is neither (it opens at rsvp.startDate).
    registrationOpen: status.startsWith("OPEN_") && !paused && summary.registrationType !== "NONE",
    registrationClosed: status === "CLOSED_MANUALLY" || status === "CLOSED_AUTOMATICALLY",
    registrationOpensAtIso: opensAt,
    registrationOpensAtLabel: formatInZone(opensAt, summary.timeZoneId),
    registrationPaused: paused && status.startsWith("OPEN_"),
    waitlistOnly: status === "OPEN_RSVP_WAITLIST_ONLY",
    membersOnly: reg.allowedGuestTypes === "MEMBER",
    rsvpResponseType: reg.rsvp?.responseType === "YES_AND_NO" ? "YES_AND_NO" : "YES_ONLY",
    rsvpForm: summary.registrationType === "RSVP" ? toRsvpForm(raw.form) : null,
    externalUrl: reg.external?.url ?? "",
    eventPageUrl: pageUrlOf(raw.eventPageUrl),
    addToCalendar: { google: raw.calendarUrls?.google ?? "", ics: raw.calendarUrls?.ics ?? "" },
    taxSettings: toTaxSettings(reg.tickets?.taxSettings),
    // Wix default 20, max 50 — the reservation rejects a larger order with an opaque error.
    ticketLimitPerOrder: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20,
  };
}
