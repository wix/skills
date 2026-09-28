// Service reads over REST — the twin of app/wix/bookings/services.ts. Same exports, same DTOs; the
// rules and mappers come from services-core (the SAME file the SDK transport uses, deployed flat
// next to this one by deploy.mjs --stack static), so this file is only the transport: one fetch with
// a literal body per function. Every call here is safe from a browser with a visitor token.
// Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-categories.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-locations.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import {
  BOOKINGS_APP_ID,
  CATEGORIES_QUERY,
  LOCATIONS_QUERY,
  OTHER_LOCATIONS_ID,
  SERVICES_CONDITIONAL_FIELDS,
  SERVICES_PAGE_SIZE,
  STAFF_RESOURCE_TYPE_ID,
  hasMorePage,
  isKnownType,
  servicesFilter,
  toCategories,
  toDetail,
  toLocationOptions,
  toSummary,
  type Raw,
  type ServicesFilterOptions,
} from "./services-core.js";
import type { BookingCategory, LocationOption, ServiceDetail, ServiceSummary } from "./types.js";

export { BOOKINGS_APP_ID, OTHER_LOCATIONS_ID, SERVICES_PAGE_SIZE, STAFF_RESOURCE_TYPE_ID };

export interface FetchServicesOptions extends ServicesFilterOptions {
  limit?: number;
  offset?: number;
}

export interface ServicesPage {
  items: ServiceSummary[];
  /** Another page follows — pass `offset + items.length`. */
  hasMore: boolean;
}

// POST /bookings/v2/services/query  { query: { filter, paging: { limit, offset } }, conditionalFields }
async function queryServices(filter: ServicesFilterOptions, limit: number, offset: number): Promise<Raw> {
  return wixRequest<Raw>("/bookings/v2/services/query", {
    body: { query: { filter: servicesFilter(filter), paging: { limit, offset } }, conditionalFields: SERVICES_CONDITIONAL_FIELDS },
  });
}

/**
 * One page of bookable services (this app's, never hidden — filtered by the server), optionally one
 * category and/or one business location (or OTHER_LOCATIONS_ID for custom/customer locations),
 * mapped to grid-ready DTOs. Wix pages 20 at a time; `hasMore` says whether to ask for the next.
 */
export async function fetchServices({ limit = SERVICES_PAGE_SIZE, offset = 0, categoryId, locationId }: FetchServicesOptions = {}): Promise<ServicesPage> {
  const res = await queryServices({ categoryId, locationId }, limit, offset);
  const raws = ((res?.services ?? []) as Raw[]).filter(isKnownType);
  return { items: raws.map((s) => toSummary(s, imgSrc)), hasMore: hasMorePage(res?.pagingMetadata, offset, (res?.services ?? []).length, limit) };
}

/** One service by its URL slug (mainSlug.name) — a query with the slug in the filter. Null when not found. */
export async function fetchServiceBySlug(slug: string): Promise<ServiceDetail | null> {
  const raw = ((await queryServices({ slug }, 1, 0))?.services ?? [])[0] as Raw | undefined;
  return raw && isKnownType(raw) ? toDetail(raw, imgSrc) : null;
}

/**
 * Service categories for a filter bar — only categories that hold a bookable service, in the owner's
 * order. Non-fatal (empty array on failure).
 * POST /bookings/v2/services/categories/query  { filter: { services: {} } }
 */
export async function fetchBookingCategories(): Promise<BookingCategory[]> {
  try {
    const res = await wixRequest<Raw>("/bookings/v2/services/categories/query", { body: CATEGORIES_QUERY });
    return toCategories((res?.categories ?? []) as Raw[]);
  } catch {
    return [];
  }
}

/**
 * Business locations that host a visible service (a listing filter, sorted by name) plus whether any
 * service is held at a custom/customer location (the OTHER_LOCATIONS_ID bucket). Non-fatal.
 * POST /bookings/v2/services/locations/query  { filter: { services: { appId, hidden: false } } }
 */
export async function fetchLocations(): Promise<{ locations: LocationOption[]; hasOtherLocations: boolean }> {
  try {
    const res = await wixRequest<Raw>("/bookings/v2/services/locations/query", { body: LOCATIONS_QUERY });
    return toLocationOptions(res);
  } catch {
    return { locations: [], hasOtherLocations: false };
  }
}
