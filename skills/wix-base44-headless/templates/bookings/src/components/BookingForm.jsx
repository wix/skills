// Contact form + participant selector (shown only when the policy allows > 1) + book button.
// Driven by useBookingFlow. Token-styled; re-skin via theme.css.
const field = {
  width: "100%", padding: "10px 12px", fontFamily: "var(--font-body)",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)", color: "var(--color-text)",
};
const label = { display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-muted)" };

export default function BookingForm({ contact, setContactField, participants, setParticipants, maxParticipants, canBook, submitting, error, onBook }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={label}>First name</label>
          <input style={field} value={contact.firstName} onChange={(e) => setContactField("firstName", e.target.value)} /></div>
        <div><label style={label}>Last name</label>
          <input style={field} value={contact.lastName} onChange={(e) => setContactField("lastName", e.target.value)} /></div>
      </div>
      <div><label style={label}>Email *</label>
        <input style={field} type="email" value={contact.email} onChange={(e) => setContactField("email", e.target.value)} /></div>
      <div><label style={label}>Phone</label>
        <input style={field} type="tel" value={contact.phone} onChange={(e) => setContactField("phone", e.target.value)} /></div>

      {maxParticipants > 1 && (
        <div><label style={label}>Participants</label>
          <select style={field} value={participants} onChange={(e) => setParticipants(Number(e.target.value))}>
            {Array.from({ length: maxParticipants }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p style={{ color: "var(--color-danger)", fontSize: 13, margin: 0 }}>{error}</p>}

      <button disabled={!canBook} onClick={onBook} style={{
        padding: "12px 24px", cursor: canBook ? "pointer" : "not-allowed",
        background: "var(--color-primary)", color: "var(--color-on-primary)",
        border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
        opacity: canBook ? 1 : 0.5,
      }}>{submitting ? "Booking…" : "Book & checkout"}</button>
    </div>
  );
}
