// REFERENCE booking surface: service info + day-grouped slot picker + staff filter +
// schema-driven form + book CTA, on the @theme tokens. Correct and complete; per the
// skill's model you design and build your own on useBookingFlow. Mount client:only —
// availability is timezone/session-specific.
import { useBookingFlow } from "../../hooks/bookings/useBookingFlow";
import type { ServiceDetail } from "../../wix/bookings/types";

const chip = (selected: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm transition-colors ${
    selected
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

export default function ServiceBookingView({ service }: { service: ServiceDetail }) {
  const {
    days,
    nextWeek,
    prevWeek,
    staffId,
    setStaffId,
    selectedSlot,
    setSelectedSlot,
    formFields,
    values,
    setValue,
    canBook,
    book,
    booking,
    confirmed,
    error,
  } = useBookingFlow(service);

  if (confirmed) {
    return (
      <div className="rounded-lg border border-border bg-secondary p-8 text-center">
        <p className="text-lg font-semibold">You're booked! 🎉</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {service.name}
          {selectedSlot ? ` — ${selectedSlot.dayKey} at ${selectedSlot.label}` : ""}. A confirmation
          email is on its way.
        </p>
      </div>
    );
  }

  return (
    <div>
      {service.staff.length > 1 && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Staff</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(staffId === undefined)} onClick={() => setStaffId(undefined)}>
              Anyone
            </button>
            {service.staff.map((m) => (
              <button key={m.id} type="button" className={chip(staffId === m.id)} onClick={() => setStaffId(m.id)}>
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pick a time</p>
        <div className="flex gap-2">
          <button type="button" onClick={prevWeek} aria-label="Previous week" className="rounded-full border border-border px-3 py-1 text-sm text-foreground transition-colors hover:bg-secondary">←</button>
          <button type="button" onClick={nextWeek} aria-label="Next week" className="rounded-full border border-border px-3 py-1 text-sm text-foreground transition-colors hover:bg-secondary">→</button>
        </div>
      </div>

      {days === null ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-secondary" />
          ))}
        </div>
      ) : days.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          No times in this week — try the next one.
        </p>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <div key={day.dayKey}>
              <p className="mb-2 text-sm font-medium">{day.dayLabel}</p>
              <div className="flex flex-wrap gap-2">
                {day.slots.map((s) => (
                  <button
                    key={s.startLocal + (s.eventId ?? "")}
                    type="button"
                    className={chip(selectedSlot?.startLocal === s.startLocal)}
                    onClick={() => setSelectedSlot(s)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 grid max-w-md gap-3">
        {formFields.map((f) => (
          <label key={f.target} className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{f.label}</span>
            {f.options?.length ? (
              <select
                value={values[f.target] ?? ""}
                onChange={(e) => setValue(f.target, e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary"
              >
                <option value="">Choose…</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "EMAIL" ? "email" : f.type === "PHONE" ? "tel" : f.type === "NUMBER" ? "number" : f.type === "URL" ? "url" : "text"}
                value={values[f.target] ?? ""}
                onChange={(e) => setValue(f.target, e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary"
              />
            )}
          </label>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={!canBook || booking}
        onClick={() => book().catch(() => {})}
        className="mt-5 rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {booking ? "Booking…" : service.free ? "Book — free" : `Book · ${service.price}`}
      </button>
    </div>
  );
}
