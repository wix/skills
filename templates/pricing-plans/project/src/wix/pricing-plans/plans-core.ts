// Plan rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./plans.ts (the
// SDK, managed Astro and React) and the REST twin in templates/pricing-plans/rest/plans.ts
// (fetch, a static site or a port to another language). Every rule about prices, fees, billing
// labels, duration, perks, buyability, images lives HERE, once. A raw plan may come from the SDK
// (`_id`, image as a `wix:image://` string) or from REST (`id`, image as { id, url }); the mappers
// accept both. Imports are type-only so a strip to JS emits no imports.
import type { PlanDetail, PlanFee, PlanSummary } from "./types";

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
  /** Specific plans by id (a featured strip, the plans a paywall requires). */
  ids?: string[];
}

/**
 * The Query Plans body both transports send: only PUBLIC plans (a HIDDEN plan is merchant-assigned
 * and never listed), cursor paging, the slug when one plan is wanted, `id: { $in }` for a set of
 * plans. REST filters on `id`; the SDK builder spells the same filters as `.eq("visibility",
 * "PUBLIC")`, `.eq("slug", slug)`, `.in("_id", ids)`.
 */
export function plansQuery({ limit = 100, slug, ids }: PlansQueryOptions = {}): Raw {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100.");
  const filter: Raw = { visibility: "PUBLIC" };
  if (slug) filter.slug = slug;
  if (ids) {
    if (!ids.length) throw new Error("At least one plan id is required.");
    filter.id = { $in: ids };
  }
  return { filter, cursorPaging: { limit } };
}

// ---- price rules ----------------------------------------------------------------------------------

export interface FormatOptions {
  /**
   * BCP 47 locale for the money strings. Default undefined = the runtime's locale — in a browser the
   * visitor's, on Astro SSR the SERVER's (baked into the DTO for every visitor). A brief with a known
   * market pins it ("de-DE").
   */
  locale?: string;
}

/**
 * A decimal-string amount → "€25.00" in the plan's currency; "" when the value isn't a finite
 * number (an absent fee amount). Never assumes USD: the currency is the plan's, site-derived.
 */
export function formatAmount(value: string | number | undefined, currency: string | undefined, locale?: string): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  // No currency → a bare number, never an assumed "$": the plan's currency is site-derived and always sent.
  if (!currency) return new Intl.NumberFormat(locale).format(n);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return `${value} ${currency}`;
  }
}

/** "€29.00" for the plan's currency; "Free" for a zero amount. Callers pass a valid amount — see `planAmount`. */
export function formatPrice(value: string | number, currency: string | undefined, locale?: string): string {
  return Number(value) === 0 ? "Free" : formatAmount(value, currency, locale);
}

/**
 * The plan's amount — `pricingVariants[0].pricingStrategies[0].flatRate.amount`, a decimal string
 * ("0" = free) — or undefined for a MALFORMED plan: no pricing variant, or an amount that isn't a
 * number. A malformed plan is dropped by the mappers (never rendered "Free" with a live CTA): the
 * hosted checkout would charge something the card didn't show.
 */
export function planAmount(raw: Raw): string | undefined {
  const variant: Raw | undefined = raw.pricingVariants?.[0];
  const amount = variant?.pricingStrategies?.[0]?.flatRate?.amount;
  if (variant == null || amount == null || amount === "" || !Number.isFinite(Number(amount))) return undefined;
  return String(amount);
}

/**
 * Additional fees — `pricingVariants[0].fees[]`, each `{ name, fixedAmountOptions: { amount } }`,
 * charged with the first payment (appliedAt FIRST_PAYMENT is the only value). Formatted in the
 * plan's currency; a fee without a numeric amount is skipped.
 */
export function planFees(variant: Raw | undefined, currency: string | undefined, locale?: string): PlanFee[] {
  return ((variant?.fees ?? []) as Raw[])
    .map((f) => ({ name: String(f.name ?? ""), amount: formatAmount(f.fixedAmountOptions?.amount, currency, locale) }))
    .filter((f) => f.amount);
}

// ---- billing rules --------------------------------------------------------------------------------

/**
 * Recurring vs one-time, from billingTerms: endType UNTIL_CANCELLED with a billingCycle recurs;
 * CYCLES_COMPLETED recurs unless billingCycleCount is 1 (bill once, then end); no cycle never recurs.
 * billingCycleCount is a STRING on both transports ("1") — compare as a string.
 */
export function isRecurring(terms: Raw | undefined): boolean {
  if (!terms?.billingCycle) return false;
  if (terms.endType === "UNTIL_CANCELLED") return true;
  if (terms.endType === "CYCLES_COMPLETED") return String(terms.cyclesCompletedDetails?.billingCycleCount) !== "1";
  return false;
}

const periodLabel = (cycle: Raw, total: number): string => {
  const period = String(cycle.period ?? "MONTH").toLowerCase();
  return `${total} ${period}${total === 1 ? "" : "s"}`;
};

/**
 * billingTerms → the CADENCE only: "per month", "every 3 months", "one-time". How long the plan
 * lasts is `durationLabel`, a separate value — "per month × 6" folded both into one string and read
 * wrong for a one-time plan with a cycle. billingCycle.count is a STRING ("1") — Number() it.
 */
export function billingLabel(terms: Raw | undefined): string {
  if (!isRecurring(terms)) return "one-time";
  const cycle: Raw = terms!.billingCycle;
  const count = Number(cycle.count ?? 1) || 1;
  const period = String(cycle.period ?? "MONTH").toLowerCase();
  return count === 1 ? `per ${period}` : `every ${count} ${period}s`;
}

/**
 * billingTerms → how long the plan stays valid, or null when it runs until canceled (endType
 * UNTIL_CANCELLED, or no terms/cycle at all). Recurring for N cycles → count × N ("6 months" for a
 * monthly plan over 6 cycles); one-time with a cycle → that cycle ("1 month").
 */
export function durationLabel(terms: Raw | undefined): string | null {
  const cycle: Raw | undefined = terms?.billingCycle;
  if (!terms || !cycle || terms.endType === "UNTIL_CANCELLED") return null;
  const count = Number(cycle.count ?? 1) || 1;
  const cycles = isRecurring(terms) ? Number(terms.cyclesCompletedDetails?.billingCycleCount ?? 1) || 1 : 1;
  return periodLabel(cycle, count * cycles);
}

// ---- image ----------------------------------------------------------------------------------------

/** The size every plan image resolves at — landscape, matching the 16:9 band the detail page shows. */
export const PLAN_IMAGE_WIDTH = 1200;
export const PLAN_IMAGE_HEIGHT = 675;
/** height / width — pass to imgAttrs(plan.imageUrl, sizes, PLAN_IMAGE_RATIO) so srcset candidates keep the aspect. */
export const PLAN_IMAGE_RATIO = PLAN_IMAGE_HEIGHT / PLAN_IMAGE_WIDTH;

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
 * .flatRate.amount ("0" = free), paired with plan.currency (site-derived); fees likewise. Wix
 * settles the actual charge, tax, and schedule at the hosted checkout. Null for a malformed plan
 * (see `planAmount`) — callers drop it (`toSummaries`) or treat it as not found.
 */
export function toSummary(raw: Raw, imgSrc: ImgSrc, { locale }: FormatOptions = {}): PlanSummary | null {
  const amount = planAmount(raw);
  if (amount === undefined) return null;
  const variant: Raw = raw.pricingVariants[0];
  const free = Number(amount) === 0;
  return {
    id: id(raw),
    slug: raw.slug ?? "",
    name: raw.name ?? "",
    description: raw.description ?? "",
    pricingVariantId: id(variant),
    price: formatPrice(amount, raw.currency, locale),
    free,
    billing: free ? "" : billingLabel(variant.billingTerms),
    duration: durationLabel(variant.billingTerms),
    fees: planFees(variant, raw.currency, locale),
    freeTrialDays: variant.freeTrialDays || null,
    perks: ((raw.perks ?? []) as Raw[]).map((p) => p.description ?? "").filter((d: string) => d),
    buyable: raw.buyable === true, // a PUBLIC plan can still be merchant-assigned — no CTA then
    imageUrl: imgSrc(planImage(raw), PLAN_IMAGE_WIDTH, PLAN_IMAGE_HEIGHT),
  };
}

/** A list of raw plans → cards, with every malformed plan dropped (one console.warn each, so the grid still renders). */
export function toSummaries(raws: Raw[], imgSrc: ImgSrc, options: FormatOptions = {}): PlanSummary[] {
  const out: PlanSummary[] = [];
  for (const raw of raws) {
    const summary = toSummary(raw, imgSrc, options);
    if (summary) out.push(summary);
    else console.warn(`Pricing plan "${raw?.name ?? id(raw)}" has no numeric price — not shown.`);
  }
  return out;
}

export function toDetail(raw: Raw, imgSrc: ImgSrc, options: FormatOptions = {}): PlanDetail | null {
  const summary = toSummary(raw, imgSrc, options);
  return summary ? { ...summary, termsAndConditions: raw.termsAndConditions ?? "" } : null;
}
