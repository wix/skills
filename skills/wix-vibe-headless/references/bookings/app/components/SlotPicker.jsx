// Bookable-slot picker — pure UI. Slots, paging cursor, and the pick handler come from
// useServiceDetail (all the slot data wiring lives in that hook). Slots are grouped by day — the
// date shown once as a heading, then time-only chips — so a long availability list reads like a
// calendar instead of a flat wall of repeated "Mon, Aug 10, 1:30 PM". Each chip's key combines the
// start time with its schedule/event id so appointment and class slots stay distinct. Styled with
// base44 design tokens (shadcn Tailwind classes).
const chipCls = "px-3 py-2 cursor-pointer text-sm font-body border rounded-sm";
const chipIdle = "border-border bg-card text-foreground";
const chipActiveCls = "border-primary bg-primary text-primary-foreground";

// Group slots by their local day, preserving order. localStartDate is "YYYY-MM-DDThh:mm:ss" (no zone),
// so the first 10 chars are the day key.
function groupByDay(slots) {
  const days = new Map();
  for (const slot of slots) {
    const key = slot.localStartDate.slice(0, 10);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(slot);
  }
  return [...days.values()];
}

export default function SlotPicker({ slots, cursor, onLoadMore, selectedSlot, onPick }) {
  if (!slots?.length) {
    return <p className="text-muted-foreground">No available times in this range — try later.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {groupByDay(slots).map((daySlots) => (
        <div key={daySlots[0].localStartDate.slice(0, 10)}>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">
            {new Date(daySlots[0].localStartDate).toLocaleDateString(undefined, {
              weekday: "short", month: "short", day: "numeric",
            })}
          </h3>
          <div className="flex flex-wrap gap-2">
            {daySlots.map((slot) => {
              const active = selectedSlot?.localStartDate === slot.localStartDate;
              return (
                <button key={`${slot.localStartDate}-${slot.scheduleId || slot.eventInfo?.eventId}`}
                  aria-pressed={active} onClick={() => onPick(slot)}
                  className={`${chipCls} ${active ? chipActiveCls : chipIdle}`}>
                  {new Date(slot.localStartDate).toLocaleTimeString(undefined, {
                    hour: "numeric", minute: "2-digit",
                  })}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {cursor && (
        <button onClick={onLoadMore}
          className="px-4 py-2 cursor-pointer bg-card text-foreground border border-border rounded-sm">
          Load more times
        </button>
      )}
    </div>
  );
}
