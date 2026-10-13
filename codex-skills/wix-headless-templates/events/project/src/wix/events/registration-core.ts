// Registration rules and DTO mapping — transport-agnostic, imported by both ./registration.ts
// (SDK) and the REST twin in templates/events/rest/registration.ts (fetch). Tier mapping (pricing
// methods, availability, sale period, tax + fee lines), the picker's totals, the reservation line
// items, error copy, the checkout callbacks, and the RSVP body built from the organizer's form
// live HERE, once. Raw ticket definitions carry `_id` (SDK) or `id` (REST). Types are imported
// type-only; the money/date formatters come from ./events-core (the same file both transports ship).
import type { EventDetail, RegistrationResult, RsvpForm, RsvpFormInput, SelectionTotals, TaxSettings, TicketSelection, TicketTier } from "./types";
import { formatAmount, formatInZone, formatMoney, type Raw } from "./events-core";

const tierId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

/** Wix's ticket service fee, added at checkout when a tier's `feeType` is FEE_ADDED_AT_CHECKOUT. */
export const WIX_FEE_RATE = 2.5;
const round2 = (n: number): number => Number(n.toFixed(2));

/** What the tier mapper needs from the event: the zone for sale dates, the tax the checkout applies. */
export type TierEvent = Pick<EventDetail, "id" | "timeZoneId" | "taxSettings">;

/**
 * Query Available Ticket Definitions (V3) body: this event's tiers in the organizer's order. The
 * endpoint is visitor-callable and already excludes hidden tiers; no paging needed (default 100).
 */
export function availableTiersQuery(eventId: string): Raw {
  return { filter: { eventId }, sort: [{ fieldName: "sortIndex", order: "ASC" }] };
}

/** Formatted price of a Money (`value` first; the deprecated `amount` as the v1 fallback). */
export function formatTierPrice(price: Raw | undefined): string {
  return formatMoney(price);
}

/**
 * Tax on one ticket at `price` (Wix's getTicketDefinitionTax): INCLUDED_IN_PRICE backs the tax out
 * of the price; ADDED_AT_CHECKOUT adds `rate%` on top.
 */
export function tierTax(tax: TaxSettings, price: number): { taxableValue: number; taxValue: number } {
  if (tax.includedInPrice) {
    const taxableValue = round2((price * 100) / (100 + tax.ratePercent));
    return { taxableValue, taxValue: round2(price - taxableValue) };
  }
  return { taxableValue: price, taxValue: round2(price * (tax.ratePercent / 100)) };
}

/** The Wix fee on one ticket (getTicketDefinitionFee): 2.5% of the price plus any tax added at checkout. */
export function tierFee(tax: TaxSettings | null, price: number, guestPricing: boolean): number {
  const addedTax = tax && !tax.includedInPrice && (!guestPricing || tax.appliedToDonations) ? tierTax(tax, price).taxValue : 0;
  return round2((price + addedTax) * (WIX_FEE_RATE / 100));
}

/**
 * The lines under a price that say what checkout adds (Wix's TicketDefinition Tax/Fee): tax is
 * hidden for free tiers and for a guest price unless `appliedToDonations`; the fee only when the
 * organizer passes it on (FEE_ADDED_AT_CHECKOUT) and the tier isn't free.
 */
export function priceNotes(
  price: number,
  currency: string,
  tax: TaxSettings | null,
  feeType: TicketTier["feeType"],
  { free, guestPricing }: { free: boolean; guestPricing: boolean },
): string[] {
  const notes: string[] = [];
  if (free) return notes;
  if (tax && (!guestPricing || tax.appliedToDonations)) {
    const { taxValue } = tierTax(tax, price);
    notes.push(tax.includedInPrice ? `${tax.name} included` : `+${formatAmount(taxValue, currency)} ${tax.name}`);
  }
  if (feeType === "FEE_ADDED_AT_CHECKOUT") notes.push(`+${formatAmount(tierFee(tax, price, guestPricing), currency)} ticket service fee`);
  return notes;
}

const FEE_TYPES = new Set(["FEE_INCLUDED", "FEE_ADDED_AT_CHECKOUT", "NO_FEE"]);
const SALE_STATUSES = new Set(["SALE_SCHEDULED", "SALE_STARTED", "SALE_ENDED"]);

/**
 * One raw ticket definition (V3 `pricingMethod`, or the v1 `price` shape) → tier DTO. Sold out is
 * `limitPerCheckout === 0` (Wix lowers the per-checkout limit to the unsold count); a missing field
 * means the API didn't say, never 0.
 */
export function toTier(raw: Raw, event: TierEvent): TicketTier {
  const pm: Raw = raw.pricingMethod ?? {};
  const fixed: Raw | undefined = pm.fixedPrice ?? raw.price;
  const guest: Raw | undefined = pm.guestPrice;
  const optionDetails: Raw[] = pm.pricingOptions?.optionDetails ?? [];
  const currency: string = fixed?.currency ?? guest?.currency ?? optionDetails[0]?.price?.currency ?? "";
  const tax = event.taxSettings;
  const feeType = (FEE_TYPES.has(raw.feeType) ? raw.feeType : "") as TicketTier["feeType"];
  const free = pm.free === true || raw.free === true || (fixed && Number(fixed.value ?? fixed.amount ?? 0) === 0 && !guest && !optionDetails.length);
  const pricingType: TicketTier["pricingType"] = free ? "FREE" : guest ? "GUEST" : optionDetails.length ? "OPTIONS" : "FIXED";
  const limit = Number(raw.limitPerCheckout);
  const limitPerCheckout = Number.isInteger(limit) && limit >= 0 ? limit : 20;
  const saleStatus = (SALE_STATUSES.has(raw.saleStatus) ? raw.saleStatus : "SALE_STARTED") as TicketTier["saleStatus"];
  const options = optionDetails
    .filter((o) => o.optionId)
    .map((o) => ({
      id: String(o.optionId),
      name: o.name ?? "",
      price: formatMoney(o.price),
      value: String(o.price?.value ?? o.price?.amount ?? "0"),
      notes: priceNotes(Number(o.price?.value ?? o.price?.amount ?? 0), currency, tax, feeType, { free: false, guestPricing: false }),
    }));
  const optionValues = optionDetails.map((o) => Number(o.price?.value ?? o.price?.amount ?? 0)).filter((n) => Number.isFinite(n));
  const fixedValue = Number(fixed?.value ?? fixed?.amount ?? 0);
  const price =
    pricingType === "FREE"
      ? "Free"
      : pricingType === "FIXED"
        ? formatMoney(fixed)
        : pricingType === "OPTIONS" && optionValues.length
          ? `${formatAmount(Math.min(...optionValues), currency)} – ${formatAmount(Math.max(...optionValues), currency)}`
          : "";
  // Sale dates read in the EVENT's zone: "goes on sale" only while scheduled; "ends" once the sale started (Wix).
  const salePeriod: Raw | undefined = raw.salePeriod;
  return {
    id: tierId(raw),
    name: raw.name ?? "",
    description: raw.description ?? "",
    pricingType,
    price,
    priceValue: pricingType === "FIXED" ? String(fixed?.value ?? fixed?.amount ?? "0") : "0",
    free: pricingType === "FREE",
    minPrice: pricingType === "GUEST" ? formatMoney(guest) : "",
    minPriceValue: pricingType === "GUEST" ? String(guest?.value ?? guest?.amount ?? "0") : "",
    currency,
    options: pricingType === "OPTIONS" ? options : [],
    notes: pricingType === "OPTIONS" ? [] : priceNotes(fixedValue, currency, tax, feeType, { free: pricingType === "FREE", guestPricing: pricingType === "GUEST" }),
    limitPerCheckout,
    soldOut: limitPerCheckout === 0,
    saleStatus,
    available: limitPerCheckout > 0 && saleStatus === "SALE_STARTED",
    saleStartsLabel: saleStatus === "SALE_SCHEDULED" ? formatInZone(salePeriod?.startDate, event.timeZoneId) : "",
    saleEndsLabel: saleStatus !== "SALE_SCHEDULED" && salePeriod?.endDate ? formatInZone(salePeriod.endDate, event.timeZoneId) : "",
    feeType,
  };
}

/**
 * Tiers in display order (V3 `sortIndex`, v1 `orderIndex`), skipping any without an id and the
 * ones the organizer hides while not on sale (`salePeriod.displayNotOnSale === false`; v1 `hideNotOnSale`).
 */
export function toTiers(definitions: Raw[] | undefined, event: TierEvent): TicketTier[] {
  return (definitions ?? [])
    .filter((d) => d.hidden !== true)
    .filter((d) => {
      const onSale = (d.saleStatus ?? "SALE_STARTED") === "SALE_STARTED";
      const hideWhenNotOnSale = d.salePeriod?.displayNotOnSale === false || d.hideNotOnSale === true;
      return onSale || !hideWhenNotOnSale;
    })
    .slice()
    .sort((a, b) => (a.sortIndex ?? a.orderIndex ?? 0) - (b.sortIndex ?? b.orderIndex ?? 0))
    .map((d) => toTier(d, event))
    .filter((t) => t.id);
}

/** The store keys a selection by tier, or tier + pricing option. */
export function selectionKey(tierId: string, optionId?: string): string {
  return optionId ? `${tierId}:${optionId}` : tierId;
}

/** Wix's clamp: 0..limitPerCheckout, where a limit of 0 (sold out) allows nothing — never a default of 20. */
export function clampQuantity(tier: TicketTier, quantity: number): number {
  return Math.max(0, Math.min(Math.trunc(quantity) || 0, tier.limitPerCheckout || 0));
}

/** A guest-priced tier needs a decimal at or above its minimum before it can be reserved. */
export function guestPriceValid(tier: TicketTier, value: string | undefined): boolean {
  if (tier.pricingType !== "GUEST") return true;
  const n = Number(value);
  return value != null && value.trim() !== "" && Number.isFinite(n) && n >= Number(tier.minPriceValue || 0);
}

export function ticketCount(selections: TicketSelection[]): number {
  return selections.reduce((sum, s) => sum + (s.quantity > 0 ? s.quantity : 0), 0);
}

/**
 * The picker's running totals — Wix's getTicketReservationTotals verbatim, returned formatted:
 * subtotal = Σ price × qty (minus tax when INCLUDED_IN_PRICE), tax per the settings (skipped for
 * free tiers and for donations unless appliedToDonations), fee per tier with FEE_ADDED_AT_CHECKOUT,
 * total = subtotal + added tax + fee. Null with no selection. The hosted checkout is authoritative.
 */
export function selectionTotals(tiers: TicketTier[], selections: TicketSelection[], tax: TaxSettings | null): SelectionTotals | null {
  const picked = selections.filter((s) => s.quantity > 0);
  if (!picked.length) return null;
  const currency = tiers.find((t) => t.currency)?.currency ?? "";
  let subtotal = 0, taxTotal = 0, fee = 0, total = 0;
  for (const s of picked) {
    const tier = tiers.find((t) => t.id === s.tierId);
    if (!tier) continue;
    const guestPricing = tier.pricingType === "GUEST";
    const price = guestPricing
      ? Number(s.guestPrice || "0")
      : s.optionId
        ? Number(tier.options.find((o) => o.id === s.optionId)?.value ?? 0)
        : Number(tier.priceValue || 0);
    const unit = Number.isFinite(price) ? price : 0;
    subtotal = round2(subtotal + unit * s.quantity);
    total = round2(total + unit * s.quantity);
    if (tax && !tier.free && (!guestPricing || tax.appliedToDonations)) taxTotal = round2(taxTotal + tierTax(tax, unit).taxValue * s.quantity);
    if (tier.feeType === "FEE_ADDED_AT_CHECKOUT" && !tier.free) fee = round2(fee + tierFee(tax, unit, guestPricing) * s.quantity);
  }
  if (tax && !tax.includedInPrice) total = round2(total + taxTotal);
  else if (tax && tax.includedInPrice) subtotal = round2(subtotal - taxTotal);
  total = round2(total + fee);
  return {
    subtotal: formatAmount(subtotal, currency),
    tax: formatAmount(taxTotal, currency),
    fee: formatAmount(fee, currency),
    total: formatAmount(total, currency),
  };
}

/**
 * The reservation's line items (Create Ticket Reservation): one per selection with `eventId`,
 * `ticketDefinitionId`, `quantity` (1..50) and, where the tier needs it, `ticketInfo` — the
 * `pricingOptionId` of an OPTIONS tier or the `guestPrice` of a GUEST tier. Throws when nothing is
 * picked or a guest price is missing/below the minimum.
 */
export function reservationTickets(eventId: string, selections: TicketSelection[], tiers: TicketTier[] = []): Raw[] {
  const tickets = selections
    .filter((s) => s.quantity > 0)
    .map((s) => {
      const tier = tiers.find((t) => t.id === s.tierId);
      if (tier && !guestPriceValid(tier, s.guestPrice)) {
        throw new Error(tier.minPrice ? `Enter an amount of at least ${tier.minPrice} for ${tier.name}.` : `Enter an amount for ${tier.name}.`);
      }
      const ticketInfo: Raw = {};
      if (s.optionId) ticketInfo.pricingOptionId = s.optionId;
      if (tier?.pricingType === "GUEST" && s.guestPrice) ticketInfo.guestPrice = String(Number(s.guestPrice).toFixed(2));
      return { eventId, ticketDefinitionId: s.tierId, quantity: s.quantity, ...(Object.keys(ticketInfo).length ? { ticketInfo } : {}) };
    });
  if (!tickets.length) throw new Error("Pick at least one ticket first.");
  return tickets;
}

/** Visitor copy for the application error codes registration can answer with. */
const ERROR_COPY: Record<string, string> = {
  GUEST_LIMIT_EXCEEDED: "This event is full.",
  MEMBER_ALREADY_REGISTERED: "You're already registered for this event.",
  MEMBER_EMAIL_ALREADY_REGISTERED: "You're already registered for this event.",
  INVALID_FORM_RESPONSE: "Please fill in the required fields.",
  UNEXPECTED_RSVP_STATUS: "Registration isn't open for this event.",
  EVENT_NOT_FOUND: "This event is no longer available.",
};

/**
 * One visitor-facing message out of any failure. SDK errors carry a JSON envelope as their message
 * (`{ message, details: { applicationError: { code } } }`) plus `details` on the error object; the
 * REST client sets `code`/`details` the same way. Known codes get copy; the payment gate (403
 * NO_PAYMENT_METHOD_CONFIGURED until the site has a premium plan AND a payment method — not a
 * permissions bug, never elevate) gets its owner-facing line; anything else is Wix's message.
 */
export function errorMessage(e: unknown): string {
  const err = e as Raw | null;
  let message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  let code: string | undefined = err?.details?.applicationError?.code ?? err?.code;
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed === "object") {
      message = typeof parsed.message === "string" ? parsed.message : message;
      code = code ?? parsed.details?.applicationError?.code;
    }
  } catch {
    /* a plain message */
  }
  if (code && ERROR_COPY[code]) return ERROR_COPY[code];
  if (/payment method|not configured|premium/i.test(message) || code === "NO_PAYMENT_METHOD_CONFIGURED") {
    return "Ticket sales aren't switched on yet — the organizer needs to connect a payment method in the dashboard.";
  }
  return message || "Something went wrong — please try again.";
}

/** The reservation failure as an Error with visitor copy (see errorMessage). */
export function reservationError(e: unknown): Error {
  return new Error(errorMessage(e));
}

/** The reservation id out of either transport's response; throws when the hold didn't happen. */
export function reservationId(reservation: Raw | null | undefined): string {
  const id = tierId(reservation);
  if (!id) throw new Error("Those tickets couldn't be reserved — they may have just sold out.");
  return id;
}

/** Where the hosted checkout returns to. Defaults are the Astro routes; a static site passes its file paths. */
export interface CheckoutPaths {
  /** Success landing — Wix appends `?orderNumber=&eventId=`. Default `/event-confirmation`. */
  confirmation?: string;
  /** Back here on abandon. Default `/events/<slug>`. */
  event?: string;
}

/**
 * The redirect session's callbacks. `origin` is the published https host (window.location.origin
 * in a browser) — an http or server-derived origin isn't on the redirect allowlist and 403s the
 * return; {} when unknown (SSR).
 */
export function checkoutCallbacks(origin: string, slug: string, paths: CheckoutPaths = {}): Raw {
  if (!origin) return {};
  return {
    thankYouPageUrl: `${origin}${paths.confirmation ?? "/event-confirmation"}`,
    postFlowUrl: `${origin}${paths.event ?? `/events/${encodeURIComponent(slug)}`}`,
  };
}

/** The redirect result; throws when Wix returned no URL. */
export function redirectResult(session: Raw | null | undefined): RegistrationResult {
  const url = session?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start — please try again.");
  return { kind: "redirect", url };
}

// ---- RSVP ---------------------------------------------------------------------------------------

/** The RSVP form's answers, keyed by input name (CHECKBOX answers are string arrays). */
export type RsvpValues = Record<string, string | string[]>;

/** What every RSVP form has (the system controls Wix creates) — used when the FORM fieldset is missing. */
export const DEFAULT_RSVP_FORM: RsvpForm = {
  controls: [
    {
      id: "name",
      type: "NAME",
      system: true,
      inputs: [
        { name: "firstName", label: "First name", mandatory: true, type: "TEXT", options: [], maxLength: 0 },
        { name: "lastName", label: "Last name", mandatory: true, type: "TEXT", options: [], maxLength: 0 },
      ],
    },
    { id: "email", type: "INPUT", system: true, inputs: [{ name: "email", label: "Email", mandatory: true, type: "TEXT", options: [], maxLength: 0 }] },
  ],
  guestControl: null,
};

/** The form to render: the organizer's, else the built-in one. */
export function rsvpFormOf(event: Pick<EventDetail, "rsvpForm">): RsvpForm {
  return event.rsvpForm ?? DEFAULT_RSVP_FORM;
}

/**
 * Which inputs are the built-in guest identity: the system NAME control's two inputs (first, last)
 * and the system email input. Create RSVP requires them at the top level of the body.
 */
export function builtInInputs(form: RsvpForm): { firstName: string; lastName: string; email: string } {
  const name = form.controls.find((c) => c.type === "NAME") ?? form.controls.find((c) => c.system && c.inputs.length >= 2);
  const emailControl =
    form.controls.find((c) => c.system && c.type !== "NAME" && c.inputs.some((i) => /mail/i.test(i.name) || /mail/i.test(i.label))) ??
    form.controls.find((c) => c.system && c.type !== "NAME");
  const emailInput = emailControl?.inputs.find((i) => /mail/i.test(i.name) || /mail/i.test(i.label)) ?? emailControl?.inputs[0];
  return { firstName: name?.inputs[0]?.name ?? "firstName", lastName: name?.inputs[1]?.name ?? "lastName", email: emailInput?.name ?? "email" };
}

const filled = (v: string | string[] | undefined): boolean => (Array.isArray(v) ? v.some((x) => x.trim()) : typeof v === "string" && v.trim().length > 0);

/**
 * Whether the answers can be submitted: the built-in identity always; every mandatory input when
 * attending (Create RSVP enforces mandatory values for `YES` only); a guest count within the
 * control's range.
 */
export function canSubmitRsvp(form: RsvpForm, values: RsvpValues, guestCount: number, attending = true): boolean {
  const ids = builtInInputs(form);
  if (![ids.firstName, ids.lastName, ids.email].every((n) => filled(values[n]))) return false;
  if (attending) {
    for (const c of form.controls) for (const i of c.inputs) if (i.mandatory && !filled(values[i.name])) return false;
  }
  if (form.guestControl && (guestCount < 0 || guestCount > form.guestControl.maxGuests)) return false;
  return true;
}

/** One form input's answer as Create RSVP wants it (`values` for TEXT_ARRAY inputs, `value` otherwise); null when unanswered. */
export function inputValueOf(input: RsvpFormInput, values: RsvpValues): Raw | null {
  const v = values[input.name];
  if (!filled(v)) return null;
  if (input.type === "TEXT_ARRAY") return { inputName: input.name, values: (Array.isArray(v) ? v : [v as string]).filter((x) => x.trim()) };
  return { inputName: input.name, value: Array.isArray(v) ? v.join(", ") : v };
}

/**
 * The Create RSVP body: the built-in identity at the top level (required fields), the whole form
 * as `form.inputValues` (only defined input names, only answered ones), `additionalGuestDetails`
 * only when the form has a guest control. "NO" only when the event's rsvpResponseType is
 * "YES_AND_NO".
 */
export function rsvpBody(
  eventId: string,
  form: RsvpForm,
  values: RsvpValues,
  status: "YES" | "NO",
  guests: { guestCount: number; guestNames: string[] } = { guestCount: 0, guestNames: [] },
): Raw {
  const ids = builtInInputs(form);
  const str = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join(" ") : (v ?? "")).trim();
  const inputValues = form.controls.flatMap((c) => c.inputs.map((i) => inputValueOf(i, values))).filter((x): x is Raw => x !== null);
  const body: Raw = {
    eventId,
    status,
    firstName: str(values[ids.firstName]),
    lastName: str(values[ids.lastName]),
    email: str(values[ids.email]),
    form: { inputValues },
  };
  if (form.guestControl) {
    const guestCount = Math.max(0, Math.min(Math.trunc(guests.guestCount) || 0, form.guestControl.maxGuests));
    body.additionalGuestDetails = { guestCount, guestNames: guests.guestNames.slice(0, guestCount).map((n) => n.trim()).filter(Boolean) };
  }
  return body;
}

/** A full event with a waitlist answers status "WAITLIST" — tell the guest they're waitlisted, not confirmed. */
export function rsvpResult(rsvp: Raw | null | undefined, sent: "YES" | "NO"): RegistrationResult {
  const status = rsvp?.status;
  return { kind: "rsvpConfirmed", status: status === "YES" || status === "NO" || status === "WAITLIST" ? status : sent };
}

export type CheckoutEvent = Pick<EventDetail, "id" | "slug">;
