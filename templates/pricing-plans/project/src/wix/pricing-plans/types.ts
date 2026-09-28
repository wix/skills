// Pricing Plans DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Images are
// resolved https URLs; every displayable price is a ready formatted string.

/** An additional fee on a plan (a setup fee), charged with the first payment. */
export interface PlanFee {
  /** The merchant's label, e.g. "Setup fee". */
  name: string;
  /** Formatted amount in the plan's currency (e.g. "€25.00"). */
  amount: string;
}

/** A plan as a pricing-grid card needs it. */
export interface PlanSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  /**
   * The pricing variant the price belongs to (`pricingVariants[0]`). Not needed by the shipped
   * purchase flow (paidPlansCheckout takes the plan id); it is the key an eCom checkout line item
   * needs (`planOptions: { pricingVariantId }`) when a plan must share a checkout with products.
   */
  pricingVariantId: string;
  /** Formatted price (e.g. "$29.00"); "Free" when the plan costs nothing. */
  price: string;
  free: boolean;
  /** Display-ready cadence only: "per month", "every 3 months", "one-time"; "" for free plans. */
  billing: string;
  /**
   * How long the plan stays valid after purchase, display-ready ("6 months", "1 year");
   * null when it runs until canceled. Independent of `billing`: a plan can bill "per month"
   * for "6 months", or bill "one-time" and be valid "1 month".
   */
  duration: string | null;
  /** Additional fees charged with the first payment, formatted — show them with the price, never hide them. [] when none. */
  fees: PlanFee[];
  /** Free-trial length in days (null when the plan has none). */
  freeTrialDays: number | null;
  /** Display-only feature bullets, in order. */
  perks: string[];
  /** False → a PUBLIC but merchant-assigned plan: show it without a subscribe CTA. */
  buyable: boolean;
  /** Resolved https URL at 16:9 ("" when the plan has no image). */
  imageUrl: string;
}

/** A plan as the detail page needs it. */
export interface PlanDetail extends PlanSummary {
  /** Terms & conditions as plain text ("" when not set) — render as-is (pre-wrap). */
  termsAndConditions: string;
}
