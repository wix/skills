// Event reads (Wix Events V3, the `wixEventsV2` module; Categories v1) over the SDK — the only
// file that touches raw event entities on this transport. Everything it returns is a plain DTO
// from ./types. The rules and mappers live in ./events-core (shared with the REST twin in
// templates/events/rest/); this file is the transport only. Copy as-is; extend by adding
// functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/query-categories.md
import { categories as categoriesModule, wixEventsV2 } from "@wix/events";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import {
  CATEGORY_ID_FIELD_SDK,
  CATEGORY_STATES,
  CREATED_DATE_FIELD_SDK,
  DEFAULT_PAGE_SIZE,
  DETAIL_FIELDS,
  EVENTS_APP_ID,
  LIST_FIELDS,
  START_DATE_FIELD,
  hasMorePages,
  listQuery,
  rawId,
  statusesFor,
  toCategories,
  toDetail,
  toSummary,
  type ListOptions,
  type Raw,
} from "./events-core";
import type { EventCategory, EventDetail, EventSummary } from "./types";

export { EVENTS_APP_ID, type ListOptions };

const events = wixModule(wixEventsV2);
const categories = wixModule(categoriesModule);

/** One page of a listing plus what a "load more" needs. */
export interface EventsPage {
  events: EventSummary[];
  /** Matching events overall (the page is `events`). */
  total: number;
  hasMore: boolean;
}

/**
 * One page of events: UPCOMING/STARTED by default (`status: "past"` for ENDED, `"all"` for both),
 * soonest first then newest first, optionally one category (server-side), `limit` (default 20) from
 * `offset`. The query builder, never a flat/REST `{ query: {...} }` body (the SDK silently ignores
 * the unknown key and returns zero events). Always set a positive limit — it defaults to 0, which
 * also returns zero events with no error.
 */
export async function fetchEventsPage(options: ListOptions = {}): Promise<EventsPage> {
  const { limit = DEFAULT_PAGE_SIZE, offset = 0, categoryId, status } = options;
  listQuery(options); // one validation of limit/offset for both transports
  let query = events
    .queryEvents({ fields: LIST_FIELDS as any })
    .in("status", statusesFor(status))
    .ascending(START_DATE_FIELD as any)
    .descending(CREATED_DATE_FIELD_SDK as any)
    .limit(limit)
    .skip(offset);
  // `categories._id` isn't in the builder's typed field list, but the server filters on it (Wix's own listing does this).
  if (categoryId) query = (query as any).in(CATEGORY_ID_FIELD_SDK, [categoryId]);
  const res: Raw = await query.find();
  const items = ((res.items ?? []) as Raw[]).map((e) => toSummary(e, imgSrc));
  const total = typeof res.totalCount === "number" ? res.totalCount : offset + items.length;
  return { events: items, total, hasMore: hasMorePages(offset + items.length, total) };
}

/** The events of one page as a plain list (live events, soonest first, by default). */
export async function fetchEvents(options: ListOptions = {}): Promise<EventSummary[]> {
  return (await fetchEventsPage(options)).events;
}

/**
 * Every live date of a recurring series — the series' `recurringCategoryId` is a category every
 * occurrence carries, so this is the listing filtered to it (Wix's occurrence list does the same).
 */
export async function fetchOccurrences(recurringCategoryId: string, { limit = 100 }: { limit?: number } = {}): Promise<EventSummary[]> {
  if (!recurringCategoryId) return [];
  return fetchEvents({ categoryId: recurringCategoryId, limit });
}

/**
 * The site's MANUAL categories (the filter pills), as Wix's listing loads them in the browser.
 * Runs on the visitor token: Query Categories needs WIX_EVENTS.READ_CATEGORIES, which Wix's own
 * headless demo calls client-side — but it isn't guaranteed for every site's visitor scope, so
 * callers catch a failure and fall back to the categories on the loaded events.
 */
export async function fetchCategories(): Promise<EventCategory[]> {
  const res: Raw = await categories
    .queryCategories()
    .hasSome("states", [...CATEGORY_STATES])
    .limit(100)
    .find();
  return toCategories(res.items);
}

/** Fetch one event by its URL slug. Null when not found. */
export async function fetchEventBySlug(slug: string): Promise<EventDetail | null> {
  try {
    // getEventBySlug returns a WRAPPED { event } — unlike getEvent below.
    const res: Raw = await events.getEventBySlug(slug, { fields: DETAIL_FIELDS as any });
    const raw = res?.event;
    return raw ? toDetail(raw as Raw, imgSrc) : null;
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
    return rawId(raw) ? toDetail(raw, imgSrc) : null;
  } catch {
    return null;
  }
}
