import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md

/**
 * Wix Events V3 Event — key fields for list cards and the detail page.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/event-object.md
 *
 *   id {string}, title {string}, slug {string},
 *   status {string} — "UPCOMING"|"STARTED"|"ENDED"|"CANCELED"|"DRAFT" (only UPCOMING/STARTED are live),
 *   shortDescription {string} — PLAIN-TEXT teaser, safe to render directly (DETAILS fieldset),
 *   description {object} — RICH CONTENT (Ricos), shape { nodes: [...] } — NOT a string (TEXTS fieldset,
 *     returned by getEventBySlug). Render it with a Ricos viewer (@wix/ricos) or walk `nodes` to extract
 *     text; NEVER call string methods (.split/.slice/.substring/.trim) on it — that crashes the page.
 *     For a plain-string teaser use shortDescription instead.
 *   detailedDescription {string} — legacy plain/HTML description (TEXTS fieldset); prefer description/shortDescription,
 *   mainImage {object} — { id, url, width, height, altText } (DETAILS fieldset),
 *   dateAndTimeSettings {object}:
 *     startDate, endDate {string} — ISO-8601; absent when dateAndTimeTbd is true,
 *     timeZoneId {string} — IANA tz,
 *     formatted.dateAndTime {string} — ready-to-render human string,
 *   location {object}: type "VENUE"|"ONLINE", name {string}, address {object}, locationTbd {boolean},
 *   registration {object} (REGISTRATION fieldset):
 *     type {string} — "RSVP"|"TICKETING"|"EXTERNAL"|"NONE",
 *     status {string} — only OPEN_* statuses accept new registrations,
 *     rsvp.responseType — "YES_AND_NO" allows a "NO" reply,
 *     tickets.currency, tickets.lowestPrice, tickets.soldOut,
 *     external.url — link out when type === "EXTERNAL",
 *   eventPageUrl {object} — { base, path } (URLS fieldset) — needed for getTicketCheckoutUrl,
 *   form {object} — registration form controls (FORM fieldset),
 *   calendarUrls {object} — { google, ics } (DETAILS fieldset)
 *
 * Category: { id, label, slug, counts.assignedEventsCount }
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories
 */

const LIST_FIELDS = ["DETAILS", "REGISTRATION", "URLS"];
const DETAIL_FIELDS = ["DETAILS", "TEXTS", "REGISTRATION", "URLS", "FORM"];

/**
 * Query live (UPCOMING/STARTED) events for a listing grid, one page. Sorted soonest first.
 * Uses offset paging — response carries total for empty state and "load more" math.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events.md
 * @param {{ limit?: number, offset?: number, status?: string[] }} [options]
 * @returns {Promise<{ events: object[], total: number, offset: number, nextOffset: number|null }>}
 */
export async function queryEvents({ limit = 50, offset = 0, status = ["UPCOMING", "STARTED"] } = {}) {
  const res = await wixApiRequest("/events/v3/events/query", {
    method: "POST",
    body: {
      query: {
        filter: { status: { $in: status } },
        sort: [{ fieldName: "dateAndTimeSettings.startDate", order: "ASC" }],
        paging: { limit, offset },
      },
      fields: LIST_FIELDS,
    },
  });
  const events = res?.events ?? [];
  const total = res?.pagingMetadata?.total ?? events.length;
  const nextOffset = offset + events.length < total ? offset + events.length : null;
  return { events, total, offset, nextOffset };
}

/**
 * Fetch a single event by its URL slug, with full detail-page fields (description, form, page URL).
 * Returns null if not found — show a not-found state, never invent an event.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event-by-slug.md
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getEventBySlug(slug) {
  try {
    const res = await wixApiRequest(`/events/v3/events/slug/${encodeURIComponent(slug)}`, {
      method: "GET",
      query: { fields: DETAIL_FIELDS },
    });
    return res?.event ?? null;
  } catch {
    return null;
  }
}

/**
 * Total number of live events. Used for empty-state logic (0 → prompt user to publish events).
 * @param {string[]} [status]
 * @returns {Promise<number>}
 */
export async function countUpcomingEvents(status = ["UPCOMING", "STARTED"]) {
  const res = await wixApiRequest("/events/v3/events/query", {
    method: "POST",
    body: { query: { filter: { status: { $in: status } }, paging: { limit: 1, offset: 0 } } },
  });
  return res?.pagingMetadata?.total ?? 0;
}

/**
 * Query event categories for a category menu/filter. counts.assignedEventsCount tells you
 * how many events are in each category.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/query-categories.md
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<{ categories: object[], total: number }>}
 */
export async function queryEventCategories({ limit = 100, offset = 0 } = {}) {
  const res = await wixApiRequest("/events/v1/categories/query", {
    method: "POST",
    body: { query: { paging: { limit, offset } }, fieldset: ["COUNTS"] },
  });
  return {
    categories: res?.categories ?? [],
    total: res?.metaData?.total ?? (res?.categories?.length ?? 0),
  };
}

/**
 * List live events assigned to a category, one page. Same card fields as queryEvents.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/list-events-by-category.md
 * @param {string} categoryId  Category GUID from queryEventCategories.
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<{ events: object[], total: number, offset: number, nextOffset: number|null }>}
 */
export async function listEventsByCategory(categoryId, { limit = 50, offset = 0 } = {}) {
  const res = await wixApiRequest(`/events/v3/events/category/${encodeURIComponent(categoryId)}`, {
    method: "GET",
    query: {
      fields: LIST_FIELDS,
      "paging.limit": String(limit),
      "paging.offset": String(offset),
    },
  });
  const events = res?.events ?? [];
  const total = res?.pagingMetadata?.total ?? events.length;
  const nextOffset = offset + events.length < total ? offset + events.length : null;
  return { events, total, offset, nextOffset };
}
