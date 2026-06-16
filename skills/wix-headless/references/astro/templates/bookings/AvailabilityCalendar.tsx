import { useCallback, useEffect, useMemo, useState } from "react";
import { availabilityTimeSlots, eventTimeSlots } from "@wix/bookings";
import type { SelectedSlot } from "./bookingDriver";
import { STAFF_MEMBER_RESOURCE_TYPE_ID } from "./bookingDriver";

// AvailabilityCalendar.tsx — client:only="react" island. A week calendar: a
// 7-day strip with week navigation, then the picked day's time slots. This is
// the usable shape — a flat list of every slot with time-only labels leaves the
// visitor unable to tell which day a slot is on.
//
// SDK calls run ambiently (the @wix/astro visitor client), like the ecom
// CartView island — no createClient/OAuthStrategy here. On an own/own-build SPA
// acquire a visitor client (OAuthStrategy) and call the same functions on it.
//
// Branches on serviceType:
//   APPOINTMENT → availabilityTimeSlots.listAvailabilityTimeSlots() (serviceId is
//                 a single GUID string; slots carry scheduleId).
//   CLASS       → eventTimeSlots.listEventTimeSlots() (serviceIds is an array;
//                 slots carry eventInfo.eventId and NO scheduleId).
//
// LOCATION SCOPING (multi-location): listAvailabilityTimeSlots returns one slot
// PER LOCATION per time — "if locations is not specified, returns time slots for
// all locations where the service is available". A service offered at >1 location
// therefore yields DUPLICATE same-time rows unless the call is scoped to a single
// location. So availability is ALWAYS scoped to one business location: the picker
// below defaults to the carried/first location and the call always passes a
// single-element `locations` filter. (One location per availability call — the
// same single-location guarantee the location-first SoT gets from its selector.)
//
// STAFF: a single slot carries multiple staff in availableResources, so staff is
// a per-slot dropdown — it never multiplies rows. Only location multiplies rows.
// Re-export SelectedSlot from bookingDriver so the form/driver share one shape.
export type { SelectedSlot } from "./bookingDriver";

// A staff member as carried on the service (service.staffMemberDetails.staffMembers[]),
// fetched via conditionalFields:["STAFF_MEMBER_DETAILS"]. NOTE: the id field is
// `staffMemberId` which — despite the name — IS the resource id (it matches the
// service's staffMemberIds and the Staff Members API resourceId). That id is what
// filters availability and books the resource.
export interface StaffMemberOption {
  staffMemberId?: string;
  name?: string;
}

// A business location the service is offered at (derived from service.locations[]).
export interface LocationOption {
  _id: string;
  name?: string;
}

interface Props {
  serviceId: string;
  serviceName: string;
  serviceType: "APPOINTMENT" | "CLASS";
  staffMembers?: StaffMemberOption[];
  locations?: LocationOption[]; // business locations the service offers
  locationId?: string; // the location chosen on the catalog (the default scope), if any
  onSlotSelected: (slot: SelectedSlot) => void;
}

interface FetchOpts {
  resourceId?: string; // a staff resource id to filter by (omit for "any staff")
  locationId?: string; // a business location id to scope to (omit only when the service has none)
}

const DAY_MS = 86_400_000;
const HORIZON_WEEKS = 13; // how far "check next availability" probes forward
const ANY_STAFF = ""; // the "any staff member" sentinel for the select value

const pad = (n: number) => String(n).padStart(2, "0");
// Local date string YYYY-MM-DDThh:mm:ss (no Z) — availability expects local time.
const localDateString = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const dateKey = (iso: string) => iso.slice(0, 10); // group slots by calendar day
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const startOfDay = (d: Date) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
// Monday-start week containing `d`.
const mondayOf = (d: Date) => {
  const n = startOfDay(d);
  const day = (n.getDay() + 6) % 7; // 0 = Monday
  n.setDate(n.getDate() - day);
  return n;
};

// Fetch one week of availability and group the slots by calendar day.
const fetchWeek = async (
  serviceId: string,
  serviceType: "APPOINTMENT" | "CLASS",
  weekStart: Date,
  opts: FetchOpts = {},
): Promise<Record<string, SelectedSlot[]>> => {
  const from = startOfDay(weekStart);
  const to = new Date(from.getTime() + 7 * DAY_MS);
  const timeZone = tz();
  let raw: any[] = [];

  if (serviceType === "CLASS") {
    // CLASS filters via eventFilter: staff by resources.id ($hasSome), location by
    // location.id (a bare array, NOT a $hasSome operator).
    const eventFilter: Record<string, any> = {};
    if (opts.resourceId) eventFilter["resources.id"] = { $hasSome: [opts.resourceId] };
    if (opts.locationId) eventFilter["location.id"] = [opts.locationId];
    const result = await eventTimeSlots.listEventTimeSlots({
      serviceIds: [serviceId], // CLASS API takes an array
      fromLocalDate: localDateString(from),
      toLocalDate: localDateString(to),
      timeZone,
      includeNonBookable: false,
      cursorPaging: { limit: 100 },
      ...(Object.keys(eventFilter).length ? { eventFilter } : {}),
    });
    raw = (result.timeSlots ?? []).map((s: any) => ({
      serviceType: "CLASS" as const,
      serviceId,
      localStartDate: s.localStartDate,
      localEndDate: s.localEndDate,
      timezone: result.timeZone ?? timeZone,
      eventId: s.eventInfo?.eventId, // session id — no scheduleId on event slots
    }));
  } else {
    // APPOINTMENT filters staff via resourceTypes (resourceIds), location via locations[].
    // Scoping to a single location collapses the per-location duplicate rows.
    const result = await availabilityTimeSlots.listAvailabilityTimeSlots({
      serviceId, // single GUID string — NOT an array
      fromLocalDate: localDateString(from),
      toLocalDate: localDateString(to),
      timeZone,
      bookable: true,
      cursorPaging: { limit: 100 },
      ...(opts.resourceId
        ? {
            resourceTypes: [
              { resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID, resourceIds: [opts.resourceId] },
            ],
            includeResourceTypeIds: [STAFF_MEMBER_RESOURCE_TYPE_ID],
          }
        : {}),
      ...(opts.locationId
        ? { locations: [{ _id: opts.locationId, locationType: "BUSINESS" as const }] }
        : {}),
    });
    raw = (result.timeSlots ?? []).map((s: any) => ({
      serviceType: "APPOINTMENT" as const,
      serviceId,
      localStartDate: s.localStartDate,
      localEndDate: s.localEndDate,
      timezone: result.timeZone ?? timeZone,
      scheduleId: s.scheduleId,
      locationId: s.location?._id, // the id field is _id, not .id
      locationType: s.location?.locationType,
    }));
  }

  const byDay: Record<string, SelectedSlot[]> = {};
  for (const slot of raw) {
    if (!slot.localStartDate) continue;
    (byDay[dateKey(slot.localStartDate)] ||= []).push(slot);
  }
  return byDay;
};

export default function AvailabilityCalendar({
  serviceId,
  serviceName,
  serviceType,
  staffMembers,
  locations,
  locationId,
  onSlotSelected,
}: Props) {
  const thisMonday = useMemo(() => mondayOf(new Date()), []);
  const [weekStart, setWeekStart] = useState<Date>(thisMonday);
  const [byDay, setByDay] = useState<Record<string, SelectedSlot[]>>({});
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "searching">("loading");
  // The chosen staff resource id ("" = any staff member → ANY_RESOURCE fallback).
  const [selectedResource, setSelectedResource] = useState<string>(ANY_STAFF);

  // Staff options keyed by resource id; picker shown only when >1 staff.
  const staffOptions = useMemo(
    () =>
      (staffMembers ?? [])
        .map((s) => ({ id: s.staffMemberId ?? "", name: s.name ?? "Staff member" }))
        .filter((s) => s.id),
    [staffMembers],
  );
  const showStaffPicker = staffOptions.length > 1;

  // Business-location options. Availability is always scoped to ONE of these (the
  // carried location if it's one of them, else the first), so multi-location
  // services don't return duplicate per-location rows. Picker shown only when >1.
  const locationOptions = useMemo(
    () => (locations ?? []).filter((l) => l._id),
    [locations],
  );
  const [selectedLocation, setSelectedLocation] = useState<string>(() => {
    if (locationId && locationOptions.some((l) => l._id === locationId)) return locationId;
    return locationOptions[0]?._id ?? "";
  });
  const showLocationPicker = locationOptions.length > 1;

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS)),
    [weekStart],
  );
  const atFirstWeek = weekStart.getTime() <= thisMonday.getTime();

  const fetchOpts = useCallback(
    (): FetchOpts => ({
      resourceId: selectedResource || undefined,
      locationId: selectedLocation || undefined,
    }),
    [selectedResource, selectedLocation],
  );

  const load = useCallback(async (start: Date) => {
    setStatus("loading"); setSelectedKey(null);
    try {
      const grouped = await fetchWeek(serviceId, serviceType, start, fetchOpts());
      setByDay(grouped);
      const firstDayWithSlots = Object.keys(grouped).sort()[0] ?? null;
      setSelectedDay(firstDayWithSlots);
      setStatus("ready");
    } catch (err) {
      console.error("[availability] list failed:", err);
      setStatus("error");
    }
  }, [serviceId, serviceType, fetchOpts]);

  // Reload whenever the week OR the staff/location filter changes.
  useEffect(() => { void load(weekStart); }, [weekStart, load]);

  const shiftWeek = (deltaWeeks: number) =>
    setWeekStart((prev) => startOfDay(new Date(prev.getTime() + deltaWeeks * 7 * DAY_MS)));

  // Probe forward week-by-week for the next week that has any slots.
  const checkNextAvailability = useCallback(async () => {
    setStatus("searching");
    let cursor = new Date(weekStart.getTime() + 7 * DAY_MS);
    for (let i = 0; i < HORIZON_WEEKS; i++) {
      try {
        const grouped = await fetchWeek(serviceId, serviceType, cursor, fetchOpts());
        if (Object.keys(grouped).length > 0) {
          setWeekStart(cursor); // triggers load() via the effect
          return;
        }
      } catch { /* keep probing */ }
      cursor = new Date(cursor.getTime() + 7 * DAY_MS);
    }
    setStatus("ready"); // nothing found within the horizon
  }, [serviceId, serviceType, weekStart, fetchOpts]);

  const handleSelect = (s: SelectedSlot) => {
    const id = s.serviceType === "CLASS" ? s.eventId : s.scheduleId;
    if (!s.localStartDate || !id) return;
    setSelectedKey(`${s.localStartDate}|${id}`);
    // When a specific staff was chosen, record it on the slot so the booking books
    // that resource; otherwise the driver emits the ANY_RESOURCE fallback.
    const chosen = selectedResource
      ? staffOptions.find((o) => o.id === selectedResource)
      : null;
    onSlotSelected(chosen ? { ...s, resource: { _id: chosen.id, name: chosen.name } } : s);
  };

  const weekLabel = `${days[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString([], { month: "short", day: "numeric" })}`;
  const daySlots = selectedDay ? byDay[selectedDay] ?? [] : [];
  const weekIsEmpty = status === "ready" && Object.keys(byDay).length === 0;

  return (
    <div className="availability-calendar">
      {(showLocationPicker || showStaffPicker) && (
        <div className="availability-filters">
          {showLocationPicker && (
            <div className="availability-staff">
              <label className="availability-staff-label" htmlFor="location-select">Location</label>
              <select
                id="location-select"
                className="availability-staff-select"
                value={selectedLocation}
                onChange={(e) => { setSelectedLocation(e.target.value); setSelectedKey(null); }}
              >
                {locationOptions.map((o) => (
                  <option key={o._id} value={o._id}>{o.name ?? "Location"}</option>
                ))}
              </select>
            </div>
          )}
          {showStaffPicker && (
            <div className="availability-staff">
              <label className="availability-staff-label" htmlFor="staff-select">Staff member</label>
              <select
                id="staff-select"
                className="availability-staff-select"
                value={selectedResource}
                onChange={(e) => { setSelectedResource(e.target.value); setSelectedKey(null); }}
              >
                <option value={ANY_STAFF}>Any staff member</option>
                {staffOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="availability-week-nav">
        <button type="button" className="availability-nav-btn" onClick={() => shiftWeek(-1)} disabled={atFirstWeek} aria-label="Previous week">← Prev week</button>
        <span className="availability-week-label">{weekLabel}</span>
        <button type="button" className="availability-nav-btn" onClick={() => shiftWeek(1)} aria-label="Next week">Next week →</button>
      </div>

      <div className="availability-day-strip" role="group" aria-label="Pick a day">
        {days.map((d) => {
          const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const has = (byDay[key]?.length ?? 0) > 0;
          const isSelected = key === selectedDay;
          return (
            <button
              key={key}
              type="button"
              className={["availability-day", isSelected ? "availability-day--selected" : "", has ? "availability-day--has-slots" : "availability-day--empty"].filter(Boolean).join(" ")}
              disabled={!has}
              aria-pressed={isSelected}
              onClick={() => { setSelectedDay(key); setSelectedKey(null); }}
            >
              <span className="availability-day-name">{d.toLocaleDateString([], { weekday: "short" })}</span>
              <span className="availability-day-num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      {status === "loading" && <p className="availability-loading">Checking availability…</p>}
      {status === "searching" && <p className="availability-loading">Searching for the next available time…</p>}
      {status === "error" && (
        <>
          <p className="availability-error">Could not load availability — please try again.</p>
          <button type="button" className="availability-nav-btn" onClick={() => void load(weekStart)}>Retry</button>
        </>
      )}
      {weekIsEmpty && (
        <div className="availability-empty">
          <p>No availability this week.</p>
          <button type="button" className="availability-nav-btn" onClick={() => void checkNextAvailability()}>Check next availability</button>
        </div>
      )}
      {status === "ready" && daySlots.length > 0 && (
        <div className="availability-slots" role="group" aria-label={`Available times for ${serviceName}`}>
          {daySlots.map((s) => {
            const id = s.serviceType === "CLASS" ? s.eventId : s.scheduleId;
            const key = `${s.localStartDate}|${id}`;
            const isSelected = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                className={["time-slot", isSelected ? "time-slot--selected" : "time-slot--available"].join(" ")}
                aria-pressed={isSelected}
                onClick={() => handleSelect(s)}
              >
                <span className="time-slot-time">{timeLabel(s.localStartDate)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
