// Contact + participants form — pure UI. All state/handlers (field setters, participant cap,
// submit, submitting, error) come from useServiceDetail; this only renders them. The participant
// selector shows ONLY when maxParticipants > 1 (commonly 1 → no selector, book exactly one).
// Token-styled; re-skin via theme.css.
const field = {
  width: "100%", padding: "10px 12px", boxSizing: "border-box", fontFamily: "var(--font-body)",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)", color: "var(--color-text)",
};

export default function BookingForm({
  contact, setContactField, maxParticipants, participants, setParticipants,
  onSubmit, submitting, canSubmit, error,
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space)" }}>
      <input required type="email" placeholder="Email" value={contact.email} onChange={setContactField("email")} style={field} />
      <div style={{ display: "flex", gap: "var(--space)" }}>
        <input placeholder="First name" value={contact.firstName} onChange={setContactField("firstName")} style={field} />
        <input placeholder="Last name" value={contact.lastName} onChange={setContactField("lastName")} style={field} />
      </div>
      <input placeholder="Phone" value={contact.phone} onChange={setContactField("phone")} style={field} />

      {maxParticipants > 1 && (
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--color-muted)" }}>
          Participants
          <input type="number" min={1} max={maxParticipants} value={participants}
            onChange={(e) => setParticipants(Math.max(1, Math.min(maxParticipants, Number(e.target.value) || 1)))}
            style={{ ...field, width: 100 }} />
        </label>
      )}

      {error && <p style={{ margin: 0, color: "var(--color-danger)", fontSize: 14 }}>{error}</p>}

      <button type="submit" disabled={!canSubmit} style={{
        padding: "12px 24px", cursor: canSubmit ? "pointer" : "not-allowed",
        background: "var(--color-primary)", color: "var(--color-on-primary)",
        border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
        opacity: canSubmit ? 1 : 0.5,
      }}>{submitting ? "Booking…" : "Book"}</button>
    </form>
  );
}
