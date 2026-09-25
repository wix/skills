// Plan rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./plans.ts (the
// SDK, managed Astro and React) and the REST twin in references/pricing-plans/rest/plans.ts
// (fetch, a static site or a port to another language). Every rule about prices, billing labels,
// perks, buyability, images lives HERE, once. A raw plan may come from the SDK (`_id`, image as a
// `wix:image://` string) or from REST (`id`, image as { id, url }); the mappers accept both.
// Imports are type-only so a strip to JS emits no imports.
import type { PlanDetail, PlanSummary } from "./types";

/** A raw Plans V3 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

const id = (raw: Raw | undefined): string => raw?._id ?? raw?.id ?? "";

// ---- query ----------------------------------------------------------------------------------------

export interface PlansQueryOptions {
  /** 1–100, default 100 (the grid shows every public plan). */
  limit?: number;
  /** One plan by URL slug (the detail page). */
  slug?: string;
}

/**
 * The Query Plans body both transports send: only PUBLIC plans (a HIDDEN plan is merchant-assigned
 * and never listed), cursor paging, and the slug when one plan is wanted. The SDK builder spells the
 * same filter as `.eq("visibility", "PUBLIC")`.
 */
export function plansQuery({ limit = 100, slug }: PlansQueryOptions = {}): Raw {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100.");
  const filter: Raw = { visibility: "PUBLIC" };
  if (slug) filter.slug = slug;
  return { filter, cursorPaging: { limit } };
}

// ---- price rules ----------------------------------------------------------------------------------

/** "€29.00" in the visitor's locale for the plan's currency; "Free" for no or zero amount. Never assume USD. */
export function formatPrice(value: string | undefined, currency: string | undefined): string {
  if (value == null || value === "" || Number(value) === 0) return "Free";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(value));
  } catch {
    return `${value} ${currency ?? ""}`.trim();
  }
}

/**
 * billingTerms → a display label. billingCycle.count is a STRING on both transports ("1") — Number()
 * it. No billingCycle → a one-time payment; endType CYCLES_COMPLETED with billingCycleCount 1 also
 * bills once; more cycles read "per month × 6".
 */
export function billingLabel(terms: Raw | undefined): string {
  const cycle = terms?.billingCycle;
  if (!cycle) return "one-time";
  const cyclesTotal = Number(terms?.cyclesCompletedDetails?.billingCycleCount ?? 0);
  if (terms?.endType === "CYCLES_COMPLETED" && cyclesTotal === 1) return "one-time";
  const count = Number(cycle.count ?? 1) || 1;
  const period = String(cycle.period ?? "MONTH").toLowerCase();
  const base = count === 1 ? `per ${period}` : `every ${count} ${period}s`;
  return terms?.endType === "CYCLES_COMPLETED" && cyclesTotal > 1 ? `${base} × ${cyclesTotal}` : base;
}

/**
 * The plan's image as a value imgSrc resolves: the SDK hands a `wix:image://…` string; REST hands
 * an Image object { id, url } — its url when present, else the media id in the wix:image form the
 * URL builder scales. "" when the plan has no image.
 */
export function planImage(raw: Raw): string {
  const img = raw.image;
  if (!img) return "";
  if (typeof img === "string") return img;
  if (img.url) return String(img.url);
  return img.id ? `wix:image://v1/${img.id}/${img.id}` : "";
}

// ---- DTO mappers -----------------------------------------------------------------------------------

/**
 * The price is DISPLAY-ONLY: a decimal string at pricingVariants[0].pricingStrategies[0]
 * .flatRate.amount ("0" = free), paired with plan.currency (site-derived). Wix settles the actual
 * charge, tax, and schedule at the hosted checkout.
 */
export function toSummary(raw: Raw, imgSrc: ImgSrc): PlanSummary {
  const variant: Raw = raw.pricingVariants?.[0] ?? {};
  const amount: string | undefined = variant.pricingStrategies?.[0]?.flatRate?.amount;
  const free = amount == null || Number(amount) === 0;
  return {
    id: id(raw),
    slug: raw.slug ?? "",
    name: raw.name ?? "",
    description: raw.description ?? "",
    price: free ? "Free" : formatPrice(amount, raw.currency),
    free,
    billing: free ? "" : billingLabel(variant.billingTerms),
    freeTrialDays: variant.freeTrialDays || null,
    perks: ((raw.perks ?? []) as Raw[]).map((p) => p.description ?? "").filter((d: string) => d),
    buyable: raw.buyable === true, // a PUBLIC plan can still be merchant-assigned — no CTA then
    imageUrl: imgSrc(planImage(raw), 800, 800),
  };
}

export function toDetail(raw: Raw, imgSrc: ImgSrc): PlanDetail {
  return { ...toSummary(raw, imgSrc), termsAndConditions: raw.termsAndConditions ?? "" };
}
