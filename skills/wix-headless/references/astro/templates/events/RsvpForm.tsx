import { useState } from "react";
import { rsvp } from "./eventsDriver";

// RsvpForm.tsx — client:only="react" island for an RSVP (free) event.
// The RSVP registration form is BUILT-IN (first name, last name, email — these
// can't be removed and are all that's required), so this is a fixed 3-field form,
// NOT a schema-driven one. On submit it calls eventsDriver.rsvp() and shows an
// inline confirmation — no redirect, no payment.
//
// Adapt copy/layout/classes to the brand; keep the field set + the SDK call.

interface Props {
  eventId: string;
  allowDecline?: boolean; // true for YES_AND_NO events (adds a "Can't make it" path)
}

export default function RsvpForm({ eventId, allowDecline = false }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (rsvpStatus: "YES" | "NO") => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    setStatus("submitting");
    setError(null);
    try {
      await rsvp({ eventId, firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), status: rsvpStatus });
      setStatus("done");
    } catch (err) {
      console.error("[events] rsvp failed:", err);
      setError("We couldn't record your RSVP. Please check your details and try again.");
      setStatus("idle");
    }
  };

  if (status === "done") {
    return (
      <div className="rsvp-done">
        <div className="rsvp-check" aria-hidden="true">✓</div>
        <h3>You're on the list!</h3>
        <p>We've sent a confirmation to {email}. See you there.</p>
      </div>
    );
  }

  return (
    <form className="rsvp-form" onSubmit={(e) => { e.preventDefault(); submit("YES"); }}>
      <div className="rsvp-field-row">
        <label className="rsvp-field">
          <span>First name</span>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" required />
        </label>
        <label className="rsvp-field">
          <span>Last name</span>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" required />
        </label>
      </div>
      <label className="rsvp-field">
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>

      {error && <p className="rsvp-error" role="alert">{error}</p>}

      <button type="submit" className="rsvp-cta" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending…" : "RSVP — I'll be there"}
      </button>
      {allowDecline && (
        <button
          type="button"
          className="rsvp-decline"
          disabled={status === "submitting"}
          onClick={() => submit("NO")}
        >
          Can't make it
        </button>
      )}
    </form>
  );
}
