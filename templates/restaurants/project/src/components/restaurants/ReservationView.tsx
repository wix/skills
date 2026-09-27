// REFERENCE reservations surface: party/date/time query → AVAILABLE slot pills → hold →
// details form → confirmed, on the @theme tokens. Correct and complete; per the skill's
// model you design and build your own on useReservation (which owns ALL booking logic).
import { useReservation } from "../../hooks/restaurants/useReservation";

const input =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

export default function ReservationView() {
  const r = useReservation();

  if (r.locations === null) {
    return <div className="h-64 animate-pulse rounded-lg bg-secondary" aria-busy="true" />;
  }
  if (r.locations.length === 0 || !r.location) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        Table reservations aren't set up yet — call us to book.
      </p>
    );
  }
  if (!r.location.onlineReservationsEnabled) {
    // Premium-gated toggle is off — slots/booking would fail; be honest, don't fake a form.
    return (
      <p className="py-16 text-center text-muted-foreground">
        Online reservations aren't open yet — call us to book a table.
      </p>
    );
  }

  if (r.confirmed) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border p-8 text-center">
        <p className="text-lg font-semibold">
          {r.confirmed.status === "RESERVED" ? "Table reserved" : "Request sent"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {r.confirmed.status === "RESERVED"
            ? "See you soon — a confirmation is on its way."
            : "The restaurant will confirm your reservation shortly."}
        </p>
        <button
          type="button"
          onClick={r.reset}
          className="mt-6 rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-secondary"
        >
          Make another reservation
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-muted-foreground">Guests</span>
          <input
            type="number"
            min={r.location.partySizeMin}
            max={r.location.partySizeMax}
            value={r.partySize}
            onChange={(e) => r.setPartySize(Number(e.target.value))}
            className={`mt-1 ${input}`}
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">Date</span>
          <input type="date" value={r.date} onChange={(e) => r.setDate(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">Around</span>
          <input type="time" value={r.time} onChange={(e) => r.setTime(e.target.value)} className={`mt-1 ${input}`} />
        </label>
      </div>
      <button
        type="button"
        disabled={r.loading}
        onClick={() => void r.findSlots()}
        className="mt-4 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {r.loading && r.slots === null ? "Finding times…" : "Find a table"}
      </button>

      {r.error && <p className="mt-4 text-sm text-red-600">{r.error}</p>}

      {r.slots !== null && r.slots.length === 0 && !r.error && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          No tables around that time — try another time or party size.
        </p>
      )}

      {r.slots !== null && r.slots.length > 0 && !r.held && (
        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Available times">
          {r.slots.map((slot) => (
            <button
              key={slot.startIso}
              type="button"
              disabled={r.loading}
              onClick={() => void r.holdSlot(slot)}
              className="rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-40"
            >
              {slot.label}
            </button>
          ))}
        </div>
      )}

      {r.held && (
        <div className="mt-6 rounded-lg border border-border p-5">
          <p className="text-sm font-medium">
            Holding {new Date(r.held.startIso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{" "}
            for {r.held.partySize} — complete within 10 minutes.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              placeholder="First name *"
              value={r.reservee.firstName}
              onChange={(e) => r.setReserveeField("firstName", e.target.value)}
              className={input}
            />
            <input
              placeholder="Last name"
              value={r.reservee.lastName ?? ""}
              onChange={(e) => r.setReserveeField("lastName", e.target.value)}
              className={input}
            />
            <input
              placeholder="Phone (+15551234567) *"
              type="tel"
              value={r.reservee.phone}
              onChange={(e) => r.setReserveeField("phone", e.target.value)}
              className={input}
            />
            <input
              placeholder="Email"
              type="email"
              value={r.reservee.email ?? ""}
              onChange={(e) => r.setReserveeField("email", e.target.value)}
              className={input}
            />
          </div>
          <button
            type="button"
            disabled={!r.canConfirm}
            onClick={() => void r.confirm()}
            className="mt-4 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {r.loading ? "Reserving…" : "Complete reservation"}
          </button>
        </div>
      )}
    </div>
  );
}
