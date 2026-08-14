// useRsvpForm — RSVP submission logic for an RSVP-type event, no markup.
//   • createRsvp(eventId, { firstName, lastName, email, status, additionalGuestNames? }) completes
//     fully client-side (no redirect) and throws on closed/full registration, guest-limit, duplicate
//     email, or invalid form — surface the message, don't swallow it.
//   • Only offer status "NO" when registration.rsvp.responseType === "YES_AND_NO".
//   • A full-with-waitlist event returns the RSVP with status "WAITLIST" — tell the guest.
import { useState } from "react";
import { createRsvp } from "@/rest/wix-events-registration";

export function useRsvpForm(eventId) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", status: "YES" });
  const [guests, setGuests] = useState([]); // additional guest names (strings)
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // the created RSVP (carries .status) on success
  const [error, setError] = useState(null);

  const setField = (name, value) => setForm((f) => ({ ...f, [name]: value }));

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const rsvp = await createRsvp(eventId, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        status: form.status,
        additionalGuestNames: guests.filter(Boolean),
      });
      setResult(rsvp); // rsvp.status is "YES" | "NO" | "WAITLIST"
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !!(form.firstName && form.lastName && form.email) && !submitting;
  return { form, setField, guests, setGuests, submit, submitting, canSubmit, result, error };
}
