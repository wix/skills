// REFERENCE reservations surface: party/date/time query → AVAILABLE slot pills → hold (or, under
// manual approval, a plain pick) → the details form built from the location's form configuration →
// confirmed / pending, on the @theme tokens. Correct and complete; per the skill's model you design
// and build your own on useReservation (which owns ALL booking logic).
import { useReservation } from "../../hooks/restaurants/useReservation";
import { zonedDateTimeLabel } from "../../wix/restaurants/time-core";

const input =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

function Policy({ label, policy }: { label: string; policy: { url: string; text: string } }) {
  return policy.url ? (
    <a href={policy.url} target="_blank" rel="noreferrer" className="underline">{label}</a>
  ) : (
    <details className="inline-block">
      <summary className="cursor-pointer underline">{label}</summary>
      <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{policy.text}</p>
    </details>
  );
}

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
    const { outcome } = r.confirmed;
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border p-8 text-center">
        <p className="text-lg font-semibold">
          {outcome === "confirmed" ? "Table reserved" : outcome === "pending" ? "Request sent" : "Reservation not completed"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {outcome === "confirmed"
            ? r.location.form.submitMessage || "See you soon — a confirmation is on its way."
            : outcome === "pending"
              ? "The restaurant will confirm your reservation shortly."
              : `Status: ${r.confirmed.status.toLowerCase().replace(/_/g, " ")} — please call us.`}
        </p>
        <button
          type="button"
          onClick={r.reset}
          className="mt-6 rounded-control border border-border px-5 py-2 text-sm font-medium hover:bg-secondary"
        >
          Make another reservation
        </button>
      </div>
    );
  }

  const form = r.location.form;
  const picked = r.selectedSlot;
  const holdMinutes = r.holdSecondsLeft !== null ? `${Math.floor(r.holdSecondsLeft / 60)}:${String(r.holdSecondsLeft % 60).padStart(2, "0")}` : "";

  return (
    <div className="mx-auto max-w-xl">
      {r.locations.length > 1 && (
        <label className="mb-4 block text-sm">
          <span className="text-muted-foreground">Location</span>
          <select value={r.location.id} onChange={(e) => r.setLocationId(e.target.value)} className={`mt-1 ${input}`}>
            {r.locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name || l.address || "Restaurant"}</option>
            ))}
          </select>
        </label>
      )}
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
      {r.approval === "MANUAL" && (
        <p className="mt-2 text-xs text-muted-foreground">Reservations for this party size are confirmed by the restaurant.</p>
      )}
      <button
        type="button"
        disabled={r.loading}
        onClick={() => void r.findSlots()}
        className="mt-4 w-full rounded-control bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {r.loading && r.slots === null ? "Finding times…" : "Find a table"}
      </button>

      {r.error && <p className="mt-4 text-sm text-destructive">{r.error}</p>}

      {r.slots !== null && r.slots.length === 0 && !r.error && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          No tables around that time — try another time or party size.
        </p>
      )}

      {r.slots !== null && r.slots.length > 0 && !picked && (
        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Available times">
          {r.slots.map((slot) => (
            <button
              key={slot.startIso}
              type="button"
              disabled={r.loading}
              onClick={() => void r.holdSlot(slot)}
              className="rounded-control border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-40"
            >
              {slot.label}
            </button>
          ))}
        </div>
      )}

      {picked && (
        <div className="mt-6 rounded-lg border border-border p-5">
          <p className="text-sm font-medium">
            {r.held ? "Holding" : "Requesting"} {zonedDateTimeLabel(new Date(picked.startIso), r.location.timeZone)} for {r.partySize}
            {r.location.name ? ` at ${r.location.name}` : ""}
            {r.held && holdMinutes ? ` — complete within ${holdMinutes}.` : r.held ? " — complete within 10 minutes." : "."}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              placeholder="First name *"
              value={r.reservee.firstName}
              onChange={(e) => r.setReserveeField("firstName", e.target.value)}
              className={input}
            />
            <input
              placeholder={form.lastNameRequired ? "Last name *" : "Last name"}
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
              placeholder={form.emailRequired ? "Email *" : "Email"}
              type="email"
              value={r.reservee.email ?? ""}
              onChange={(e) => r.setReserveeField("email", e.target.value)}
              className={input}
            />
            {form.customFields.map((f) => (
              <input
                key={f.id}
                placeholder={f.required ? `${f.name} *` : f.name}
                value={r.reservee.customFields?.[f.id] ?? ""}
                onChange={(e) => r.setCustomField(f.id, e.target.value)}
                className={`${input} sm:col-span-2`}
              />
            ))}
          </div>
          {form.marketingCheckbox && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.reservee.marketingConsent === true} onChange={(e) => r.setMarketingConsent(e.target.checked)} />
              Send me news and offers by email
            </label>
          )}
          {(form.terms || form.privacy) && (
            <p className="mt-3 text-xs text-muted-foreground">
              By reserving you agree to our{" "}
              {form.terms && <Policy label="terms and conditions" policy={form.terms} />}
              {form.terms && form.privacy && " and "}
              {form.privacy && <Policy label="privacy policy" policy={form.privacy} />}.
            </p>
          )}
          <button
            type="button"
            disabled={!r.canConfirm}
            onClick={() => void r.confirm()}
            className="mt-4 w-full rounded-control bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {r.loading ? "Sending…" : r.held ? "Complete reservation" : "Request reservation"}
          </button>
        </div>
      )}
    </div>
  );
}
