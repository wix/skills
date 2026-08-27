// Service reads (Wix Bookings Services V2) — the only file that touches raw service
// entities. Everything it returns is a plain DTO from ./types. Copy as-is; extend by adding
// functions, not by editing these.
import { services as servicesModule, categoriesV2 } from "@wix/bookings";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import type { BookingCategory, ServiceDetail, ServiceSummary, ServiceType } from "./types";

const services = wixModule(servicesModule);
const categories = wixModule(categoriesV2);

/** The Wix Bookings app id — the cart's catalogReference.appId and the services filter. */
export const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
/** Staff-member resource type id (ANY_RESOURCE fallback + staff filtering). */
export const STAFF_RESOURCE_TYPE_ID = "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155";

type Raw = Record<string, any>;

function formatPrice(value: string | undefined, currency: string | undefined): string {
  if (value == null || value === "" || Number(value) === 0) return "Free";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(value));
  } catch {
    return `${value} ${currency ?? ""}`.trim();
  }
}

function toSummary(raw: Raw): ServiceSummary {
  const price = raw.payment?.fixed?.price;
  const free = raw.payment?.rateType === "NO_FEE" || !price?.value || Number(price.value) === 0;
  return {
    id: raw._id ?? "",
    slug: raw.mainSlug?.name ?? raw.supportedSlugs?.[0]?.name ?? "",
    name: raw.name ?? "",
    tagLine: raw.tagLine ?? "",
    type: (raw.type ?? "APPOINTMENT") as ServiceType,
    price: free ? "Free" : formatPrice(price?.value, price?.currency),
    free,
    durationMinutes: raw.schedule?.availabilityConstraints?.sessionDurations?.[0] ?? null,
    imageUrl: imgSrc(raw.media?.mainMedia?.image, 800, 800),
    categoryId: raw.category?._id ?? null,
    staff: (raw.staffMemberDetails?.staffMembers ?? [])
      .map((m: Raw) => ({ id: m.staffMemberId ?? "", name: m.name ?? "" }))
      .filter((m: { id: string }) => m.id),
  };
}

function toDetail(raw: Raw): ServiceDetail {
  const summary = toSummary(raw);
  const online = raw.payment?.options?.online === true;
  const inPerson = raw.payment?.options?.inPerson === true;
  // Derive — never hardcode "ONLINE": a free/pay-in-person service booked ONLINE gets
  // rejected by the cart with INSUFFICIENT_INVENTORY.
  const paymentOption: "ONLINE" | "OFFLINE" = !online && inPerson ? "OFFLINE" : "ONLINE";
  return {
    ...summary,
    description: raw.description ?? "",
    formId: raw.form?._id ?? null,
    paymentOption,
    cancellationFeeEnabled: raw.bookingPolicy?.cancellationFeePolicy?.enabled === true,
  };
}

/** List bookable services (hidden ones filtered), mapped to grid-ready DTOs. */
export async function fetchServices({ limit = 100 } = {}): Promise<ServiceSummary[]> {
  const res = await services
    .queryServices({ conditionalFields: ["STAFF_MEMBER_DETAILS"] as any })
    .eq("appId", BOOKINGS_APP_ID)
    .limit(limit)
    .find();
  return (res.items ?? []).filter((s: Raw) => !s.hidden).map((s: Raw) => toSummary(s));
}

/** Fetch one service by its URL slug (mainSlug.name). Null when not found. */
export async function fetchServiceBySlug(slug: string): Promise<ServiceDetail | null> {
  const res = await services
    .queryServices({ conditionalFields: ["STAFF_MEMBER_DETAILS"] as any })
    .eq("mainSlug.name", slug)
    .eq("appId", BOOKINGS_APP_ID)
    .limit(1)
    .find();
  const raw = res.items?.[0];
  return raw ? toDetail(raw as Raw) : null;
}

/** Service categories for a filter bar — non-fatal (empty array on failure). */
export async function fetchBookingCategories(): Promise<BookingCategory[]> {
  try {
    const res = await categories.queryCategories().find();
    return (res.items ?? []).map((c: Raw) => ({ id: c._id ?? "", name: c.name ?? "" })).filter((c) => c.id);
  } catch {
    return [];
  }
}
