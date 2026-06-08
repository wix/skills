import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, OAuthStrategy } from "@wix/sdk";
import { availabilityTimeSlots, eventTimeSlots, bookings } from "@wix/bookings";
// Browser client ID comes from astro:env/client (NOT import.meta.env, which is
// undefined in the browser bundle → OAuthStrategy posts an empty client_id and
// oauth2/token 400s).
import { WIX_CLIENT_ID } from "astro:env/client";

// AvailabilityCalendar.tsx — client:only="react" island. Date navigator + slot
// grid. Branches on serviceType:
//   APPOINTMENT → availabilityTimeSlots.listAvailabilityTimeSlots() (1-on-1;
//                 slots carry scheduleId + startDate).
//   CLASS       → eventTimeSlots.listEventTimeSlots() (group sessions; slots
//                 carry eventInfo.eventId + capacity; NO scheduleId).
// Adapt styling/copy; keep the SDK wiring + slot normalization.

export interface SelectedSlot {
  serviceType: "APPOINTMENT" | "CLASS";
  localStartDate: string;
  localEndDate: string;
  serviceId: string;
  timezone: string;
  // APPOINTMENT only:
  scheduleId?: string;
  locationId?: string;
  locationType?: string;
  // CLASS only:
  eventId?: string;
  totalCapacity?: number;
  remainingCapacity?: number;
  bookableCapacity?: number;
  isFull?: boolean; // CLASS full → waitlist
  // resolved on select (CLASS):
  instructorName?: string;
}

interface Props {
  serviceId: string;
  serviceName: string;
  serviceType: "APPOINTMENT" | "CLASS";
  onSlotSelected: (slot: SelectedSlot) => void;
}

const wixClient = createClient({
  modules: { availabilityTimeSlots, eventTimeSlots, bookings },
  auth: OAuthStrategy({ clientId: WIX_CLIENT_ID }),
});

const pad = (n: number) => String(n).padStart(2, "0");
// Local date string YYYY-MM-DDThh:mm:ss (no Z) — API expects local business time.
const localDateString = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const fetchSlots = async (
  serviceId: string,
  serviceType: "APPOINTMENT" | "CLASS",
  date: Date,
): Promise<{ slots: SelectedSlot[]; timezone: string }> => {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(date); end.setHours(23, 59, 59, 0);
  const timeZone = tz();

  if (serviceType === "CLASS") {
    const result = await wixClient.eventTimeSlots.listEventTimeSlots({
      serviceIds: [serviceId], // plural for the CLASS API
      fromLocalDate: localDateString(start),
      toLocalDate: localDateString(end),
      timeZone,
      includeNonBookable: true, // include full sessions → waitlist CTA
      cursorPaging: { limit: 50 },
    });
    const z = result.timeZone ?? timeZone;
    const slots: SelectedSlot[] = (result.timeSlots ?? []).map((s: any) => ({
      serviceType: "CLASS",
      serviceId,
      localStartDate: s.localStartDate,
      localEndDate: s.localEndDate,
      eventId: s.eventInfo?.eventId, // session id — NO scheduleId on event slots
      totalCapacity: s.totalCapacity ?? undefined,
      remainingCapacity: s.remainingCapacity ?? undefined,
      bookableCapacity: s.bookableCapacity ?? undefined,
      isFull: (s.bookableCapacity ?? s.remainingCapacity ?? 0) <= 0,
      timezone: z,
    }));
    return { slots, timezone: z };
  }

  // APPOINTMENT
  const result = await wixClient.availabilityTimeSlots.listAvailabilityTimeSlots({
    serviceId, // a single GUID STRING — NOT an array (the array form is the CLASS `serviceIds` field)
    fromLocalDate: localDateString(start),
    toLocalDate: localDateString(end),
    timeZone,
    bookable: true,
    cursorPaging: { limit: 50 },
  });
  const z = result.timeZone ?? timeZone;
  const slots: SelectedSlot[] = (result.timeSlots ?? []).map((s: any) => ({
    serviceType: "APPOINTMENT",
    serviceId,
    localStartDate: s.localStartDate,
    localEndDate: s.localEndDate,
    scheduleId: s.scheduleId,
    locationId: s.location?.id,
    locationType: s.location?.locationType,
    isFull: false,
    timezone: z,
  }));
  return { slots, timezone: z };
};

// CLASS instructor lives on the event's resources, which the LIST call omits —
// only getEventTimeSlot returns them. Resolve for the picked slot.
const fetchInstructor = async (eventId: string): Promise<string | undefined> => {
  try {
    const { timeSlot } = await wixClient.eventTimeSlots.getEventTimeSlot(eventId);
    const names = (timeSlot?.availableResources ?? [])
      .flatMap((g: any) => g.resources ?? [])
      .map((r: any) => r.name)
      .filter(Boolean);
    return names[0];
  } catch {
    return undefined;
  }
};

const dayLabel = (d: Date) =>
  d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const capacityLabel = (s: SelectedSlot): string | null => {
  if (s.serviceType !== "CLASS") return null;
  const left = s.bookableCapacity ?? s.remainingCapacity ?? 0;
  if (left <= 0) return "Full · join waitlist";
  if (left <= 3) return `${left} spot${left === 1 ? "" : "s"} left`;
  return `${left} spots`;
};

export default function AvailabilityCalendar({ serviceId, serviceName, serviceType, onSlotSelected }: Props) {
  const [date, setDate] = useState<Date>(() => startOfToday());
  const [slots, setSlots] = useState<SelectedSlot[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const today = useMemo(() => startOfToday(), []);
  const atToday = date.getTime() <= today.getTime();

  const load = useCallback(async (target: Date) => {
    setStatus("loading"); setSelectedKey(null);
    try {
      const { slots: fetched } = await fetchSlots(serviceId, serviceType, target);
      setSlots(fetched); setStatus("ready");
    } catch (err) {
      console.error("[availability] list failed:", err);
      setStatus("error");
    }
  }, [serviceId, serviceType]);

  useEffect(() => { void load(date); }, [date, load]);

  const shiftDay = (delta: number) =>
    setDate((prev) => { const n = new Date(prev); n.setDate(n.getDate() + delta); n.setHours(0, 0, 0, 0); return n; });

  const keyOf = (s: SelectedSlot) => `${s.localStartDate}|${s.eventId ?? s.scheduleId ?? ""}`;

  const handleSelect = async (s: SelectedSlot) => {
    // Guard on the type-appropriate id — CLASS slots have no scheduleId.
    const id = s.serviceType === "CLASS" ? s.eventId : s.scheduleId;
    if (!s.localStartDate || !id) return;
    setSelectedKey(keyOf(s));
    const instructorName = s.serviceType === "CLASS" && s.eventId ? await fetchInstructor(s.eventId) : undefined;
    onSlotSelected({ ...s, instructorName });
  };

  return (
    <div className="availability-calendar">
      <div className="availability-date-nav">
        <button type="button" className="availability-nav-btn" onClick={() => shiftDay(-1)} disabled={atToday} aria-label="Previous day">← Prev</button>
        <span className="availability-date-label">{dayLabel(date)}</span>
        <button type="button" className="availability-nav-btn" onClick={() => shiftDay(1)} aria-label="Next day">Next →</button>
      </div>

      {status === "loading" && <p className="availability-loading">Checking availability…</p>}
      {status === "error" && (
        <>
          <p className="availability-error">Could not load availability — please try again.</p>
          <button type="button" className="availability-nav-btn" onClick={() => void load(date)}>Retry</button>
        </>
      )}
      {status === "ready" && slots.length === 0 && (
        <p className="availability-empty">No availability on this date — try another day.</p>
      )}
      {status === "ready" && slots.length > 0 && (
        <div className="availability-slots" role="group" aria-label={`Available times for ${serviceName}`}>
          {slots.map((s) => {
            const key = keyOf(s);
            const isSelected = key === selectedKey;
            const cap = capacityLabel(s);
            return (
              <button
                key={key}
                type="button"
                className={["time-slot", isSelected ? "time-slot--selected" : "time-slot--available", s.isFull ? "time-slot--full" : ""].filter(Boolean).join(" ")}
                aria-pressed={isSelected}
                onClick={() => void handleSelect(s)}
              >
                <span className="time-slot-time">{timeLabel(s.localStartDate)}</span>
                {cap && <span className="time-slot-capacity">{cap}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
