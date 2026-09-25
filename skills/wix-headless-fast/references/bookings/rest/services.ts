// Service reads over REST — the twin of app/wix/bookings/services.ts. Same exports, same DTOs; the
// rules and mappers come from services-core (the SAME file the SDK transport uses, deployed flat
// next to this one by deploy.mjs --stack static), so this file is only the transport: one fetch with
// a literal body per function. Every call here is safe from a browser with a visitor token.
// Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/query-categories.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import {
  BOOKINGS_APP_ID,
  SERVICES_CONDITIONAL_FIELDS,
  STAFF_RESOURCE_TYPE_ID,
  isVisible,
  servicesFilter,
  toCategory,
  toDetail,
  toSummary,
  type Raw,
} from "./services-core.js";
import type { BookingCategory, ServiceDetail, ServiceSummary } from "./types.js";

export { BOOKINGS_APP_ID, STAFF_RESOURCE_TYPE_ID };

// POST /bookings/v2/services/query  { query: { filter, paging: { limit } }, conditionalFields }
async function queryServices(slug: string | undefined, limit: number): Promise<Raw[]> {
  const res = await wixRequest<Raw>("/bookings/v2/services/query", {
    body: { query: { filter: servicesFilter(slug), paging: { limit } }, conditionalFields: SERVICES_CONDITIONAL_FIELDS },
  });
  return (res?.services ?? []) as Raw[];
}

/** List bookable services (hidden ones filtered), mapped to grid-ready DTOs. */
export async function fetchServices({ limit = 100 } = {}): Promise<ServiceSummary[]> {
  return (await queryServices(undefined, limit)).filter(isVisible).map((s) => toSummary(s, imgSrc));
}

/** One service by its URL slug (mainSlug.name) — a query with the slug in the filter. Null when not found. */
export async function fetchServiceBySlug(slug: string): Promise<ServiceDetail | null> {
  const raw = (await queryServices(slug, 1))[0];
  return raw ? toDetail(raw, imgSrc) : null;
}

/**
 * Service categories for a filter bar — non-fatal (empty array on failure).
 * POST /bookings/v2/categories/query  { query: {} }
 */
export async function fetchBookingCategories(): Promise<BookingCategory[]> {
  try {
    const res = await wixRequest<Raw>("/bookings/v2/categories/query", { body: { query: {} } });
    return ((res?.categories ?? []) as Raw[]).map(toCategory).filter((c) => c.id);
  } catch {
    return [];
  }
}
