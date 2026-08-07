// Slot picker: groups bookable slots by day, one selectable chip per slot. Driven by
// useBookingFlow (pass slots + selectedSlot + onSelect). Token-styled; re-skin via theme.css.
import { useMemo } from "react";
import { parseLocalSlot } from "@/lib/format";

export default function SlotPicker({ slots, selectedSlot, onSelect }) {
  const byDay = useMemo(() => {
    const groups = new Map();
    for (const slot of slots || []) {
      const { dayKey, dayLabel, timeLabel } = parseLocalSlot(slot.localStartDate);
      if (!groups.has(dayKey)) groups.set(dayKey, { dayLabel, slots: [] });
      groups.get(dayKey).slots.push({ slot, timeLabel });
    }
    return [...groups.values()];
  }, [slots]);

  if (slots === null) return <p style={{ color: "var(--color-muted)" }}>Loading availability…</p>;
  if (!slots.length) return <p style={{ color: "var(--color-muted)" }}>No open times in the next couple of weeks.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space)" }}>
      {byDay.map(({ dayLabel, slots: daySlots }) => (
        <div key={dayLabel}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted)", marginBottom: 8 }}>{dayLabel}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {daySlots.map(({ slot, timeLabel }) => {
              const active = selectedSlot?.localStartDate === slot.localStartDate;
              return (
                <button key={slot.localStartDate} onClick={() => onSelect(slot)} aria-pressed={active}
                  style={{
                    padding: "8px 14px", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-body)",
                    border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
                    background: active ? "var(--color-primary)" : "var(--color-surface)",
                    color: active ? "var(--color-on-primary)" : "var(--color-text)",
                    borderColor: active ? "var(--color-primary)" : "var(--color-border)",
                  }}>{timeLabel}</button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
