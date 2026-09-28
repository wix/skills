// Service reads (Wix Bookings Services V2) over the SDK — the only file that touches raw service
// entities on this transport. Everything it returns is a plain DTO from ./types. The rules and
// mappers live in ./services-core (shared with the REST twin in templates/bookings/rest/); this
// file is the transport only. Copy as-is; extend by adding functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-categories.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-locations.md
import { services as servicesModule } from "@wix/bookings";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import {
  BOOKINGS_APP_ID,
  CATEGORIES_QUERY,
  LOCATIONS_QUERY,
  OTHER_LOCATIONS_ID,
  SERVICES_CONDITIONAL_FIELDS,
  SERVICES_PAGE_SIZE,
  STAFF_RESOURCE_TYPE_ID,
  isKnownType,
  toCategories,
  toDetail,
  toLocationOptions,
  toSummary,
  type Raw,
  type ServicesFilterOptions,
} from "./services-core";
import type { BookingCategory, LocationOption, ServiceDetail, ServiceSummary } from "./types";

export { BOOKINGS_APP_ID, OTHER_LOCATIONS_ID, SERVICES_PAGE_SIZE, STAFF_RESOURCE_TYPE_ID };

const services = wixModule(servicesModule);

export interface FetchServicesOptions extends ServicesFilterOptions {
  limit?: number;
  offset?: number;
}

export interface ServicesPage {
  items: ServiceSummary[];
  /** Another page follows — pass `offset + items.length`. */
  hasMore: boolean;
}

/**
 * One page of bookable services (this app's, never hidden — filtered by the server), optionally one
 * category and/or one business location (or OTHER_LOCATIONS_ID for custom/customer locations),
 * mapped to grid-ready DTOs. Wix pages 20 at a time; `hasMore` says whether to ask for the next.
 */
export async function fetchServices({ limit = SERVICES_PAGE_SIZE, offset = 0, categoryId, locationId }: FetchServicesOptions = {}): Promise<ServicesPage> {
  let query = services
    .queryServices({ conditionalFields: SERVICES_CONDITIONAL_FIELDS as any })
    .eq("appId", BOOKINGS_APP_ID)
    .eq("hidden", false)
    .limit(limit)
    .skip(offset);
  if (categoryId) query = query.eq("category.id", categoryId);
  if (locationId === OTHER_LOCATIONS_ID) query = query.hasSome("locations.type" as any, ["CUSTOM", "CUSTOMER"] as any);
  else if (locationId) query = query.eq("locations.business.id" as any, locationId);
  const res = await query.find();
  return { items: ((res.items ?? []) as Raw[]).filter(isKnownType).map((s) => toSummary(s, imgSrc)), hasMore: res.hasNext() };
}

/** Fetch one service by its URL slug (mainSlug.name). Null when not found. */
export async function fetchServiceBySlug(slug: string): Promise<ServiceDetail | null> {
  const res = await services
    .queryServices({ conditionalFields: SERVICES_CONDITIONAL_FIELDS as any })
    .eq("mainSlug.name", slug)
    .eq("appId", BOOKINGS_APP_ID)
    .eq("hidden", false)
    .limit(1)
    .find();
  const raw = res.items?.[0] as Raw | undefined;
  return raw && isKnownType(raw) ? toDetail(raw, imgSrc) : null;
}

/**
 * Service categories for a filter bar — only categories that hold a bookable service, in the owner's
 * order. Non-fatal (empty array on failure).
 */
export async function fetchBookingCategories(): Promise<BookingCategory[]> {
  try {
    const res: Raw = await services.queryCategories(CATEGORIES_QUERY as any);
    return toCategories((res?.categories ?? []) as Raw[]);
  } catch {
    return [];
  }
}

/**
 * Business locations that host a visible service (a listing filter, sorted by name) plus whether any
 * service is held at a custom/customer location (the OTHER_LOCATIONS_ID bucket). Non-fatal.
 */
export async function fetchLocations(): Promise<{ locations: LocationOption[]; hasOtherLocations: boolean }> {
  try {
    const res: Raw = await services.queryLocations(LOCATIONS_QUERY as any);
    return toLocationOptions(res);
  } catch {
    return { locations: [], hasOtherLocations: false };
  }
}
