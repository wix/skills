// Booking rules, request builders, and DTO mapping — transport-agnostic, imported by BOTH transports:
// ./booking.ts (the SDK) and the REST twin in templates/bookings/rest/booking.ts (fetch). The
// availability request bodies, the slot identity + mapper, the calendar-events bodies (sessions,
// recurring MASTER events → offered days and course seats), the add-on rules, the form-field rules,
// the createBooking body, the cart body, and the checkout-or-place decision live HERE, once — these
// are the payloads that are exact and easy to get subtly wrong. Raw entities may carry `_id` (SDK)
// or `id` (REST). Imports are type-only so a strip to JS emits no imports.
import type {
  AddOn,
  AddOnGroup,
  BookingFormField,
  BookingResult,
  BookingsSettings,
  CourseAvailability,
  ServiceDetail,
  ServiceLocation,
  Session,
  Slot,
  SlotsPage,
  Weekday,
} from "./types";

export type Raw = Record<string, any>;

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

// Copies of services-core's ids (same values) so this file stands alone when stripped.
/** The Wix Bookings app id — the cart line's catalogReference.appId and the events filter. */
export const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
/** Staff-member resource type id (ANY_RESOURCE fallback + staff filtering). */
export const STAFF_RESOURCE_TYPE_ID = "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155";
/** One availability page: Wix's headless package pages 1000 and follows the cursor; 100 truncates a busy week. */
export const SLOTS_PAGE_LIMIT = 1000;
/** Next-availability defaults: 3 upcoming times, clamped to 1..6, scanned to the end of the month 6 months out. */
export const NEXT_AVAILABLE_DEFAULT = 3;
export const NEXT_AVAILABLE_MAX = 6;
export const NEXT_AVAILABLE_MONTHS = 6;
/** Sessions list page size (Wix's viewer shows 7 upcoming sessions per page). */
export const SESSIONS_PAGE_SIZE = 7;

const WEEKDAYS: Weekday[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

const pad = (n: number) => String(n).padStart(2, "0");
/** Local wall-clock "YYYY-MM-DDThh:mm:ss" (NO Z) — the format the availability and calendar APIs require. */
export function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** Midnight at the start of the given day (local). */
export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());

/** The visitor's IANA time zone — used only when the site shows times in the CUSTOMER's zone. */
export const defaultTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The display-zone POLICY → the `timeZone` the availability and calendar requests send: the
 * visitor's zone under CUSTOMER_TIME_ZONE; `undefined` (omit the param) under the Wix default,
 * BUSINESS_TIME_ZONE — the server then computes in the business zone and echoes it back.
 */
export function resolveDisplayTimeZone(settings: Pick<BookingsSettings, "displayTimeZone">): string | undefined {
  return settings.displayTimeZone === "CUSTOMER" ? defaultTimeZone() : undefined;
}

/** "Eastern Time (EDT)" for a zone at a date (the abbreviation is date-dependent); "" when it can't be formatted. */
export function timeZoneLabel(timeZone: string | null | undefined, referenceDate = new Date(), locale?: string): string {
  if (!timeZone) return "";
  try {
    const part = (style: "longGeneric" | "short") =>
      new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style }).formatToParts(referenceDate).find((p) => p.type === "timeZoneName")?.value ?? "";
    const generic = part("longGeneric");
    const abbr = part("short");
    if (!generic) return abbr;
    if (!abbr || abbr === generic) return generic;
    return `${generic} (${abbr})`;
  } catch {
    return "";
  }
}

// ---- availability ----------------------------------------------------------------------------------

export interface SlotsWindow {
  from?: Date;
  days?: number;
  /** IANA zone to compute in; undefined = omit → the business zone (see resolveDisplayTimeZone). */
  timeZone?: string;
  staffId?: string;
  /** A follow-up page (from the previous response's cursor). */
  cursor?: string;
}

/** [start of `from`'s day, start of the day `days` later) as the local strings both time-slot APIs take. */
export function slotsRange({ from = new Date(), days = 7 }: SlotsWindow): { fromLocalDate: string; toLocalDate: string } {
  const start = startOfDay(from);
  return { fromLocalDate: toLocalDateString(start), toLocalDate: toLocalDateString(addDays(start, days)) };
}

/**
 * The List Availability Time Slots body for an APPOINTMENT service: bookable slots only, the staff
 * resources included on each slot, optionally narrowed to one staff member, one 1000-slot page at a
 * time (the transport follows `cursorPagingMetadata.cursors.next`). No `timeZone` key when none is
 * resolved — the server computes in the business zone and echoes it.
 */
export function appointmentSlotsRequest(serviceId: string, { timeZone, staffId, cursor, ...window }: SlotsWindow): Raw {
  return {
    serviceId,
    ...slotsRange(window),
    ...(timeZone ? { timeZone } : {}),
    bookable: true,
    cursorPaging: cursor ? { limit: SLOTS_PAGE_LIMIT, cursor } : { limit: SLOTS_PAGE_LIMIT },
    includeResourceTypeIds: [STAFF_RESOURCE_TYPE_ID],
    ...(staffId ? { resourceTypes: [{ resourceTypeId: STAFF_RESOURCE_TYPE_ID, resourceIds: [staffId] }] } : {}),
  };
}

/**
 * The List Event Time Slots body for a CLASS service: its sessions INCLUDING full ones (they render
 * disabled as "Full" instead of vanishing), optionally one staff member's, paged like appointments
 * (the cursor rides `pagingMetadata.cursors.next` on this API).
 */
export function classSlotsRequest(serviceId: string, { timeZone, staffId, cursor, ...window }: SlotsWindow): Raw {
  return {
    serviceIds: [serviceId],
    ...slotsRange(window),
    ...(timeZone ? { timeZone } : {}),
    includeNonBookable: true,
    cursorPaging: cursor ? { limit: SLOTS_PAGE_LIMIT, cursor } : { limit: SLOTS_PAGE_LIMIT },
    ...(staffId ? { eventFilter: { "resources.id": { $hasSome: [staffId] } } } : {}),
  };
}

/** The next page's cursor out of either time-slots response (they name the metadata differently); null at the end. */
export const nextSlotsCursor = (res: Raw | null | undefined): string | null =>
  res?.cursorPagingMetadata?.cursors?.next ?? res?.pagingMetadata?.cursors?.next ?? null;

export interface NextAvailableOptions {
  limit?: number;
  staffId?: string;
  timeZone?: string;
}

/** Start of today → end of the last day of the month NEXT_AVAILABLE_MONTHS ahead (Wix's scan window). */
export function nextAvailableRange(now = new Date()): { fromLocalDate: string; toLocalDate: string } {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + NEXT_AVAILABLE_MONTHS + 1, 0, 23, 59, 59);
  return { fromLocalDate: toLocalDateString(startOfDay(now)), toLocalDate: toLocalDateString(lastDay) };
}

export const clampNextAvailable = (n: number | undefined): number => Math.min(Math.max(n ?? NEXT_AVAILABLE_DEFAULT, 1), NEXT_AVAILABLE_MAX);

/** The next-availability body: the same two APIs, bookable slots only, the first `limit` of them. */
export function nextAvailableRequest(service: Pick<ServiceDetail, "id" | "type">, { limit, staffId, timeZone }: NextAvailableOptions = {}): Raw {
  const cursorPaging = { limit: clampNextAvailable(limit) };
  if (service.type === "CLASS") {
    return {
      serviceIds: [service.id],
      ...nextAvailableRange(),
      ...(timeZone ? { timeZone } : {}),
      includeNonBookable: false,
      cursorPaging,
      ...(staffId ? { eventFilter: { "resources.id": { $hasSome: [staffId] } } } : {}),
    };
  }
  return {
    serviceId: service.id,
    ...nextAvailableRange(),
    ...(timeZone ? { timeZone } : {}),
    bookable: true,
    cursorPaging,
    includeResourceTypeIds: [STAFF_RESOURCE_TYPE_ID],
    ...(staffId ? { resourceTypes: [{ resourceTypeId: STAFF_RESOURCE_TYPE_ID, resourceIds: [staffId] }] } : {}),
  };
}

/** Next-availability is shown only where a plain time is the whole choice: not VARIED pricing, add-ons, or a course. */
export const showsNextAvailability = (service: Pick<ServiceDetail, "type" | "rateType" | "hasAddOns">): boolean =>
  service.type !== "COURSE" && service.rateType !== "VARIED" && !service.hasAddOns;

/** A slot's identity: start|end|location. The same time at two locations is two slots; two staff at one time is one. */
export const slotKey = (raw: Raw): string => `${raw.localStartDate ?? ""}|${raw.localEndDate ?? ""}|${rawId(raw.location)}`;

/** Multi-staff appointments return one slot per staff member for the same time — merged into one, staff concatenated. */
export function dedupeSlots(raws: Raw[]): Raw[] {
  const byKey = new Map<string, Raw>();
  for (const raw of raws) {
    const key = slotKey(raw);
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, raw);
    else if (raw.availableResources?.length) byKey.set(key, { ...seen, availableResources: [...(seen.availableResources ?? []), ...raw.availableResources] });
  }
  return [...byKey.values()];
}

const timeLabel = (local: string, locale?: string): string => {
  try {
    return new Date(local).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  } catch {
    return local.slice(11, 16);
  }
};

const toSlotLocation = (raw: Raw | undefined): ServiceLocation | null => {
  if (!raw || (!rawId(raw) && !raw.name)) return null;
  const type = (["BUSINESS", "CUSTOM", "CUSTOMER"].includes(raw.locationType) ? raw.locationType : "BUSINESS") as ServiceLocation["type"];
  return { id: rawId(raw) || null, name: raw.name ?? "", type };
};

export function toSlot(raw: Raw): Slot {
  const start: string = raw.localStartDate ?? "";
  const staff = ((raw.availableResources ?? []) as Raw[])
    .flatMap((ar) => (ar.resources ?? []) as Raw[])
    .map((r) => ({ id: rawId(r), name: r.name ?? "" }))
    .filter((r) => r.id);
  return {
    key: slotKey(raw),
    startLocal: start,
    endLocal: raw.localEndDate ?? "",
    dayKey: start.slice(0, 10),
    label: timeLabel(start),
    bookable: raw.bookable !== false,
    totalCapacity: raw.totalCapacity ?? null,
    remainingCapacity: raw.remainingCapacity ?? null,
    waitlistCapacity: raw.eventInfo?.waitingList?.remainingCapacity ?? null,
    scheduleId: raw.scheduleId ?? null,
    eventId: raw.eventInfo?.eventId ?? null,
    eventTitle: raw.eventInfo?.eventTitle ?? "",
    location: toSlotLocation(raw.location),
    staff,
  };
}

/** Raw slots from one or more pages → a deduped, ordered SlotsPage with the response's zone. */
export function toSlotsPage(raws: Raw[], timeZone: string | null | undefined): SlotsPage {
  const slots = dedupeSlots(raws).map(toSlot).sort((a, b) => a.startLocal.localeCompare(b.startLocal));
  return { slots, timeZone: timeZone ?? null };
}

export interface BookingDay {
  dayKey: string;
  dayLabel: string;
  slots: Slot[];
}

export const dayLabel = (dayKey: string, locale?: string): string => {
  try {
    return new Date(`${dayKey}T12:00:00`).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dayKey;
  }
};

/** Slots grouped by day, days in order — what a slot picker renders. */
export function groupSlotsByDay(slots: Slot[]): BookingDay[] {
  const byDay = new Map<string, Slot[]>();
  for (const s of slots) byDay.set(s.dayKey, [...(byDay.get(s.dayKey) ?? []), s]);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, daySlots]) => ({ dayKey, dayLabel: dayLabel(dayKey), slots: daySlots }));
}

/**
 * How many participants one booking may hold: the participants policy's cap, else the service's
 * capacity (1 for appointments), never more than the seats left on the chosen slot, never below 1.
 */
export function maxParticipants(service: Pick<ServiceDetail, "maxParticipantsPerBooking" | "defaultCapacity" | "type">, slot: Pick<Slot, "remainingCapacity"> | null): number {
  const policy = service.maxParticipantsPerBooking ?? service.defaultCapacity ?? 1;
  const seats = slot?.remainingCapacity ?? Infinity;
  const cap = service.type === "APPOINTMENT" ? 1 : Math.min(policy, seats);
  return Math.max(1, Number.isFinite(cap) ? cap : 1);
}

// ---- calendar events: sessions, offered days, course seats ---------------------------------------------

/**
 * The Query Events body for a schedule's upcoming sessions (INSTANCE events from the start of today,
 * open-ended, oldest first), cursor-paged. Later pages send the cursor. No `timeZone` key when none
 * is resolved — the server uses the business zone and echoes it on each event.
 */
export function sessionsRequest(scheduleId: string, { limit = SESSIONS_PAGE_SIZE, cursor, timeZone }: { limit?: number; cursor?: string; timeZone?: string } = {}): Raw {
  return {
    query: { filter: { scheduleId }, cursorPaging: cursor ? { limit, cursor } : { limit } },
    fromLocalDate: toLocalDateString(startOfDay(new Date())),
    ...(timeZone ? { timeZone } : {}),
  };
}

/**
 * The Query Events body for the recurring (MASTER) events of several schedules at once — one batched
 * call per listing page; a MASTER event carries the weekly `recurrenceRule.days` and, for a course,
 * the whole course's `totalCapacity` / `remainingCapacity`.
 */
export function masterEventsRequest(scheduleIds: string[], timeZone?: string): Raw {
  return {
    query: { filter: { appId: BOOKINGS_APP_ID, scheduleId: { $in: scheduleIds } }, cursorPaging: { limit: 500 } },
    recurrenceType: ["MASTER"],
    fromLocalDate: toLocalDateString(startOfDay(new Date())),
    ...(timeZone ? { timeZone } : {}),
  };
}

export const nextEventsCursor = (res: Raw | null | undefined): string | null => res?.pagingMetadata?.cursors?.next ?? null;

const diffMinutes = (start: string, end: string): number => {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 60_000);
};

/** A calendar event → a Session; staff are its resources of the staff type. */
export function toSession(raw: Raw): Session {
  const start: string = raw.start?.localDate ?? "";
  const end: string = raw.end?.localDate ?? "";
  const remaining: number | null = raw.remainingCapacity ?? null;
  return {
    id: rawId(raw),
    title: raw.title ?? raw.scheduleName ?? "",
    startLocal: start,
    endLocal: end,
    dayKey: start.slice(0, 10),
    dayLabel: dayLabel(start.slice(0, 10)),
    label: timeLabel(start),
    durationMinutes: diffMinutes(start, end),
    staff: ((raw.resources ?? []) as Raw[])
      .filter((r) => r.type === STAFF_RESOURCE_TYPE_ID && rawId(r))
      .map((r) => ({ id: rawId(r), name: r.name ?? "" })),
    totalCapacity: raw.totalCapacity ?? null,
    spotsLeft: remaining,
    isFullyBooked: remaining != null && remaining <= 0,
    isCancelled: raw.status === "CANCELLED",
  };
}

/** MASTER events → the weekdays each schedule meets on, in week order, without duplicates. */
export function offeredDaysByScheduleId(events: Raw[]): Record<string, Weekday[]> {
  const out: Record<string, Set<Weekday>> = {};
  for (const e of events) {
    if (!e.scheduleId) continue;
    const set = (out[e.scheduleId] ??= new Set());
    for (const d of (e.recurrenceRule?.days ?? []) as string[]) if (WEEKDAYS.includes(d as Weekday)) set.add(d as Weekday);
  }
  return Object.fromEntries(Object.entries(out).map(([id, set]) => [id, WEEKDAYS.filter((d) => set.has(d))]));
}

/** Course seats from its first MASTER event; null once the course ended or when it has no recurring session yet. */
export function courseAvailabilityOf(events: Raw[], ended: boolean): CourseAvailability | null {
  const first = events[0];
  if (ended || !first) return null;
  const spotsLeft: number | null = first.remainingCapacity ?? null;
  return { totalCapacity: first.totalCapacity ?? null, spotsLeft, full: spotsLeft != null && spotsLeft <= 0 };
}

// ---- add-ons -------------------------------------------------------------------------------------------

/** The List Add-On Groups By Service Id body. */
export const addOnGroupsRequest = (serviceId: string): Raw => ({ serviceId });

const money = (m: Raw | undefined | null): string => {
  const value = m?.value;
  const currency = m?.currency;
  if (value == null || value === "" || !currency) return "";
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return "";
  const digits = amount % 1 === 0 ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "symbol", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
};

/** The response's add-on groups → DTOs; translated names win over the originals (Wix's rule). */
export function toAddOnGroups(res: Raw | null | undefined): AddOnGroup[] {
  return ((res?.addOnGroupsDetails ?? []) as Raw[]).map((g) => ({
    id: g.groupId ?? "",
    name: g.groupNameTranslated ?? g.groupName ?? "",
    prompt: g.promptTranslated ?? g.prompt ?? "",
    maxSelectable: g.maxNumberOfAddOns ?? null,
    addOns: ((g.addOns ?? []) as Raw[])
      .map(
        (a): AddOn => ({
          id: a.addOnId ?? "",
          name: a.nameTranslated ?? a.name ?? "",
          price: money(a.price),
          priceAmount: Number(a.price?.value ?? 0) || 0,
          currency: a.price?.currency ?? "",
          durationMinutes: a.durationInMinutes ?? null,
          maxQuantity: a.maxQuantity ?? null,
        }),
      )
      .filter((a) => a.id),
  }));
}

/** Selected quantities keyed by add-on id (0 / absent = not selected). */
export type AddOnSelection = Record<string, number>;

/** A group accepts another distinct add-on while under its `maxSelectable`. */
export function canSelectMore(group: AddOnGroup, selection: AddOnSelection): boolean {
  if (group.maxSelectable == null) return true;
  return group.addOns.filter((a) => (selection[a.id] ?? 0) > 0).length < group.maxSelectable;
}

/** A selection with `id` set to `quantity` (clamped to the add-on's max, removed at 0); refuses a new pick when the group is full. */
export function withAddOnQuantity(groups: AddOnGroup[], selection: AddOnSelection, id: string, quantity: number): AddOnSelection {
  const group = groups.find((g) => g.addOns.some((a) => a.id === id));
  const addOn = group?.addOns.find((a) => a.id === id);
  if (!group || !addOn) return selection;
  const q = Math.max(0, Math.min(Math.floor(quantity), addOn.maxQuantity ?? 1));
  const next = { ...selection };
  if (q === 0) {
    delete next[id];
    return next;
  }
  if (!(selection[id] > 0) && !canSelectMore(group, selection)) return selection;
  next[id] = q;
  return next;
}

/** Price × quantity over the selection, formatted ("" when nothing priced is selected or currencies are missing). */
export function addOnsTotal(groups: AddOnGroup[], selection: AddOnSelection): string {
  let total = 0;
  let currency = "";
  for (const g of groups)
    for (const a of g.addOns) {
      const q = selection[a.id] ?? 0;
      if (q > 0 && a.priceAmount > 0) {
        total += a.priceAmount * q;
        currency ||= a.currency;
      }
    }
  return total > 0 ? money({ value: String(total), currency }) : "";
}

/** Extra minutes the selection adds to the session. */
export function addOnsDuration(groups: AddOnGroup[], selection: AddOnSelection): number {
  let minutes = 0;
  for (const g of groups) for (const a of g.addOns) minutes += (a.durationMinutes ?? 0) * (selection[a.id] ?? 0);
  return minutes;
}

// ---- the booking form -------------------------------------------------------------------------------

export const FALLBACK_FIELDS: BookingFormField[] = [
  { target: "first_name", label: "First Name", type: "STRING", required: true },
  { target: "last_name", label: "Last Name", type: "STRING", required: true },
  { target: "email", label: "Email", type: "EMAIL", required: true },
];

const FIELD_TYPES = ["STRING", "EMAIL", "PHONE", "NUMBER", "URL"];

/**
 * Flat, render-ready fields from a form summary — deleted fields and non-text types dropped, values
 * keyed by `target`. `required` comes from the full form schema (`fields[].validation.required`,
 * keyed by target); the summary doesn't carry it. Without the schema every field counts as required.
 * ALWAYS non-empty: contact basics when the schema is missing or unusable.
 */
export function toFormFields(summary: Raw | null | undefined, form?: Raw | null): BookingFormField[] {
  const requiredByTarget = new Map<string, boolean>(
    ((form?.fields ?? []) as Raw[]).filter((f) => f.target).map((f) => [f.target as string, f.validation?.required === true]),
  );
  const fields = ((summary?.fields ?? []) as Raw[])
    .filter((f) => !f.deleted)
    .filter((f) => f.type && FIELD_TYPES.includes(f.type))
    .map((f) => ({
      target: f.target ?? "",
      label: f.label ?? f.target ?? "",
      type: f.type as BookingFormField["type"],
      ...(Array.isArray(f.options) && f.options.length ? { options: f.options as string[] } : {}),
      required: requiredByTarget.get(f.target ?? "") ?? true,
    }))
    .filter((f) => f.target);
  return fields.length ? fields : FALLBACK_FIELDS;
}

// ---- createBooking → cart → checkout-or-place --------------------------------------------------------

export interface BookingOptions {
  staffId?: string;
  /** The zone the slot's local times are expressed in (the SlotsPage's `timeZone`); defaults to the visitor's. */
  timeZone?: string;
  /** How the transport spells an entity id in a request: `_id` on the SDK, `id` on REST. */
  idKey?: "_id" | "id";
  /** Seats booked at once (default 1). */
  participants?: number;
  /** Pay the deposit only (true) or the full price now (false); sent only when the service lets the visitor choose. */
  depositSelected?: boolean;
}

/** A slot's location type → the booking's: BUSINESS → OWNER_BUSINESS, CUSTOMER → CUSTOM, CUSTOM → OWNER_CUSTOM. */
export function bookingLocationType(type: ServiceLocation["type"] | undefined): "OWNER_BUSINESS" | "CUSTOM" | "OWNER_CUSTOM" {
  if (type === "CUSTOMER") return "CUSTOM";
  if (type === "CUSTOM") return "OWNER_CUSTOM";
  return "OWNER_BUSINESS";
}

/**
 * The Create Booking `booking` object. APPOINTMENT: the SLOT's scheduleId (never service.schedule.id)
 * plus start/end as local wall-clock with the time zone; CLASS: the eventId; COURSE: no slot at all —
 * `bookedEntity.schedule` with the service's schedule id enrols the visitor in every session. A chosen
 * staff member is the slot's `resource`; otherwise ANY_RESOURCE of the staff type. The location is the
 * SLOT's (id + name, type mapped) so a multi-location business books the right place; only a slot
 * without one falls back to the bare OWNER_BUSINESS type. `depositSelected` rides only when paying
 * ONLINE for a service that takes a deposit AND lets the visitor choose (otherwise the server default
 * applies). `idKey` spells ids the way the transport wants them: `_id` on the SDK, `id` on REST.
 */
export function bookingRequest(
  service: Pick<ServiceDetail, "id" | "type" | "paymentOption" | "scheduleId" | "deposit">,
  slot: Slot | null,
  { staffId, timeZone = defaultTimeZone(), idKey = "id", participants = 1, depositSelected }: BookingOptions = {},
): Raw {
  const deposit =
    depositSelected !== undefined && service.paymentOption === "ONLINE" && service.deposit && service.deposit.fullUpfrontAllowed
      ? { depositSelected }
      : {};
  const base = { selectedPaymentOption: service.paymentOption, ...deposit, totalParticipants: Math.max(1, Math.floor(participants)) };
  if (service.type === "COURSE" || !slot) {
    if (!service.scheduleId) throw new Error("This course has no schedule to book.");
    return { ...base, bookedEntity: { schedule: { scheduleId: service.scheduleId, serviceId: service.id, timezone: timeZone } } };
  }
  const staff = staffId ? slot.staff.find((s) => s.id === staffId) : undefined;
  return {
    ...base,
    bookedEntity: {
      slot: {
        serviceId: service.id,
        scheduleId: slot.scheduleId ?? undefined,
        eventId: slot.eventId ?? undefined,
        startDate: slot.startLocal,
        endDate: slot.endLocal,
        timezone: timeZone,
        ...(staff
          ? { resource: { [idKey]: staff.id, name: staff.name } }
          : { resourceSelections: [{ resourceTypeId: STAFF_RESOURCE_TYPE_ID, selectionMethod: "ANY_RESOURCE" }] }),
        location: slot.location
          ? { ...(slot.location.id ? { [idKey]: slot.location.id } : {}), name: slot.location.name, locationType: bookingLocationType(slot.location.type) }
          : { locationType: "OWNER_BUSINESS" },
      },
    },
  };
}

/**
 * The rest of the Create Booking request — the SDK's second argument, REST's top-level siblings of
 * `booking`: the visitor's form values as the formSubmission DIRECTLY, and the notifications Wix's
 * own flow sends (confirmation by email and SMS, an SMS reminder) — without them the "confirmation
 * email is on its way" copy would be false.
 */
export function bookingOptions(formValues: Record<string, unknown>): Raw {
  return {
    participantNotification: { notifyParticipants: true, metadata: { channels: "EMAIL,SMS" } },
    sendSmsReminder: true,
    formSubmission: formValues,
  };
}

/** The booking id out of a Create Booking response (wrapped { booking } on both transports). */
export const bookingIdOf = (res: Raw | null | undefined): string => rawId(res?.booking);

/** The contact the server resolved from the form, echoed on the created booking. */
export const contactOf = (res: Raw | null | undefined): Raw | undefined => res?.booking?.contactDetails ?? undefined;

/**
 * The Create Cart body that holds the booked seat(s): one line per BOOKING id (catalogItemId is the
 * booking id, never the service id), the site channel, the booking's business location, and the
 * contact the booking already resolved — so the hosted checkout doesn't ask for name and email again.
 */
export function bookingCartRequest(bookingIds: string[], contact?: Raw | null, locationId?: string | null): Raw {
  const cart: Raw = { source: { channelType: "WEB" } };
  if (locationId) cart.businessInfo = { locationId };
  if (contact) {
    cart.customerInfo = {
      ...(contact.firstName ? { firstName: contact.firstName } : {}),
      ...(contact.lastName ? { lastName: contact.lastName } : {}),
      ...(contact.phone ? { phone: contact.phone } : {}),
      ...(contact.email ? { email: contact.email } : {}),
    };
    if (contact.fullAddress?.country) {
      cart.deliveryInfo = { address: { ...contact.fullAddress } };
      cart.paymentInfo = { billingAddress: { ...contact.fullAddress } };
    }
  }
  return {
    catalogItems: bookingIds.map((id) => ({ quantity: 1, catalogReference: { catalogItemId: id, appId: BOOKINGS_APP_ID } })),
    cart,
  };
}

/** The cart id out of a Create Cart response — the SDK may unwrap the cart, REST wraps it. */
export const cartIdOf = (res: Raw | null | undefined): string => rawId(res) || rawId(res?.cart);

/** The cart's total from a Calculate Cart response (`summary.priceSummary.total`); 0 when absent. */
export const cartTotal = (calc: Raw | null | undefined): number => Number(calc?.summary?.priceSummary?.total?.amount ?? 0);

/**
 * Hosted checkout is required whenever a card must be involved: always when the service carries a
 * cancellation fee (a card goes on file); never when the calculated total is 0; never when the
 * CART LINE says the whole payment happens offline (`paymentConfig.paymentOption ===
 * "FULL_PAYMENT_OFFLINE"` — the server's resolution of the service's options, memberships included);
 * otherwise yes. Free and pay-in-person bookings therefore place the order directly.
 */
export function checkoutRequired(service: Pick<ServiceDetail, "cancellationFeeEnabled">, calc: Raw | null | undefined): boolean {
  if (service.cancellationFeeEnabled) return true;
  if (cartTotal(calc) === 0) return false;
  return calc?.cart?.lineItems?.[0]?.paymentConfig?.paymentOption !== "FULL_PAYMENT_OFFLINE";
}

/** The Create Redirect Session body for a cart's checkout; the cart id IS the checkout id. */
export function checkoutRedirectRequest(cartId: string, origin: string): Raw {
  return { ecomCheckout: { checkoutId: cartId }, callbacks: origin ? { postFlowUrl: `${origin}/` } : {} };
}

/** A placed order → the confirmed result; the order id is wherever the transport put it. */
export function confirmedResult(bookingId: string, order: Raw | null | undefined): BookingResult {
  return { kind: "confirmed", bookingId, orderId: order?.orderId ?? (rawId(order?.order) || null) };
}
