// Pricing Plans DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Images are
// resolved https URLs; every displayable price is a ready formatted string.

/** A plan as a pricing-grid card needs it. */
export interface PlanSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Formatted price (e.g. "$29.00"); "Free" when the plan costs nothing. */
  price: string;
  free: boolean;
  /** Display-ready cadence: "per month", "every 3 months", "one-time"; "" for free plans. */
  billing: string;
  /** Free-trial length in days (null when the plan has none). */
  freeTrialDays: number | null;
  /** Display-only feature bullets, in order. */
  perks: string[];
  /** False → a PUBLIC but merchant-assigned plan: show it without a subscribe CTA. */
  buyable: boolean;
  /** Resolved https URL ("" when the plan has no image). */
  imageUrl: string;
}

/** A plan as the detail page needs it. */
export interface PlanDetail extends PlanSummary {
  /** Terms & conditions as plain text ("" when not set) — render as-is (pre-wrap). */
  termsAndConditions: string;
}
