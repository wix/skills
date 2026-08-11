// Bookable-slot picker — pure UI. Slots, paging cursor, and the pick handler come from
// useServiceDetail (all the slot data wiring lives in that hook).
//
// One day at a time: a horizontal strip of the days that HAVE availability, then that day's times
// bucketed into morning / afternoon / evening. A fortnight of a busy calendar is well over a hundred
// slots, so listing every day at once buries the booking form and reads as a wall of numbers.
// Each button's key combines the start time with its schedule/event id so appointment and class slots
// stay distinct. Styled with base44 design tokens (shadcn Tailwind classes).
import { useEffect, useState } from "react";

const dayCls = "shrink-0 w-[68px] py-2 px-1 cursor-pointer text-center border rounded-sm transition-colors";
const dayIdle = "border-border bg-card text-foreground hover:border-foreground/40";
const dayActive = "border-primary bg-primary text-primary-foreground";
const timeCls = "py-2.5 px-2 cursor-pointer text-sm font-body border rounded-sm transition-colors";
const timeIdle = "border-border bg-card text-foreground hover:border-foreground/40";
const timeActive = "border-primary bg-primary text-primary-foreground";

// localStartDate is "YYYY-MM-DDThh:mm:ss" (no zone), so the first 10 chars are the day key and
// chars 11–13 are the local hour — no Date parsing needed to bucket by time of day.
const dayKey = (slot) => slot.localStartDate.slice(0, 10);
const hourOf = (slot) => Number(slot.localStartDate.slice(11, 13));

const BUCKETS = [
  { label: "Morning", test: (h) => h < 12 },
  { label: "Afternoon", test: (h) => h >= 12 && h < 17 },
  { label: "Evening", test: (h) => h >= 17 },
];

function groupByDay(slots) {
  const days = new Map();
  for (const slot of slots) {
    const key = dayKey(slot);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(slot);
  }
  return [...days.entries()].map(([key, daySlots]) => ({ key, slots: daySlots }));
}

const fmtDay = (key, opts) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, opts);
const fmtTime = (slot) =>
  new Date(slot.localStartDate).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export default function SlotPicker({ slots, cursor, onLoadMore, selectedSlot, onPick }) {
  const days = groupByDay(slots || []);
  const [activeDay, setActiveDay] = useState(null);

  // Follow the data: land on the first day with availability, and don't strand the view on a day that
  // disappeared when a later page loaded.
  useEffect(() => {
    if (days.length && !days.some((d) => d.key === activeDay)) setActiveDay(days[0].key);
  }, [days, activeDay]);

  if (!slots?.length) {
    return <p className="text-muted-foreground">No available times in this range — try later.</p>;
  }

  const current = days.find((d) => d.key === activeDay) ?? days[0];
  const buckets = BUCKETS
    .map((b) => ({ label: b.label, slots: current.slots.filter((s) => b.test(hourOf(s))) }))
    .filter((b) => b.slots.length);

  const pickDay = (key) => {
    setActiveDay(key);
    // Drop a time chosen on another day — otherwise the CTA names a time that isn't on screen.
    if (selectedSlot && dayKey(selectedSlot) !== key) onPick(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Choose a day">
        {days.map((d) => {
          const active = d.key === current.key;
          return (
            <button key={d.key} type="button" aria-pressed={active} onClick={() => pickDay(d.key)}
              className={`${dayCls} ${active ? dayActive : dayIdle}`}>
              <span className="block text-[10px] uppercase tracking-wide opacity-70">
                {fmtDay(d.key, { weekday: "short" })}
              </span>
              <span className="block text-lg font-semibold leading-tight">
                {fmtDay(d.key, { day: "numeric" })}
              </span>
            </button>
          );
        })}
        {/* Later dates are another page, not more of this one — fetch on demand from the strip's end. */}
        {cursor && (
          <button type="button" onClick={onLoadMore}
            className={`${dayCls} ${dayIdle} text-[11px] leading-tight`}>
            More<br />dates →
          </button>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="m-0 font-display text-base">
            {fmtDay(current.key, { weekday: "long", day: "numeric", month: "short" })}
          </h3>
          <span className="text-[13px] text-muted-foreground">
            {current.slots.length} {current.slots.length === 1 ? "time" : "times"} free
          </span>
        </div>

        <div className="flex flex-col gap-4">
          {buckets.map((b) => (
            <div key={b.label}>
              <p className="m-0 mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{b.label}</p>
              <div className="grid grid-cols-3 gap-2">
                {b.slots.map((slot) => {
                  const active = selectedSlot?.localStartDate === slot.localStartDate;
                  return (
                    <button key={`${slot.localStartDate}-${slot.scheduleId || slot.eventInfo?.eventId}`}
                      type="button" aria-pressed={active} onClick={() => onPick(slot)}
                      className={`${timeCls} ${active ? timeActive : timeIdle}`}>
                      {fmtTime(slot)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
