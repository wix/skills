// Bookable-slot picker — pure UI. Slots, paging cursor, and the pick handler come from
// useServiceDetail (all the slot data wiring lives in that hook). Each slot's key must combine the
// start time with its schedule/event id so appointment and class slots stay distinct. Styled with
// base44 design tokens (shadcn Tailwind classes) — e.g. group `slots` by day for a fuller calendar.
const chipCls =
  "px-3 py-2 cursor-pointer text-sm font-body border rounded-sm";
const chipIdle = "border-border bg-card text-foreground";
const chipActiveCls = "border-primary bg-primary text-primary-foreground";

export default function SlotPicker({ slots, cursor, onLoadMore, selectedSlot, onPick }) {
  if (!slots?.length) {
    return <p className="text-muted-foreground">No available times in this range — try later.</p>;
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {slots.map((slot) => {
          const active = selectedSlot?.localStartDate === slot.localStartDate;
          return (
            <button key={`${slot.localStartDate}-${slot.scheduleId || slot.eventInfo?.eventId}`}
              aria-pressed={active} onClick={() => onPick(slot)}
              className={`${chipCls} ${active ? chipActiveCls : chipIdle}`}>
              {new Date(slot.localStartDate).toLocaleString(undefined, {
                weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </button>
          );
        })}
      </div>
      {cursor && (
        <button onClick={onLoadMore}
          className="mt-4 px-4 py-2 cursor-pointer bg-card text-foreground border border-border rounded-sm">
          Load more times
        </button>
      )}
    </div>
  );
}
