// Event reads over REST — the twin of app/wix/events/events.ts. Same exports, same DTOs; the rules
// and mappers come from events-core (the SAME file the SDK transport uses, deployed flat next to
// this one by deploy.mjs --stack static), so this file is only the transport: one fetch with a
// literal body per function. Every call here is safe from a browser with a visitor token.
// Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/query-categories.md
import { WixApiError, wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import {
  DEFAULT_PAGE_SIZE,
  DETAIL_FIELDS,
  EVENTS_APP_ID,
  LIST_FIELDS,
  categoriesQuery,
  hasMorePages,
  listQuery,
  rawId,
  toCategories,
  toDetail,
  toSummary,
  type ListOptions,
  type Raw,
} from "./events-core.js";
import type { EventCategory, EventDetail, EventSummary } from "./types.js";

export { EVENTS_APP_ID, type ListOptions };

const notFound = (e: unknown): boolean => e instanceof WixApiError && e.status === 404;

/** One page of a listing plus what a "load more" needs. */
export interface EventsPage {
  events: EventSummary[];
  /** Matching events overall (the page is `events`). */
  total: number;
  hasMore: boolean;
}

/**
 * One page of events: UPCOMING/STARTED by default (`status: "past"` for ENDED, `"all"` for both),
 * soonest first then newest first, optionally one category (server-side), `limit` (default 20)
 * from `offset`. The limit is always sent: `paging.limit` defaults to 0 and a bare query answers
 * `total: N, events: []` with no error.
 * POST /events/v3/events/query  { query: { filter: { status: { $in }, "categories.id"?: { $in } }, sort, paging: { limit, offset } }, fields }
 *   → { events, pagingMetadata: { total } }
 */
export async function fetchEventsPage(options: ListOptions = {}): Promise<EventsPage> {
  const { offset = 0 } = options;
  const res = await wixRequest<Raw>("/events/v3/events/query", { body: { query: listQuery({ limit: DEFAULT_PAGE_SIZE, ...options }), fields: LIST_FIELDS } });
  const items = ((res?.events ?? []) as Raw[]).map((e) => toSummary(e, imgSrc));
  const total = typeof res?.pagingMetadata?.total === "number" ? res.pagingMetadata.total : offset + items.length;
  return { events: items, total, hasMore: hasMorePages(offset + items.length, total) };
}

/** The events of one page as a plain list (live events, soonest first, by default). */
export async function fetchEvents(options: ListOptions = {}): Promise<EventSummary[]> {
  return (await fetchEventsPage(options)).events;
}

/**
 * Every live date of a recurring series — the series' `recurringCategoryId` is a category every
 * occurrence carries, so this is the listing filtered to it.
 */
export async function fetchOccurrences(recurringCategoryId: string, { limit = 100 }: { limit?: number } = {}): Promise<EventSummary[]> {
  if (!recurringCategoryId) return [];
  return fetchEvents({ categoryId: recurringCategoryId, limit });
}

/**
 * The site's MANUAL categories (the filter pills). Runs on the visitor token: needs
 * WIX_EVENTS.READ_CATEGORIES, which Wix's own headless demo exercises client-side but which isn't
 * guaranteed for every site — callers catch a failure (403) and fall back to the categories on the
 * loaded events.
 * POST /events/v1/categories/query  { query: { filter: { states: { $hasSome: ["MANUAL"] } }, paging: { limit: 100 } } }  → { categories }
 */
export async function fetchCategories(): Promise<EventCategory[]> {
  const res = await wixRequest<Raw>("/events/v1/categories/query", { body: { query: categoriesQuery() } });
  return toCategories(res?.categories);
}

/**
 * One event by URL slug; null when the slug doesn't resolve (EVENT_NOT_FOUND, 404) — a real 404,
 * never a fallback to another event. The response is WRAPPED: { event }.
 * GET /events/v3/events/slug/{slug}?fields=DETAILS&fields=TEXTS&fields=REGISTRATION&fields=URLS&fields=CATEGORIES&fields=FORM
 */
export async function fetchEventBySlug(slug: string): Promise<EventDetail | null> {
  try {
    const res = await wixRequest<Raw>(`/events/v3/events/slug/${encodeURIComponent(slug)}`, { method: "GET", query: { fields: DETAIL_FIELDS } });
    return res?.event ? toDetail(res.event, imgSrc) : null;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

/**
 * One event by id — the post-checkout confirmation read (the thank-you URL carries
 * `?orderNumber=&eventId=`). On REST this response is WRAPPED too: { event } (the SDK's getEvent
 * is the unwrapped one).  GET /events/v3/events/{eventId}?fields=…
 */
export async function fetchEventById(eventId: string): Promise<EventDetail | null> {
  try {
    const res = await wixRequest<Raw>(`/events/v3/events/${encodeURIComponent(eventId)}`, { method: "GET", query: { fields: DETAIL_FIELDS } });
    const raw: Raw | undefined = res?.event;
    return raw && rawId(raw) ? toDetail(raw, imgSrc) : null;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}
