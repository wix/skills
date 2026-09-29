// Donation rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./campaigns.ts
// + ./donate.ts (the SDK, managed Astro and React) and the REST twins in templates/donations/rest/
// (fetch, a static site or a port to another language). Every rule about amounts, fees, frequency,
// goal math, validation, the checkout line and the redirect body lives HERE, once. A raw campaign
// may come from the SDK (`_id`, coverImage as a `wix:image://` string) or from REST (`id`,
// coverImage as { id, url }); the mappers accept both. Has its own formatMoney so it stands alone
// when stripped. Imports are type-only so a strip to JS emits no imports.
import type {
  AmountPreset,
  CampaignDetail,
  CampaignStatus,
  CampaignSummary,
  DonationErrorCode,
  DonationFrequency,
  DonationInput,
  DonationOptions,
  DonationReceipt,
  FrequencyOption,
  GoalProgress,
} from "./types";

/** A raw entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** App id of Wix Donations — the `appId` of every donation line item's catalogReference. */
export const DONATIONS_APP_ID = "333b456e-dd48-4d6b-b32b-9fd48d74e163";
/** App id of the eCom platform (Checkout & Orders) — a donation is an eCom checkout. */
export const ECOM_PLATFORM_APP_ID = "1380b703-ce81-ff05-f115-39571d94dfcd";
/** Wix's fixed processing-fee rate a donor may add (askDonorCoverFee); applied to every recurring charge. */
export const FEE_RATE = 0.029;
/** The donor note's maximum length (the Wix widget's default). */
export const NOTE_MAX = 100;
export const FREQUENCIES: DonationFrequency[] = ["ONE_TIME", "WEEK", "MONTH", "YEAR"];
export const FREQUENCY_LABELS: Record<DonationFrequency, string> = {
  ONE_TIME: "One-time",
  WEEK: "Weekly",
  MONTH: "Monthly",
  YEAR: "Yearly",
};

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

// ---- query ----------------------------------------------------------------------------------------

export interface CampaignsQueryOptions {
  /** 1–100, default 100. */
  limit?: number;
}

/**
 * The Query Donation Campaigns body both transports send: only non-archived campaigns (archived =
 * hidden and cannot accept donations), oldest first (the Wix widget's default campaign is the first
 * by creation date), cursor paging. `status` is NOT filterable — closed campaigns are filtered by the
 * caller from the DTO. The SDK builder spells the same as `.eq("archived", false).ascending("_createdDate")`.
 */
export function campaignsQuery({ limit = 100 }: CampaignsQueryOptions = {}): Raw {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100.");
  return { filter: { archived: false }, sort: [{ fieldName: "createdDate", order: "ASC" }], cursorPaging: { limit } };
}

// ---- money ----------------------------------------------------------------------------------------

/**
 * A number in a currency, in the visitor's locale; whole amounts without decimals ("$25", "$12.50").
 * "" when the currency is unknown — never a bare number posing as money, never an assumed USD.
 */
export function formatAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null || !Number.isFinite(amount) || !currency) return "";
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * MultiCurrencyPrice { amount, convertedAmount, formattedAmount } → a display string. The API's
 * own `formattedAmount` wins (the site's currency symbol and locale); otherwise the amount is
 * formatted in `currency`; "" when neither is available.
 */
export function formatMoney(money: Raw | null | undefined, currency: string | null | undefined): string {
  if (money?.formattedConvertedAmount) return String(money.formattedConvertedAmount);
  if (money?.formattedAmount) return String(money.formattedAmount);
  const value = money?.convertedAmount ?? money?.amount;
  if (value == null || value === "") return "";
  return formatAmount(Number(value), currency);
}

const amountOf = (money: Raw | null | undefined): number => {
  const n = Number(money?.amount ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ---- campaign rules -------------------------------------------------------------------------------

/** `status` is read-only and computed by Wix; anything unknown reads as collecting. */
export function statusOf(raw: Raw): CampaignStatus {
  if (raw.status === "GOAL_REACHED") return "goalReached";
  if (raw.status === "EXPIRED") return "expired";
  return "collecting";
}

export const isArchived = (raw: Raw | null | undefined): boolean => raw?.archived === true;

/**
 * The cover image as a value imgSrc resolves: the SDK hands a `wix:image://…` string; REST hands
 * an Image object { id, url } — its url when present, else the media id in the wix:image form the
 * URL builder scales. "" when the campaign has no image.
 */
export function campaignImage(raw: Raw): string {
  const img = raw.coverImage;
  if (!img) return "";
  if (typeof img === "string") return img;
  if (img.url) return String(img.url);
  return img.id ? `wix:image://v1/${img.id}/${img.id}` : "";
}

/**
 * The currency the campaign's amounts are in. The metrics endpoint "currently returns only the
 * site's default currency", so its first entry's currencyCode is the site currency. "" when the
 * metrics could not be read (the API's formattedAmount strings still display; only the live
 * custom-amount total loses its label).
 */
export function currencyOf(metrics: Raw[] | null | undefined): string {
  return metrics?.find((m) => m?.currencyCode)?.currencyCode ?? "";
}

/** The metrics entry for `currency` (the first entry when no currency is known); zero when absent. */
export function metricsFor(metrics: Raw[] | null | undefined, currency: string): { donationCount: number; totalAmount: Raw | undefined } {
  const list = metrics ?? [];
  const entry = currency ? list.find((m) => m?.currencyCode === currency) : list[0];
  return { donationCount: Number(entry?.donationCount ?? 0) || 0, totalAmount: entry?.totalAmount };
}

/** Wix's progress rounding: 0 target → 0; under 1% rounds up, over 99% rounds down, else nearest. */
export function goalPercent(raised: number, target: number): number {
  if (!target) return 0;
  const v = (raised / target) * 100;
  if (v < 1) return Math.ceil(v);
  if (v > 99) return Math.floor(v);
  return Math.round(v);
}

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** campaignGoal + metrics → GoalProgress; null when the campaign has no goal. `now` is injectable for tests. */
export function toGoal(campaignGoal: Raw | null | undefined, metrics: Raw[] | null | undefined, currency: string, now: Date = new Date()): GoalProgress | null {
  if (!campaignGoal?.targetAmount) return null;
  const m = metricsFor(metrics, currency);
  const raisedAmount = amountOf(m.totalAmount);
  const targetAmount = amountOf(campaignGoal.targetAmount);
  const end = campaignGoal.endDate ? new Date(campaignGoal.endDate) : null;
  const hasEnd = !!end && !Number.isNaN(end.getTime());
  const ended = hasEnd && end!.getTime() < now.getTime();
  const left = hasEnd && !ended ? end!.getTime() - now.getTime() : 0;
  return {
    raised: m.totalAmount ? formatMoney(m.totalAmount, currency) : formatAmount(0, currency),
    target: formatMoney(campaignGoal.targetAmount, currency),
    raisedAmount,
    targetAmount,
    percent: goalPercent(raisedAmount, targetAmount),
    donationCount: m.donationCount,
    reached: raisedAmount >= targetAmount,
    endDate: hasEnd ? end!.toISOString() : null,
    ended,
    lastDay: hasEnd && sameDay(end!, now),
    daysLeft: left ? Math.floor(left / 86_400_000) + 1 : 0,
    hoursLeft: left ? Math.floor(left / 3_600_000) + 1 : 0,
  };
}

export function presetsOf(raw: Raw, currency: string): AmountPreset[] {
  return ((raw.predefinedDonationAmounts ?? []) as Raw[])
    .map((p) => ({ amount: amountOf(p.price), label: formatMoney(p.price, currency), impact: p.description ?? "" }))
    .filter((p) => p.amount > 0);
}

/** customAmountEnabled + customAmountOptions; a 0 or absent limit means no limit. */
export function customAmountOf(raw: Raw, currency: string): DonationOptions["customAmount"] {
  const o: Raw = raw.customAmountOptions ?? {};
  const min = amountOf(o.minimum) || null;
  const max = amountOf(o.maximum) || null;
  return {
    enabled: raw.customAmountEnabled === true,
    min,
    max,
    minLabel: min ? formatMoney(o.minimum, currency) : "",
    maxLabel: max ? formatMoney(o.maximum, currency) : "",
  };
}

/** donationFrequencies in API order, labelled; unknown values dropped; ONE_TIME when the list is empty. */
export function frequenciesOf(raw: Raw): FrequencyOption[] {
  const list = ((raw.donationFrequencies ?? []) as string[]).filter((f): f is DonationFrequency => (FREQUENCIES as string[]).includes(f));
  return (list.length ? list : ["ONE_TIME" as DonationFrequency]).map((value) => ({ value, label: FREQUENCY_LABELS[value] }));
}

export function optionsOf(raw: Raw, currency: string): DonationOptions {
  return {
    currency,
    presets: presetsOf(raw, currency),
    customAmount: customAmountOf(raw, currency),
    frequencies: frequenciesOf(raw),
    askCoverFee: raw.askDonorCoverFee === true,
    feeRate: FEE_RATE,
    commentsEnabled: raw.commentsEnabled === true,
    commentMaxLength: NOTE_MAX,
  };
}

// ---- DTO mappers -----------------------------------------------------------------------------------

export function toSummary(raw: Raw, metrics: Raw[] | null | undefined, currency: string, imgSrc: ImgSrc): CampaignSummary {
  const status = statusOf(raw);
  return {
    id: rawId(raw),
    name: raw.name ?? "",
    status,
    acceptsDonations: status === "collecting",
    imageUrl: imgSrc(campaignImage(raw), 1200, 675),
    goal: toGoal(raw.campaignGoal, metrics, currency),
  };
}

export function toDetail(raw: Raw, metrics: Raw[] | null | undefined, currency: string, imgSrc: ImgSrc): CampaignDetail {
  return { ...toSummary(raw, metrics, currency, imgSrc), options: optionsOf(raw, currency) };
}

// ---- the form's rules ------------------------------------------------------------------------------

export type DonationField = "amount" | "customAmount" | "frequency" | "note";

/** What the visitor has chosen so far — the store's editable half. */
export interface DonationSelection {
  frequency: DonationFrequency | null;
  /** The selected preset's amount (null in custom mode or before a choice). */
  presetAmount: number | null;
  /** "Other amount" is active. */
  customMode: boolean;
  /** The custom field's raw text; parsed on validate. */
  customAmount: string;
  coverFee: boolean;
  note: string;
}

/**
 * The widget's defaults: the first preset, the first frequency, cover-fee pre-checked when the
 * owner asks for it, and custom mode forced when the campaign offers no presets.
 */
export function defaultSelection(options: DonationOptions): DonationSelection {
  const customOnly = options.customAmount.enabled && options.presets.length === 0;
  return {
    frequency: options.frequencies[0]?.value ?? null,
    presetAmount: customOnly ? null : options.presets[0]?.amount ?? null,
    customMode: customOnly,
    customAmount: "",
    coverFee: options.askCoverFee,
    note: "",
  };
}

/** "1,250.50" / " 25 " → 1250.5; null when not a number. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const decimalsOf = (n: number): number => {
  const s = String(n);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
};

/** The amount the selection resolves to (custom text parsed in custom mode); null when there is none. */
export function selectedAmount(sel: DonationSelection): number | null {
  return sel.customMode ? parseAmount(sel.customAmount) : sel.presetAmount;
}

/** The donor's fee at Wix's fixed 2.9%, rounded to cents; null for a non-positive amount. */
export function feeFor(amount: number | null): number | null {
  if (amount == null || amount <= 0) return null;
  return Math.round(amount * FEE_RATE * 100) / 100;
}

/** amount + fee when the owner asks and the donor agreed; the amount alone otherwise. */
export function totalFor(amount: number | null, coverFee: boolean, askCoverFee: boolean): number | null {
  if (amount == null) return null;
  const fee = askCoverFee && coverFee ? feeFor(amount) ?? 0 : 0;
  return Math.round((amount + fee) * 100) / 100;
}

/** The widget's validation, field by field; {} when the selection is valid. */
export function validateDonation(options: DonationOptions, sel: DonationSelection): Partial<Record<DonationField, DonationErrorCode>> {
  const errors: Partial<Record<DonationField, DonationErrorCode>> = {};
  if (sel.customMode) {
    const n = parseAmount(sel.customAmount);
    const { min, max } = options.customAmount;
    if (n == null || n <= 0) errors.customAmount = "MISSING_AMOUNT";
    else if (decimalsOf(n) > 2) errors.customAmount = "TOO_MANY_DECIMALS";
    else if (min != null && n < min) errors.customAmount = "BELOW_MIN_AMOUNT";
    else if (max != null && n > max) errors.customAmount = "ABOVE_MAX_AMOUNT";
  } else if (sel.presetAmount == null || sel.presetAmount <= 0) {
    errors.amount = "MISSING_AMOUNT";
  }
  if (!sel.frequency) errors.frequency = "MISSING_FREQUENCY";
  if (sel.note.length > options.commentMaxLength) errors.note = "NOTE_TOO_LONG";
  return errors;
}

/** Visitor-facing text for a validation code, with the campaign's own limits. */
export function errorMessage(code: DonationErrorCode, options: DonationOptions): string {
  switch (code) {
    case "MISSING_AMOUNT":
      return "Enter an amount.";
    case "TOO_MANY_DECIMALS":
      return "Use at most two decimal places.";
    case "BELOW_MIN_AMOUNT":
      return `The minimum donation is ${options.customAmount.minLabel || options.customAmount.min}.`;
    case "ABOVE_MAX_AMOUNT":
      return `The maximum donation is ${options.customAmount.maxLabel || options.customAmount.max}.`;
    case "MISSING_FREQUENCY":
      return "Choose how often to donate.";
    case "NOTE_TOO_LONG":
      return `Keep your note under ${options.commentMaxLength} characters.`;
  }
}

/** "Donate $25" / "Donate $25.73 Monthly" / "Donate" when there is no amount or no known currency. */
export function donateLabel(total: number | null, frequency: DonationFrequency | null, currency: string): string {
  const amount = formatAmount(total, currency);
  const cadence = frequency && frequency !== "ONE_TIME" ? ` ${FREQUENCY_LABELS[frequency]}` : "";
  return amount ? `Donate ${amount}${cadence}` : "Donate";
}

/** A valid selection → the checkout input; null when validation fails. */
export function toInput(options: DonationOptions, sel: DonationSelection): DonationInput | null {
  if (Object.keys(validateDonation(options, sel)).length) return null;
  const amount = selectedAmount(sel);
  if (amount == null || !sel.frequency) return null;
  return { amount, frequency: sel.frequency, coverFee: options.askCoverFee && sel.coverFee, note: sel.note.trim() };
}

// ---- checkout -------------------------------------------------------------------------------------

/**
 * The one line item a donation checkout carries. `amount` is a NUMBER and `frequency` the enum
 * string; `donorCoveringFees` is sent only when the donor opted in (the Donations catalog plugin
 * prices the line from these options — never a customLineItem, never a computed price).
 */
export function donationLineItem(campaignId: string, input: DonationInput): Raw {
  if (!campaignId) throw new Error("A campaign id is required to donate.");
  return {
    quantity: 1,
    catalogReference: {
      appId: DONATIONS_APP_ID,
      catalogItemId: campaignId,
      options: { amount: input.amount, frequency: input.frequency, ...(input.coverFee ? { donorCoveringFees: true } : {}) },
    },
  };
}

/** Create Checkout body: the donation line, channelType WEB, the note as the checkout's buyerNote. */
export function checkoutBody(campaignId: string, input: DonationInput): Raw {
  return {
    lineItems: [donationLineItem(campaignId, input)],
    channelType: "WEB",
    ...(input.note ? { checkoutInfo: { buyerNote: input.note } } : {}),
  };
}

/** Create Cart body — the Wix widget's own route (fallback): the note as the cart's buyerNote. */
export function cartBody(campaignId: string, input: DonationInput): Raw {
  return {
    lineItems: [donationLineItem(campaignId, input)],
    ...(input.note ? { cartInfo: { buyerNote: input.note } } : {}),
  };
}

/** The checkout id out of either transport's response for either route. */
export function checkoutIdOf(res: Raw | null | undefined): string {
  const id = res?._id ?? res?.id ?? res?.checkoutId ?? res?.checkout?.id ?? res?.checkout?._id ?? "";
  if (!id) throw new Error("Checkout couldn't start: no checkout id returned.");
  return String(id);
}

/** Where the hosted checkout returns to. Defaults are the Astro routes; a static site passes its file paths. */
export interface DonatePaths {
  /** Success landing — Wix appends `?orderId=<eCom order id>`. Default `/donate/thank-you`. */
  thankYou?: string;
  /** Back here on abandon or interruption (NOT a success signal). Default `/donate/<campaignId>`. */
  campaign?: string;
}

/**
 * The Create Redirect Session body for a donation checkout. `origin` is the published https host
 * (window.location.origin in a browser) — an http or server-derived origin isn't on the OAuth app's
 * allowed domains and 403s the return; no callbacks when unknown (SSR).
 */
export function redirectBody(checkoutId: string, campaignId: string, origin: string, paths: DonatePaths = {}): Raw {
  if (!checkoutId) throw new Error("A checkout id is required to start the hosted checkout.");
  const callbacks = origin
    ? {
        postFlowUrl: `${origin}${paths.campaign ?? `/donate/${campaignId}`}`,
        thankYouPageUrl: `${origin}${paths.thankYou ?? "/donate/thank-you"}`,
      }
    : {};
  return { ecomCheckout: { checkoutId }, callbacks };
}

/** The hosted checkout URL out of a redirect-session response; throws when there is none. */
export function redirectUrl(session: Raw | null | undefined): string {
  const url = session?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start — please try again.");
  return url;
}

/** A checkout failure as the visitor should read it; the raw message is kept when no rule applies. */
export function checkoutError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/premium|payment method|payments? (is|are) not (set up|enabled)|PAYMENT_METHOD/i.test(msg)) {
    return new Error("Donations aren't switched on yet — the site owner needs a premium plan and a connected payment method.");
  }
  return e instanceof Error ? e : new Error(msg || "Checkout couldn't start — please try again.");
}

// ---- the receipt ----------------------------------------------------------------------------------

/**
 * The order id the hosted checkout appends to thankYouPageUrl: the redirect-session contract
 * spells it `orderId`; the Wix widget's own success URL uses `orderid`. Both are read.
 */
export function orderIdFromSearch(search: string): string {
  const q = new URLSearchParams(search);
  return q.get("orderId") ?? q.get("orderid") ?? "";
}

/**
 * An eCom order → the receipt: the donor's name from billingInfo.contactDetails (recipientInfo only
 * when billing lacks a complete name), the order total's formatted amount, paid only on PAID.
 */
export function toReceipt(order: Raw): DonationReceipt {
  const complete = (c: Raw | undefined): c is Raw => !!(c?.firstName && c?.lastName);
  const billing: Raw | undefined = order.billingInfo?.contactDetails;
  const recipient: Raw | undefined = order.recipientInfo?.contactDetails;
  const contact = complete(billing) ? billing : complete(recipient) ? recipient : billing ?? recipient ?? {};
  const total: Raw | undefined = order.priceSummary?.total;
  return {
    orderNumber: order.number != null ? String(order.number) : "",
    donorFirstName: contact.firstName ?? "",
    donorLastName: contact.lastName ?? "",
    amount: formatMoney(total, order.currency ?? ""),
    paid: order.paymentStatus === "PAID",
    campaignId: order.lineItems?.[0]?.catalogReference?.catalogItemId ?? "",
  };
}
