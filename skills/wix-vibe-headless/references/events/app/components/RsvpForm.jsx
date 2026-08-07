// RSVP form for an RSVP-type event. Pure UI over useRsvpForm — no data logic here. Token-styled;
// re-skin via theme.css. Offers a "NO" reply only when responseType is "YES_AND_NO"; a WAITLIST
// result (event full) is surfaced distinctly from a confirmed YES.
import { useRsvpForm } from "@/hooks/useRsvpForm";

const input = {
  width: "100%", padding: "10px 12px", boxSizing: "border-box", fontFamily: "var(--font-body)",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)", color: "var(--color-text)",
};
const label = { display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-muted)" };
const field = { marginBottom: "var(--space)" };

export default function RsvpForm({ eventId, responseType }) {
  const { form, setField, submit, submitting, canSubmit, result, error } = useRsvpForm(eventId);

  if (result) {
    const waitlisted = result.status === "WAITLIST";
    return (
      <div style={{
        padding: "var(--space)", borderRadius: "var(--radius)",
        background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text)",
      }}>
        {waitlisted
          ? "This event is full — you've been added to the waitlist. We'll email you if a spot opens."
          : "You're on the list! A confirmation is on its way to your email."}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 440 }}>
      <div style={field}>
        <label style={label}>First name</label>
        <input style={input} value={form.firstName} onChange={(e) => setField("firstName", e.target.value)} required />
      </div>
      <div style={field}>
        <label style={label}>Last name</label>
        <input style={input} value={form.lastName} onChange={(e) => setField("lastName", e.target.value)} required />
      </div>
      <div style={field}>
        <label style={label}>Email</label>
        <input style={input} type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} required />
      </div>

      {responseType === "YES_AND_NO" && (
        <div style={field}>
          <label style={label}>Will you attend?</label>
          <select style={input} value={form.status} onChange={(e) => setField("status", e.target.value)}>
            <option value="YES">Yes, I'll be there</option>
            <option value="NO">No, I can't make it</option>
          </select>
        </div>
      )}

      {error && <p style={{ color: "var(--color-danger)", marginBottom: "var(--space)" }}>{error}</p>}

      <button type="submit" disabled={!canSubmit} style={{
        padding: "12px 24px", cursor: canSubmit ? "pointer" : "not-allowed",
        background: "var(--color-primary)", color: "var(--color-on-primary)",
        border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
        opacity: canSubmit ? 1 : 0.5,
      }}>{submitting ? "Sending…" : "RSVP"}</button>
    </form>
  );
}
