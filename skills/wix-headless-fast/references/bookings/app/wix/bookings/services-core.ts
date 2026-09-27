// Service rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./services.ts
// (the SDK, managed Astro and React) and the REST twin in references/bookings/rest/services.ts
// (fetch, a static site or a port to another language). Every rule about price, "Free", duration,
// media, staff, and the payment option lives HERE, once. A raw entity may come from the SDK (`_id`,
// media as a `wix:image://` string) or from REST (`id`, media as an { id, url, width, height }
// object); the mappers accept both. Imports are type-only so a strip to JS emits no imports.
import type { BookingCategory, ServiceDetail, ServiceSummary, ServiceType } from "./types";

/** A raw Services V2 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** The Wix Bookings app id — the cart's catalogReference.appId and the services filter. */
export const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
/** Staff-member resource type id (ANY_RESOURCE fallback + staff filtering). */
export const STAFF_RESOURCE_TYPE_ID = "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155";
/** Requested on every service read — without it `staffMemberDetails` is absent and the DTO's staff is []. */
export const SERVICES_CONDITIONAL_FIELDS = ["STAFF_MEMBER_DETAILS"] as const;

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

/** The filter every services read shares: this app's services, optionally one slug (`mainSlug.name`). */
export function servicesFilter(slug?: string): Raw {
  return { appId: BOOKINGS_APP_ID, ...(slug ? { "mainSlug.name": slug } : {}) };
}

/** Hidden services never reach a tile — the same rule on both transports. */
export const isVisible = (raw: Raw): boolean => !raw.hidden;

/**
 * A media value the image helpers can resolve. The SDK hands over a `wix:image://v1/<id>/<name>#…`
 * string (or an https URL); REST hands over the image OBJECT with a bare file id — rebuilt into the
 * same `wix:image://` form the SDK produces, so imgSrc scales both identically.
 */
export function mediaValue(image: unknown): unknown {
  if (!image || typeof image === "string") return image;
  const o = image as Raw;
  const url: string = o.url ?? "";
  if (/^(https?:|wix:image:)/.test(url)) return url;
  if (o.id) return `wix:image://v1/${o.id}/${encodeURIComponent(o.filename ?? "")}#originWidth=${o.width ?? 0}&originHeight=${o.height ?? 0}`;
  return url;
}

export function formatPrice(value: string | undefined, currency: string | undefined): string {
  if (value == null || value === "" || Number(value) === 0) return "Free";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(value));
  } catch {
    return `${value} ${currency ?? ""}`.trim();
  }
}

export function toSummary(raw: Raw, imgSrc: ImgSrc): ServiceSummary {
  const price = raw.payment?.fixed?.price;
  const free = raw.payment?.rateType === "NO_FEE" || !price?.value || Number(price.value) === 0;
  return {
    id: rawId(raw),
    slug: raw.mainSlug?.name ?? raw.supportedSlugs?.[0]?.name ?? "",
    name: raw.name ?? "",
    tagLine: raw.tagLine ?? "",
    type: (raw.type ?? "APPOINTMENT") as ServiceType,
    price: free ? "Free" : formatPrice(price?.value, price?.currency),
    free,
    durationMinutes: raw.schedule?.availabilityConstraints?.sessionDurations?.[0] ?? null,
    imageUrl: imgSrc(mediaValue(raw.media?.mainMedia?.image), 800, 800),
    categoryId: rawId(raw.category) || null,
    staff: ((raw.staffMemberDetails?.staffMembers ?? []) as Raw[])
      .map((m) => ({ id: m.staffMemberId ?? "", name: m.name ?? "" }))
      .filter((m) => m.id),
  };
}

export function toDetail(raw: Raw, imgSrc: ImgSrc): ServiceDetail {
  const summary = toSummary(raw, imgSrc);
  const online = raw.payment?.options?.online === true;
  const inPerson = raw.payment?.options?.inPerson === true;
  // Derive — never hardcode "ONLINE": a free/pay-in-person service booked ONLINE gets
  // rejected by the cart with INSUFFICIENT_INVENTORY.
  const paymentOption: "ONLINE" | "OFFLINE" = !online && inPerson ? "OFFLINE" : "ONLINE";
  return {
    ...summary,
    description: raw.description ?? "",
    formId: rawId(raw.form) || null,
    paymentOption,
    cancellationFeeEnabled: raw.bookingPolicy?.cancellationFeePolicy?.enabled === true,
  };
}

export function toCategory(raw: Raw): BookingCategory {
  return { id: rawId(raw), name: raw.name ?? "" };
}
