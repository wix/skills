// Event reads over REST — the twin of app/wix/events/events.ts. Same exports, same DTOs; the rules
// and mappers come from events-core (the SAME file the SDK transport uses, deployed flat next to
// this one by deploy.mjs --stack static), so this file is only the transport: one fetch with a
// literal body per function. Every call here is safe from a browser with a visitor token.
// Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event.md
import { WixApiError, wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { DETAIL_FIELDS, EVENTS_APP_ID, LIST_FIELDS, listQuery, rawId, toDetail, toSummary, type Raw } from "./events-core.js";
import type { EventDetail, EventSummary } from "./types.js";

export { EVENTS_APP_ID };

const notFound = (e: unknown): boolean => e instanceof WixApiError && e.status === 404;

/**
 * Live (UPCOMING/STARTED) events, soonest first. The limit is always sent: `paging.limit`
 * defaults to 0 and a bare query answers `total: N, events: []` with no error.
 * POST /events/v3/events/query  { query: { filter: { status: { $in } }, sort, paging: { limit } }, fields }
 */
export async function fetchEvents({ limit = 100 } = {}): Promise<EventSummary[]> {
  const res = await wixRequest<Raw>("/events/v3/events/query", { body: { query: listQuery({ limit }), fields: LIST_FIELDS } });
  return ((res?.events ?? []) as Raw[]).map((e) => toSummary(e, imgSrc));
}

/**
 * One event by URL slug; null when the slug doesn't resolve (EVENT_NOT_FOUND, 404) — a real 404,
 * never a fallback to another event. The response is WRAPPED: { event }.
 * GET /events/v3/events/slug/{slug}?fields=DETAILS&fields=TEXTS&fields=REGISTRATION&fields=URLS&fields=CATEGORIES
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
