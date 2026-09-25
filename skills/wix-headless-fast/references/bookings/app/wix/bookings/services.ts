// Service reads (Wix Bookings Services V2) over the SDK — the only file that touches raw service
// entities on this transport. Everything it returns is a plain DTO from ./types. The rules and
// mappers live in ./services-core (shared with the REST twin in references/bookings/rest/); this
// file is the transport only. Copy as-is; extend by adding functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/query-categories.md
import { services as servicesModule, categoriesV2 } from "@wix/bookings";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import {
  BOOKINGS_APP_ID,
  SERVICES_CONDITIONAL_FIELDS,
  STAFF_RESOURCE_TYPE_ID,
  isVisible,
  toCategory,
  toDetail,
  toSummary,
  type Raw,
} from "./services-core";
import type { BookingCategory, ServiceDetail, ServiceSummary } from "./types";

export { BOOKINGS_APP_ID, STAFF_RESOURCE_TYPE_ID };

const services = wixModule(servicesModule);
const categories = wixModule(categoriesV2);

/** List bookable services (hidden ones filtered), mapped to grid-ready DTOs. */
export async function fetchServices({ limit = 100 } = {}): Promise<ServiceSummary[]> {
  const res = await services
    .queryServices({ conditionalFields: SERVICES_CONDITIONAL_FIELDS as any })
    .eq("appId", BOOKINGS_APP_ID)
    .limit(limit)
    .find();
  return ((res.items ?? []) as Raw[]).filter(isVisible).map((s) => toSummary(s, imgSrc));
}

/** Fetch one service by its URL slug (mainSlug.name). Null when not found. */
export async function fetchServiceBySlug(slug: string): Promise<ServiceDetail | null> {
  const res = await services
    .queryServices({ conditionalFields: SERVICES_CONDITIONAL_FIELDS as any })
    .eq("mainSlug.name", slug)
    .eq("appId", BOOKINGS_APP_ID)
    .limit(1)
    .find();
  const raw = res.items?.[0];
  return raw ? toDetail(raw as Raw, imgSrc) : null;
}

/** Service categories for a filter bar — non-fatal (empty array on failure). */
export async function fetchBookingCategories(): Promise<BookingCategory[]> {
  try {
    const res = await categories.queryCategories().find();
    return ((res.items ?? []) as Raw[]).map(toCategory).filter((c) => c.id);
  } catch {
    return [];
  }
}
