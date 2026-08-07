// Reservations page — thin view over useReservation (all flow logic lives in the hook). Location
// picker → date + party size → AVAILABLE slots → hold → details → confirm. Reads the confirmed
// reservation's top-level status: RESERVED is confirmed, REQUESTED means the location needs manual
// approval (pending). Token-styled; re-skin via theme.css.
import { useReservation } from "@/hooks/useReservation";

const field = {
  width: "100%", padding: "10px 12px", boxSizing: "border-box",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)",
};
const primaryBtn = {
  padding: "12px 24px", cursor: "pointer", border: "none", borderRadius: "var(--radius-sm)",
  background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 15, fontWeight: 600,
};

function slotLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function locationLabel(loc) {
  return loc.location?.name || loc.location?.address?.formatted || "Main location";
}

export default function Reservations() {
  const r = useReservation();

  if (r.locations === null) return <Centered>Loading…</Centered>;
  if (r.locations.length === 0) return <Centered>Reservations aren't set up yet — enable Table Reservations in your Wix dashboard.</Centered>;

  if (r.confirmed) {
    const d = r.confirmed.details || {};
    const pending = r.confirmed.status === "REQUESTED";
    return (
      <main style={wrap}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>{pending ? "Reservation requested" : "You're booked!"}</h1>
        <p style={{ color: "var(--color-muted)" }}>
          {pending
            ? "The restaurant will confirm your request shortly."
            : "Your table is confirmed. See you soon!"}
        </p>
        <p>{d.partySize} guests · {d.startDate && new Date(d.startDate).toLocaleString()}</p>
        <button style={primaryBtn} onClick={r.reset}>Make another reservation</button>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Reserve a table</h1>

      <div style={{ display: "grid", gap: "var(--space)", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {r.locations.length > 1 && (
          <label>Location
            <select value={r.locationId ?? ""} onChange={(e) => r.setLocationId(e.target.value)} style={field}>
              {r.locations.map((loc) => <option key={loc.id} value={loc.id}>{locationLabel(loc)}</option>)}
            </select>
          </label>
        )}
        <label>Date
          <input type="date" value={r.date} onChange={(e) => r.setDate(e.target.value)} style={field} />
        </label>
        <label>Guests
          <input type="number" min={1} value={r.partySize}
            onChange={(e) => r.setPartySize(Math.max(1, Number(e.target.value) || 1))} style={field} />
        </label>
      </div>

      <div style={{ marginTop: "var(--space)" }}>
        <button style={primaryBtn} disabled={r.loading} onClick={r.findSlots}>Find a table</button>
      </div>

      {r.error && <p style={{ color: "var(--color-danger)" }}>{r.error}</p>}

      {r.slots && !r.held && (
        r.slots.length === 0
          ? <p style={{ color: "var(--color-muted)", marginTop: "var(--space)" }}>No tables available then — try another date or party size.</p>
          : <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "var(--space)" }}>
              {r.slots.map((slot) => (
                <button key={slot.startDate} onClick={() => r.holdSlot(slot)} disabled={r.loading} style={{
                  padding: "10px 16px", cursor: "pointer",
                  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
                  background: "var(--color-surface)", color: "var(--color-text)", fontWeight: 600,
                }}>{slotLabel(slot.startDate)}</button>
              ))}
            </div>
      )}

      {r.held && (
        <form onSubmit={(e) => { e.preventDefault(); r.confirm(); }}
          style={{ marginTop: "calc(var(--space) * 1.5)", display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
          <p style={{ margin: 0, color: "var(--color-muted)" }}>
            Holding your table for 10 minutes — enter your details to confirm.
          </p>
          <input required placeholder="First name *" value={r.reservee.firstName}
            onChange={(e) => r.setReservee({ ...r.reservee, firstName: e.target.value })} style={field} />
          <input placeholder="Last name" value={r.reservee.lastName}
            onChange={(e) => r.setReservee({ ...r.reservee, lastName: e.target.value })} style={field} />
          <input required placeholder="Phone (e.g. +15551234567) *" value={r.reservee.phone}
            onChange={(e) => r.setReservee({ ...r.reservee, phone: e.target.value })} style={field} />
          <input type="email" placeholder="Email" value={r.reservee.email}
            onChange={(e) => r.setReservee({ ...r.reservee, email: e.target.value })} style={field} />
          <button type="submit" style={primaryBtn} disabled={r.loading}>Confirm reservation</button>
        </form>
      )}
    </main>
  );
}

const wrap = { maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" };
function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
