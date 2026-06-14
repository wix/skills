import { useCallback, useEffect, useMemo, useState } from "react";
import { availabilityTimeSlots, eventTimeSlots } from "@wix/bookings";
import type { SelectedSlot } from "./bookingDriver";

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
// Re-export SelectedSlot from bookingDriver so the form/driver share one shape.
export type { SelectedSlot } from "./bookingDriver";

interface Props {
  serviceId: string;
  serviceName: string;
  serviceType: "APPOINTMENT" | "CLASS";
  onSlotSelected: (slot: SelectedSlot) => void;
}

const DAY_MS = 86_400_000;
const HORIZON_WEEKS = 13; // how far "check next availability" probes forward

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
): Promise<Record<string, SelectedSlot[]>> => {
  const from = startOfDay(weekStart);
  const to = new Date(from.getTime() + 7 * DAY_MS);
  const timeZone = tz();
  let raw: any[] = [];

  if (serviceType === "CLASS") {
    const result = await eventTimeSlots.listEventTimeSlots({
      serviceIds: [serviceId], // CLASS API takes an array
      fromLocalDate: localDateString(from),
      toLocalDate: localDateString(to),
      timeZone,
      includeNonBookable: false,
      cursorPaging: { limit: 100 },
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
    const result = await availabilityTimeSlots.listAvailabilityTimeSlots({
      serviceId, // single GUID string — NOT an array
      fromLocalDate: localDateString(from),
      toLocalDate: localDateString(to),
      timeZone,
      bookable: true,
      cursorPaging: { limit: 100 },
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

export default function AvailabilityCalendar({ serviceId, serviceName, serviceType, onSlotSelected }: Props) {
  const thisMonday = useMemo(() => mondayOf(new Date()), []);
  const [weekStart, setWeekStart] = useState<Date>(thisMonday);
  const [byDay, setByDay] = useState<Record<string, SelectedSlot[]>>({});
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "searching">("loading");

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS)),
    [weekStart],
  );
  const atFirstWeek = weekStart.getTime() <= thisMonday.getTime();

  const load = useCallback(async (start: Date) => {
    setStatus("loading"); setSelectedKey(null);
    try {
      const grouped = await fetchWeek(serviceId, serviceType, start);
      setByDay(grouped);
      const firstDayWithSlots = Object.keys(grouped).sort()[0] ?? null;
      setSelectedDay(firstDayWithSlots);
      setStatus("ready");
    } catch (err) {
      console.error("[availability] list failed:", err);
      setStatus("error");
    }
  }, [serviceId, serviceType]);

  useEffect(() => { void load(weekStart); }, [weekStart, load]);

  const shiftWeek = (deltaWeeks: number) =>
    setWeekStart((prev) => startOfDay(new Date(prev.getTime() + deltaWeeks * 7 * DAY_MS)));

  // Probe forward week-by-week for the next week that has any slots.
  const checkNextAvailability = useCallback(async () => {
    setStatus("searching");
    let cursor = new Date(weekStart.getTime() + 7 * DAY_MS);
    for (let i = 0; i < HORIZON_WEEKS; i++) {
      try {
        const grouped = await fetchWeek(serviceId, serviceType, cursor);
        if (Object.keys(grouped).length > 0) {
          setWeekStart(cursor); // triggers load() via the effect
          return;
        }
      } catch { /* keep probing */ }
      cursor = new Date(cursor.getTime() + 7 * DAY_MS);
    }
    setStatus("ready"); // nothing found within the horizon
  }, [serviceId, serviceType, weekStart]);

  const handleSelect = (s: SelectedSlot) => {
    const id = s.serviceType === "CLASS" ? s.eventId : s.scheduleId;
    if (!s.localStartDate || !id) return;
    setSelectedKey(`${s.localStartDate}|${id}`);
    onSlotSelected(s);
  };

  const weekLabel = `${days[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString([], { month: "short", day: "numeric" })}`;
  const daySlots = selectedDay ? byDay[selectedDay] ?? [] : [];
  const weekIsEmpty = status === "ready" && Object.keys(byDay).length === 0;

  return (
    <div className="availability-calendar">
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
