// Event rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./events.ts (the
// SDK, managed Astro and React) and the REST twin in references/events/rest/events.ts (fetch, a
// static site or a port to another language). Every rule about statuses, fieldsets, prices,
// dates, images and categories lives HERE, once. A raw event may come from the SDK (`_id`,
// mainImage as a wix:image string) or from REST (`id`, mainImage as { id, url }); the mappers
// accept both. Imports are type-only so a strip to JS emits no imports.
import type { EventDetail, EventSummary, RegistrationType } from "./types";

/** A raw Events V3 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** The Wix Events app id (reference only — frontend calls need no app-id constant). */
export const EVENTS_APP_ID = "140603ad-af8d-84a5-2c80-a0f60cb47351";

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

// Fieldsets are opt-in: without REGISTRATION there's no registration type to branch on;
// without CATEGORIES the category names never arrive; DETAILS carries the formatted date
// and mainImage; TEXTS carries the long description; URLS the Wix event page url.
export const LIST_FIELDS = ["DETAILS", "REGISTRATION", "CATEGORIES"] as const;
export const DETAIL_FIELDS = ["DETAILS", "TEXTS", "REGISTRATION", "URLS", "CATEGORIES"] as const;

/** Only these are listed and linked — a past or canceled event isn't registerable. */
export const LIVE_STATUSES = ["UPCOMING", "STARTED"] as const;
export const START_DATE_FIELD = "dateAndTimeSettings.startDate";

/**
 * The Query Events body for the listing: live statuses, soonest first, a positive limit.
 * `paging.limit` defaults to 0 — a bare query answers `total: 2, events: []` with no error — so
 * the limit is always sent. The SDK builder spells the same three parts.
 */
export function listQuery({ limit = 100 } = {}): Raw {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("limit must be between 1 and 1000.");
  return {
    filter: { status: { $in: [...LIVE_STATUSES] } },
    sort: [{ fieldName: START_DATE_FIELD, order: "ASC" }],
    paging: { limit },
  };
}

/** "From €45" (ticketed), "Free" (RSVP / free tickets), "" when nothing applies. */
export function lowestPriceLabel(reg: Raw): string {
  const type = reg.type ?? reg.initialType;
  if (type === "RSVP") return "Free";
  if (type !== "TICKETING") return "";
  const lowest: Raw | undefined = reg.tickets?.lowestPrice;
  if (!lowest) return "";
  if (Number(lowest.value ?? 0) === 0) return "Free";
  if (lowest.formattedValue) return `From ${lowest.formattedValue}`;
  try {
    return `From ${new Intl.NumberFormat(undefined, { style: "currency", currency: lowest.currency || "USD" }).format(Number(lowest.value))}`;
  } catch {
    return `From ${lowest.value} ${lowest.currency ?? ""}`.trim();
  }
}

// event.description is Ricos rich content ({ nodes: [...] }), NOT a string — calling string
// methods on it crashes the page. Extract plain paragraphs; detailedDescription (legacy plain
// text) is the fallback.
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

export function toSummary(raw: Raw, imgSrc: ImgSrc): EventSummary {
  const reg: Raw = raw.registration ?? {};
  const dts: Raw = raw.dateAndTimeSettings ?? {};
  return {
    id: rawId(raw), // _id on the SDK, id on REST — never a bare .id on the SDK (undefined there)
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    shortDescription: raw.shortDescription ?? "",
    dateLabel: dts.formatted?.dateAndTime ?? "",
    startDateIso: dts.startDate ? new Date(dts.startDate).toISOString() : "",
    locationName: raw.location?.name ?? "",
    locationType: raw.location?.locationTbd
      ? "TBD"
      : ((raw.location?.type as "VENUE" | "ONLINE") ?? "TBD"),
    imageUrl: imgSrc(mainImageOf(raw), 1200, 800),
    // `type` is the current flavor (can become EXTERNAL later); initialType is the immutable
    // seeded one — read type first.
    registrationType: (reg.type ?? reg.initialType ?? "NONE") as RegistrationType,
    priceLabel: lowestPriceLabel(reg),
    // The API reports tickets.soldOut true on an RSVP event too (it has no tickets at all) — sold
    // out is a ticketing signal only.
    soldOut: (reg.type ?? reg.initialType) === "TICKETING" && reg.tickets?.soldOut === true,
    // `categories` is absent on the typed Event (an SDK type gap) — the Raw boundary reads
    // the runtime field the CATEGORIES fieldset populates.
    categories: ((raw.categories?.categories ?? []) as Raw[])
      .map((c) => ({ id: rawId(c), name: c.name ?? "" }))
      .filter((c) => c.id),
  };
}

export function toDetail(raw: Raw, imgSrc: ImgSrc): EventDetail {
  const summary = toSummary(raw, imgSrc);
  const reg: Raw = raw.registration ?? {};
  return {
    ...summary,
    aboutParagraphs: toParagraphs(raw.description, raw.detailedDescription),
    // Only OPEN_* statuses (OPEN_RSVP, OPEN_TICKETS, OPEN_EXTERNAL, …) accept registrations.
    registrationOpen: typeof reg.status === "string" && reg.status.startsWith("OPEN_"),
    rsvpResponseType: reg.rsvp?.responseType === "YES_AND_NO" ? "YES_AND_NO" : "YES_ONLY",
    externalUrl: reg.external?.url ?? "",
    addToCalendar: { google: raw.calendarUrls?.google ?? "", ics: raw.calendarUrls?.ics ?? "" },
  };
}
