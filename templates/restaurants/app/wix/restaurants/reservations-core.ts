// Table-reservation rules and DTO mapping — transport-agnostic, imported by both
// ./reservations.ts (SDK) and the REST twin in templates/restaurants/rest/reservations.ts (fetch).
// The flow is location → slots → (AUTOMATIC approval) hold, then reserve with the visitor's
// details, or (MANUAL approval) one createReservation with details + reservee and NO hold — the two
// paths Wix's own reservation code takes. Every instant is computed in the LOCATION's timezone
// (slot search window, labels, day keys), never the visitor's. A reservation is a hold, not a
// purchase. Raw entities carry `_id` (SDK) or `id` (REST); dates arrive as Date (SDK) or ISO
// string (REST). Imports are type-only except the zone helpers from ./time-core.
import type {
  ReservationConfirmation,
  ReservationCustomField,
  ReservationFormConfig,
  ReservationHold,
  ReservationLocationInfo,
  ReservationPolicy,
  ReservationReservee,
  ReservationSlot,
  ReservationStatus,
} from "./types";
import type { Raw } from "./menu-core";
import { zonedDayKey, zonedTimeLabel } from "./time-core";

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

/** A hold lasts 10 minutes from its creation (Wix's own countdown: 600 s from _createdDate). */
export const HOLD_SECONDS = 10 * 60;

// ---- locations -----------------------------------------------------------------------------------------------

const toPolicy = (raw: Raw | undefined): ReservationPolicy | null =>
  raw && raw.enabled !== false && (raw.url || raw.text) ? { url: raw.url ?? "", text: raw.text ?? "" } : null;

/** The owner's form configuration (reservationForm) → what to render and what to require. */
export function toFormConfig(raw: Raw | undefined): ReservationFormConfig {
  const f: Raw = raw ?? {};
  return {
    lastNameRequired: f.lastNameRequired === true,
    emailRequired: f.emailRequired === true,
    marketingCheckbox: f.emailMarketingCheckbox?.enabled === true ? { checkedByDefault: f.emailMarketingCheckbox.checkedByDefault === true } : null,
    customFields: ((f.customFieldDefinitions ?? []) as Raw[])
      .map((d): ReservationCustomField => ({ id: rawId(d), name: d.name ?? "", required: d.required === true }))
      .filter((d) => d.id),
    terms: toPolicy(f.termsAndConditions),
    privacy: toPolicy(f.privacyPolicy),
    submitMessage: f.submitMessage ?? "",
  };
}

export function toLocation(raw: Raw): ReservationLocationInfo {
  const online: Raw = raw.configuration?.onlineReservations ?? {};
  const approval: Raw = online.approval ?? {};
  const mode = approval.mode === "MANUAL" || approval.mode === "MANUAL_FOR_LARGE_PARTIES" ? approval.mode : "AUTOMATIC";
  const threshold = approval.manualForLargePartiesOptions?.partySizeThreshold;
  return {
    id: rawId(raw),
    name: raw.location?.name ?? "",
    address: raw.location?.address?.formatted ?? "",
    timeZone: raw.location?.timeZone ?? "",
    default: raw.default === true,
    partySizeMin: online.partySize?.min ?? 1,
    partySizeMax: online.partySize?.max ?? 1, // Wix's default when the owner set no maximum
    approvalMode: mode,
    manualApprovalPartySizeThreshold: mode === "MANUAL_FOR_LARGE_PARTIES" && typeof threshold === "number" ? threshold : null,
    onlineReservationsEnabled: online.onlineReservationsEnabled === true,
    form: toFormConfig(raw.configuration?.reservationForm),
  };
}

/**
 * The locations to offer, Wix's rule: only those with online reservations ENABLED (the default
 * one first when it is enabled); when none is enabled, only the default location, so the surface
 * can say "online reservations aren't open" instead of listing dead options. [] when none exist.
 */
export function toLocations(raws: Raw[]): ReservationLocationInfo[] {
  const all = raws.filter((l) => l.archived !== true).map(toLocation).filter((l) => l.id);
  const enabled = all.filter((l) => l.onlineReservationsEnabled);
  if (enabled.length) return enabled.sort((a, b) => Number(b.default) - Number(a.default));
  const def = all.find((l) => l.default);
  return def ? [def] : [];
}

/** AUTOMATIC → hold then reserve; MANUAL → one createReservation, no hold (also MANUAL_FOR_LARGE_PARTIES from the threshold up). */
export function resolveApproval(location: Pick<ReservationLocationInfo, "approvalMode" | "manualApprovalPartySizeThreshold">, partySize: number): "AUTOMATIC" | "MANUAL" {
  if (location.approvalMode === "MANUAL") return "MANUAL";
  if (location.approvalMode === "MANUAL_FOR_LARGE_PARTIES" && partySize >= (location.manualApprovalPartySizeThreshold ?? 0)) return "MANUAL";
  return "AUTOMATIC";
}

// ---- slots ----------------------------------------------------------------------------------------------------------

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

/** A raw slot → DTO with its label and day key in the LOCATION's timezone. */
export function toSlot(raw: Raw, timeZone: string): ReservationSlot {
  const start = toDate(raw.startDate);
  return {
    startIso: start.toISOString(),
    label: zonedTimeLabel(start, timeZone),
    dayKey: zonedDayKey(start, timeZone),
    durationMinutes: raw.duration ?? 0,
    manualApproval: raw.manualApproval === true,
  };
}

/** AVAILABLE slots only — UNAVAILABLE and NON_WORKING_HOURS are dropped (offering them makes the hold fail). */
export function availableSlots(raws: Raw[], timeZone: string): ReservationSlot[] {
  return raws.filter((s) => s.status === "AVAILABLE").map((s) => toSlot(s, timeZone));
}

// ---- hold ------------------------------------------------------------------------------------------------------------

/** The hold's { reservationId, revision } that completeReservation NEEDS, plus its expiry; throws when the slot wasn't held. */
export function toHold(res: Raw | null | undefined, startIso: string, partySize: number): ReservationHold {
  const reservationId = rawId(res?.reservation);
  const revision = res?.reservation?.revision;
  if (!reservationId || !revision) {
    throw new Error("That time couldn't be held — it may have just been taken. Pick another slot.");
  }
  const created = res?.reservation?._createdDate ?? res?.reservation?.createdDate;
  const createdMs = created ? toDate(created).getTime() : NaN;
  const expiresAt = new Date((Number.isFinite(createdMs) ? createdMs : Date.now()) + HOLD_SECONDS * 1000);
  return { reservationId, revision: String(revision), startIso, partySize, expiresAtIso: expiresAt.toISOString() };
}

/** Whole seconds until the hold lapses (0 when it has). */
export function holdSecondsLeft(hold: Pick<ReservationHold, "expiresAtIso">, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(hold.expiresAtIso).getTime() - now.getTime()) / 1000));
}

// ---- reservee form ------------------------------------------------------------------------------------------

const STRING_LIMIT = 200; // Wix's COMMON_STRING_LIMIT: every text field shorter than this
const EMAIL = /^(([^<>()[\].,;:\s@"]+(\.[^<>()[\].,;:\s@"]+)*)|(".+"))@(([^<>()[\].,;:\s@"]+\.)+[^<>()[\].,;:\s@"]{2,})$/i;
// E.164-shaped after stripping formatting: optional +, 7-15 digits, no leading 0 (no libphonenumber dependency).
const PHONE = /^\+?[1-9]\d{6,14}$/;

const okString = (value: string | undefined, required: boolean): boolean => {
  const v = (value ?? "").trim();
  if (!v) return !required;
  return v.length < STRING_LIMIT;
};

/** The visitor's phone with spaces, dashes, dots, and parentheses removed — what gets validated and sent. */
export const normalizePhone = (phone: string | undefined): string => (phone ?? "").replace(/[\s().-]/g, "");

/**
 * Validate the reservee against the location's form config, Wix's rules: firstName and phone
 * always required; lastName/email per config; email by pattern; phone E.164-shaped; every text
 * under 200 characters; each required custom field filled. Empty `errors` means submittable.
 */
export function validateReservee(reservee: ReservationReservee, form: ReservationFormConfig): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!okString(reservee.firstName, true)) errors.firstName = "First name is required.";
  if (!okString(reservee.lastName, form.lastNameRequired)) errors.lastName = form.lastNameRequired ? "Last name is required." : "Last name is too long.";
  const phone = normalizePhone(reservee.phone);
  if (!phone) errors.phone = "Phone number is required.";
  else if (!PHONE.test(phone)) errors.phone = "Enter a phone number with its country code, e.g. +15551234567.";
  const email = (reservee.email ?? "").trim();
  if (!email && form.emailRequired) errors.email = "Email is required.";
  else if (email && !(EMAIL.test(email) && email.length < STRING_LIMIT)) errors.email = "Enter a valid email address.";
  for (const f of form.customFields) {
    if (!okString(reservee.customFields?.[f.id], f.required)) errors[`custom:${f.id}`] = f.required ? `${f.name || "This field"} is required.` : `${f.name || "This field"} is too long.`;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * The reservee body of a reserve/create: validated against the form, trimmed, optional fields
 * only when filled, `marketingConsent` only when the form shows the checkbox, `customFields` as
 * { id: answer } for the filled ones. Throws the first validation message.
 */
export function reserveeBody(reservee: ReservationReservee, form: ReservationFormConfig): Raw {
  const check = validateReservee(reservee, form);
  if (!check.ok) throw new Error(Object.values(check.errors)[0]);
  const customFields = Object.fromEntries(
    form.customFields.map((f) => [f.id, (reservee.customFields?.[f.id] ?? "").trim()]).filter(([, v]) => v),
  );
  return {
    firstName: reservee.firstName.trim(),
    phone: normalizePhone(reservee.phone),
    ...(reservee.lastName?.trim() ? { lastName: reservee.lastName.trim() } : {}),
    ...(reservee.email?.trim() ? { email: reservee.email.trim() } : {}),
    ...(form.marketingCheckbox ? { marketingConsent: reservee.marketingConsent === true } : {}),
    ...(Object.keys(customFields).length ? { customFields } : {}),
  };
}

/** The body of a MANUAL-approval createReservation: details + reservee, no hold. */
export function reservationBody(locationId: string, startIso: string, partySize: number, reservee: ReservationReservee, form: ReservationFormConfig): Raw {
  if (!locationId || !startIso || !partySize) throw new Error("Pick a time before sending the request.");
  return {
    details: { reservationLocationId: locationId, startDate: startIso, partySize },
    reservee: reserveeBody(reservee, form),
  };
}

// ---- outcome -------------------------------------------------------------------------------------------------------

const STATUSES: ReservationStatus[] = ["HELD", "RESERVED", "REQUESTED", "PAYMENT_INFORMATION_PENDING", "CANCELED", "DECLINED", "FINISHED", "NO_SHOW", "SEATED"];

/** RESERVED is the only confirmed status; REQUESTED and PAYMENT_INFORMATION_PENDING are pending; the rest are other. */
export function confirmationOutcome(status: ReservationStatus): ReservationConfirmation["outcome"] {
  if (status === "RESERVED") return "confirmed";
  if (status === "REQUESTED" || status === "PAYMENT_INFORMATION_PENDING") return "pending";
  return "other";
}

/** The API's real status, unmapped. Throws when no reservation came back (an expired hold). */
export function toConfirmation(res: Raw | null | undefined): ReservationConfirmation {
  const reservation: Raw | undefined = res?.reservation;
  const reservationId = rawId(reservation);
  if (!reservationId) {
    throw new Error("The reservation couldn't be completed — the hold may have expired. Start over.");
  }
  const raw = String(reservation?.status ?? "");
  const status: ReservationStatus = (STATUSES as string[]).includes(raw) ? (raw as ReservationStatus) : "UNKNOWN";
  return { reservationId, status, outcome: confirmationOutcome(status) };
}
