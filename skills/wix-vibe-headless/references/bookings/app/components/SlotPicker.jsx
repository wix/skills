// Bookable-slot picker — pure UI. Slots, paging cursor, and the pick handler come from
// useServiceDetail (all the slot data wiring lives in that hook). Each slot's key must combine the
// start time with its schedule/event id so appointment and class slots stay distinct. Token-styled;
// re-skin via theme.css (e.g. group `slots` by day for a fuller calendar).
const chipBase = {
  padding: "8px 12px", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-body)",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)", color: "var(--color-text)",
};
const chipActive = { background: "var(--color-primary)", color: "var(--color-on-primary)", borderColor: "var(--color-primary)" };

export default function SlotPicker({ slots, cursor, onLoadMore, selectedSlot, onPick }) {
  if (!slots?.length) {
    return <p style={{ color: "var(--color-muted)" }}>No available times in this range — try later.</p>;
  }
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {slots.map((slot) => {
          const active = selectedSlot?.localStartDate === slot.localStartDate;
          return (
            <button key={`${slot.localStartDate}-${slot.scheduleId || slot.eventInfo?.eventId}`}
              aria-pressed={active} onClick={() => onPick(slot)}
              style={{ ...chipBase, ...(active ? chipActive : null) }}>
              {new Date(slot.localStartDate).toLocaleString(undefined, {
                weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </button>
          );
        })}
      </div>
      {cursor && (
        <button onClick={onLoadMore} style={{
          marginTop: "var(--space)", padding: "8px 16px", cursor: "pointer",
          background: "var(--color-surface)", color: "var(--color-text)",
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
        }}>Load more times</button>
      )}
    </div>
  );
}
