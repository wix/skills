// Event reads (Wix Events V3, the `wixEventsV2` module) — the only file that touches raw
// event entities. Everything it returns is a plain DTO from ./types. Copy as-is; extend by
// adding functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event-by-slug.md
import { wixEventsV2 } from "@wix/events";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import type { EventDetail, EventSummary, RegistrationType } from "./types";

const events = wixModule(wixEventsV2);

/** The Wix Events app id (reference only — frontend calls need no app-id constant). */
export const EVENTS_APP_ID = "140603ad-af8d-84a5-2c80-a0f60cb47351";

type Raw = Record<string, any>;

// Fieldsets are opt-in: without REGISTRATION there's no registration type to branch on;
// without CATEGORIES the category names never arrive; DETAILS carries the formatted date
// and mainImage; TEXTS carries the long description.
const LIST_FIELDS = ["DETAILS", "REGISTRATION", "CATEGORIES"];
const DETAIL_FIELDS = ["DETAILS", "TEXTS", "REGISTRATION", "URLS", "CATEGORIES"];

function lowestPriceLabel(reg: Raw): string {
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
function toParagraphs(rich: Raw | undefined, legacy: string | undefined): string[] {
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

function toSummary(raw: Raw): EventSummary {
  const reg: Raw = raw.registration ?? {};
  const dts: Raw = raw.dateAndTimeSettings ?? {};
  return {
    id: raw._id ?? "", // _id, never .id — `id` is a REST-view field and is undefined here
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    shortDescription: raw.shortDescription ?? "",
    dateLabel: dts.formatted?.dateAndTime ?? "",
    startDateIso: dts.startDate ? new Date(dts.startDate).toISOString() : "",
    locationName: raw.location?.name ?? "",
    locationType: raw.location?.locationTbd
      ? "TBD"
      : ((raw.location?.type as "VENUE" | "ONLINE") ?? "TBD"),
    imageUrl: imgSrc(raw.mainImage, 1200, 800),
    // `type` is the current flavor (can become EXTERNAL later); initialType is the immutable
    // seeded one — read type first.
    registrationType: (reg.type ?? reg.initialType ?? "NONE") as RegistrationType,
    priceLabel: lowestPriceLabel(reg),
    soldOut: reg.tickets?.soldOut === true,
    // `categories` is absent on the typed Event (an SDK type gap) — the Raw boundary reads
    // the runtime field the CATEGORIES fieldset populates.
    categories: (raw.categories?.categories ?? [])
      .map((c: Raw) => ({ id: c._id ?? "", name: c.name ?? "" }))
      .filter((c: { id: string }) => c.id),
  };
}

function toDetail(raw: Raw): EventDetail {
  const summary = toSummary(raw);
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

/** List live (UPCOMING/STARTED) events, soonest first, mapped to grid-ready DTOs. */
export async function fetchEvents({ limit = 100 } = {}): Promise<EventSummary[]> {
  // The query builder, never a flat/REST `{ query: {...} }` body (the SDK silently ignores
  // the unknown key and returns zero events). Always set a positive limit — it defaults to 0,
  // which also returns zero events with no error.
  const res = await events
    .queryEvents({ fields: LIST_FIELDS as any })
    .in("status", ["UPCOMING", "STARTED"]) // never list or link a past event — it isn't registerable
    .ascending("dateAndTimeSettings.startDate")
    .limit(limit)
    .find();
  return (res.items ?? []).map((e: Raw) => toSummary(e));
}

/** Fetch one event by its URL slug. Null when not found. */
export async function fetchEventBySlug(slug: string): Promise<EventDetail | null> {
  try {
    // getEventBySlug returns a WRAPPED { event } — unlike getEvent below.
    const res: Raw = await events.getEventBySlug(slug, { fields: DETAIL_FIELDS as any });
    const raw = res?.event;
    return raw ? toDetail(raw as Raw) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch one event by id — the post-checkout confirmation read (the thank-you URL carries
 * `?orderNumber=&eventId=`). getEvent returns the Event DIRECTLY (unwrapped) — the one read
 * that isn't `{ event }`; assuming the wrapper crashes the page.
 */
export async function fetchEventById(eventId: string): Promise<EventDetail | null> {
  try {
    const raw: Raw = await events.getEvent(eventId, { fields: DETAIL_FIELDS as any });
    return raw?._id ? toDetail(raw) : null;
  } catch {
    return null;
  }
}
