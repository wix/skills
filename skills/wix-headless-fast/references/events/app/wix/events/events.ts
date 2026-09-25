// Event reads (Wix Events V3, the `wixEventsV2` module) over the SDK — the only file that touches
// raw event entities on this transport. Everything it returns is a plain DTO from ./types. The
// rules and mappers live in ./events-core (shared with the REST twin in references/events/rest/);
// this file is the transport only. Copy as-is; extend by adding functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event-by-slug.md
import { wixEventsV2 } from "@wix/events";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { DETAIL_FIELDS, EVENTS_APP_ID, LIST_FIELDS, LIVE_STATUSES, START_DATE_FIELD, rawId, toDetail, toSummary, type Raw } from "./events-core";
import type { EventDetail, EventSummary } from "./types";

export { EVENTS_APP_ID };

const events = wixModule(wixEventsV2);

/** List live (UPCOMING/STARTED) events, soonest first, mapped to grid-ready DTOs. */
export async function fetchEvents({ limit = 100 } = {}): Promise<EventSummary[]> {
  // The query builder, never a flat/REST `{ query: {...} }` body (the SDK silently ignores
  // the unknown key and returns zero events). Always set a positive limit — it defaults to 0,
  // which also returns zero events with no error.
  const res = await events
    .queryEvents({ fields: LIST_FIELDS as any })
    .in("status", [...LIVE_STATUSES]) // never list or link a past event — it isn't registerable
    .ascending(START_DATE_FIELD as any)
    .limit(limit)
    .find();
  return (res.items ?? []).map((e: Raw) => toSummary(e, imgSrc));
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
