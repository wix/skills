// Donations DTOs — the serializable shapes every hook, component, and page consumes. Plain JSON:
// safe as Astro island props or across server/client boundaries. Images are resolved https URLs;
// every displayable amount is a ready formatted string ("" when the currency is unknown).

/** The Donation Campaigns `Frequency` enum values. */
export type DonationFrequency = "ONE_TIME" | "WEEK" | "MONTH" | "YEAR";

/** `status` as the API computes it: COLLECTING → collecting, GOAL_REACHED → goalReached, EXPIRED → expired. */
export type CampaignStatus = "collecting" | "goalReached" | "expired";

/** Goal progress from the campaign's goal + the metrics read (null on the DTO when the campaign has no goal). */
export interface GoalProgress {
  /** Formatted total raised ("$1,250"); "" when the metrics could not be read. */
  raised: string;
  /** Formatted target ("$20,000"). */
  target: string;
  /** Numbers for a11y and bar width only — never render them as money. */
  raisedAmount: number;
  targetAmount: number;
  /** Wix's rounding (<1 → ceil, >99 → floor, else round); may exceed 100. */
  percent: number;
  donationCount: number;
  /** raisedAmount >= targetAmount (independent of `status`: a campaign may keep collecting past its goal). */
  reached: boolean;
  /** ISO end date, null when the goal has no deadline. */
  endDate: string | null;
  /** endDate is in the past. */
  ended: boolean;
  /** endDate falls on today's calendar day. */
  lastDay: boolean;
  /** Whole days left including today; 0 with no deadline or once ended. */
  daysLeft: number;
  /** Whole hours left including the current one; 0 with no deadline or once ended. */
  hoursLeft: number;
}

export interface AmountPreset {
  amount: number;
  /** Formatted ("$25"). */
  label: string;
  /** The owner's impact statement for this amount; "" when none. */
  impact: string;
}

export interface FrequencyOption {
  value: DonationFrequency;
  /** "One-time" | "Weekly" | "Monthly" | "Yearly". */
  label: string;
}

export interface DonationOptions {
  /** ISO currency code the campaign's amounts are in; "" when it could not be determined. */
  currency: string;
  /** In API order; the first is the default selection. [] with a custom-only campaign. */
  presets: AmountPreset[];
  customAmount: {
    enabled: boolean;
    /** null = no limit. */
    min: number | null;
    max: number | null;
    /** Formatted limits for messages; "" when none. */
    minLabel: string;
    maxLabel: string;
  };
  /** >= 1; the first is the default. Show a picker only when length > 1. */
  frequencies: FrequencyOption[];
  /** The owner asks donors to add the processing fee. */
  askCoverFee: boolean;
  /** 0.029 — Wix's fixed rate, applied to every recurring charge too. */
  feeRate: number;
  /** The owner enabled the donor note. */
  commentsEnabled: boolean;
  /** Max note length (100). */
  commentMaxLength: number;
}

/** A campaign as a listing card or a home strip needs it. */
export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  /** status === "collecting". An archived campaign never reaches a DTO. */
  acceptsDonations: boolean;
  /** Resolved https URL ("" when the campaign has no cover image). */
  imageUrl: string;
  /** null when the campaign has no goal. */
  goal: GoalProgress | null;
}

/** A campaign as the campaign page and the donate form need it. */
export interface CampaignDetail extends CampaignSummary {
  options: DonationOptions;
}

/** What the visitor chose — what the checkout line carries. */
export interface DonationInput {
  amount: number;
  frequency: DonationFrequency;
  coverFee: boolean;
  note: string;
}

export type DonationErrorCode =
  | "MISSING_AMOUNT"
  | "TOO_MANY_DECIMALS"
  | "BELOW_MIN_AMOUNT"
  | "ABOVE_MAX_AMOUNT"
  | "MISSING_FREQUENCY"
  | "NOTE_TOO_LONG";

/** The eCom order behind a completed donation, as the thank-you page shows it. */
export interface DonationReceipt {
  orderNumber: string;
  donorFirstName: string;
  donorLastName: string;
  /** Formatted order total; "" when the order carries no formatted amount and no currency. */
  amount: string;
  /** paymentStatus === "PAID". Anything else reads as pending — never "paid". */
  paid: boolean;
  campaignId: string;
}
