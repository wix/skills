// RSVP form for an RSVP-type event. Pure UI over useRsvpForm — no data logic here. Styled with
// base44 design tokens (shadcn Tailwind classes). Offers a "NO" reply only when responseType is
// "YES_AND_NO"; a WAITLIST result (event full) is surfaced distinctly from a confirmed YES.
import { useRsvpForm } from "@/hooks/useRsvpForm";

const input = "w-full px-3 py-2.5 box-border font-body border border-border rounded-sm bg-background text-foreground";
const label = "block mb-1.5 text-[13px] font-semibold text-muted-foreground";
const field = "mb-4";

export default function RsvpForm({ eventId, responseType }) {
  const { form, setField, submit, submitting, canSubmit, result, error } = useRsvpForm(eventId);

  if (result) {
    const waitlisted = result.status === "WAITLIST";
    return (
      <div className="p-4 rounded-lg bg-card border border-border text-foreground">
        {waitlisted
          ? "This event is full — you've been added to the waitlist. We'll email you if a spot opens."
          : "You're on the list! A confirmation is on its way to your email."}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="max-w-[440px]">
      <div className={field}>
        <label className={label}>First name</label>
        <input className={input} value={form.firstName} onChange={(e) => setField("firstName", e.target.value)} required />
      </div>
      <div className={field}>
        <label className={label}>Last name</label>
        <input className={input} value={form.lastName} onChange={(e) => setField("lastName", e.target.value)} required />
      </div>
      <div className={field}>
        <label className={label}>Email</label>
        <input className={input} type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} required />
      </div>

      {responseType === "YES_AND_NO" && (
        <div className={field}>
          <label className={label}>Will you attend?</label>
          <select className={input} value={form.status} onChange={(e) => setField("status", e.target.value)}>
            <option value="YES">Yes, I'll be there</option>
            <option value="NO">No, I can't make it</option>
          </select>
        </div>
      )}

      {error && <p className="text-destructive mb-4">{error}</p>}

      <button type="submit" disabled={!canSubmit}
        className="py-3 px-6 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
        {submitting ? "Sending…" : "RSVP"}
      </button>
    </form>
  );
}
