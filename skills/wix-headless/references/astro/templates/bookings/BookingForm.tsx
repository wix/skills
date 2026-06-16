import { useState } from "react";
import { book, navigateToCheckout, BookResultType } from "./bookingDriver";
import type { SelectedSlot } from "./bookingDriver";

// BookingForm.tsx — client:only="react" island. Renders the service's booking
// form SCHEMA (from @wix/forms, fetched server-side and passed in as `fields`),
// collects the values keyed by each field's `target`, and drives the booking
// sequence in bookingDriver.book(). This is the same schema-driven renderer the
// forms vertical uses (references/astro/forms/CONTACT_FORM.md) — generic inputs
// chosen by `componentType` — so it adapts to whatever fields the booking form
// defines, rather than hardcoding first/last/email/phone.
//
// On submit: book() returns CheckoutRequired (paid → hand off to the Wix-hosted
// checkout) or CheckoutSkipped (free / pay-in-person → straight to confirmation).

export interface BookingFormField {
  label: string;
  target: string; // the key createBooking expects in formSubmission
  required: boolean;
  componentType: string; // "TEXT_INPUT" | "DROPDOWN" | "PHONE_INPUT"
  identifier?: string;
  options?: { value: string; label: string }[];
}

interface Props {
  service: any; // SSR-fetched service — bookingDriver reads payment + bookingPolicy
  serviceName: string;
  slot: SelectedSlot;
  fields: BookingFormField[];
  onSuccess: (id: string, startDate?: string) => void;
  onCancel: () => void;
}

const friendlyError = (err: any): string => {
  // Surface field validation (e.g. a malformed phone number) rather than crashing.
  const violations = err?.details?.validationError?.fieldViolations ?? [];
  const first = violations[0]?.description ?? violations[0]?.data?.errors?.[0]?.errorMessage;
  if (first) return first;
  if (typeof err?.message === "string") return err.message;
  return "Something went wrong completing your booking. Please try again.";
};

export default function BookingForm({ service, serviceName, slot, fields, onSuccess, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);

  const set = (target: string, v: string) =>
    setValues((prev) => ({ ...prev, [target]: v }));

  const when = new Date(slot.localStartDate).toLocaleString([], {
    weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting"); setError(null);
    try {
      const result = await book({
        service,
        slot,
        formSubmission: values, // keyed by each field's `target`
        timezone: slot.timezone,
      });
      if (result.type === BookResultType.CheckoutRequired) {
        // Paid: hand the cart to the Wix-hosted checkout; it returns to /booking-confirmation.
        // Carry service + start time on the return URL so the confirmation can show them
        // (the in-memory selection is lost across the full-page redirect to Wix and back).
        await navigateToCheckout(
          result.cartId,
          `${window.location.origin}/booking-confirmation?service=${encodeURIComponent(serviceName)}&startDate=${encodeURIComponent(slot.localStartDate)}`,
        );
        return; // redirect in progress
      }
      onSuccess(result.orderId, slot.localStartDate); // free / pay-in-person
    } catch (err) {
      console.error("[booking] failed:", err);
      setError(friendlyError(err));
      setStatus("idle");
    }
  };

  return (
    <form className="booking-form" onSubmit={handleSubmit}>
      <div className="booking-form-summary">
        <strong>{serviceName}</strong>
        <span>{when}</span>
        <button type="button" className="booking-form-change" onClick={onCancel}>Choose another time</button>
      </div>

      {fields.map((field) => (
        <div key={field.target} className="booking-field">
          <label className="booking-label">
            {field.label}
            {field.required && <span className="booking-required" aria-hidden="true"> *</span>}
          </label>
          {field.componentType === "DROPDOWN" && field.options ? (
            <select
              className="booking-input"
              required={field.required}
              value={values[field.target] ?? ""}
              onChange={(e) => set(field.target, e.target.value)}
            >
              <option value="">Select an option</option>
              {field.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : field.identifier === "TEXT_AREA" || field.target?.includes("message") ? (
            <textarea
              className="booking-input"
              required={field.required}
              rows={4}
              value={values[field.target] ?? ""}
              onChange={(e) => set(field.target, e.target.value)}
            />
          ) : (
            <input
              className="booking-input"
              type={field.target === "email" ? "email" : field.componentType === "PHONE_INPUT" ? "tel" : "text"}
              required={field.required}
              value={values[field.target] ?? ""}
              onChange={(e) => set(field.target, e.target.value)}
            />
          )}
        </div>
      ))}

      {error && <p className="booking-error" role="alert">{error}</p>}

      <button type="submit" className="booking-cta" disabled={status === "submitting"}>
        {status === "submitting" ? "Booking…" : "Confirm booking"}
      </button>
    </form>
  );
}
