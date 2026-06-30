import { useMemo, useState } from "react";
import { book, navigateToCheckout, BookResultType } from "./bookingDriver";
import type { SelectedSlot } from "./bookingDriver";
import { ADDRESS_COUNTRIES, addressSubFields } from "./addressData";
import { buildValidator, fieldErrors } from "./formValidation";
import { submissions } from "@wix/forms";
import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumber } from "libphonenumber-js/min";

// BookingForm.tsx — client:only="react" island. Renders the service's booking
// form SCHEMA (from @wix/forms, fetched server-side and passed in as `fields`),
// collects each value keyed by its `target` with the CORRECT JS type, and drives
// the booking sequence in bookingDriver.book(). Schema-driven — adapts to whatever
// fields the booking form defines. The submission value TYPE per field is what
// createBooking validates: string / number / boolean / string[] / nested address
// object — a wrong type rejects the whole booking, so each field type writes its
// own shape (see set helpers below).

export type FieldRenderType =
  | "text" | "textarea" | "email" | "tel"
  | "dropdown" | "radio" | "checkbox" | "checkbox_group"
  | "number" | "date" | "datetime" | "time"
  | "address" | "file" | "unsupported";

export interface BookingFormField {
  id: string;
  target: string;
  label: string;
  required: boolean;
  renderType: FieldRenderType;
  valueType: "string" | "number" | "boolean" | "array" | "address" | "file";
  options?: { value: string; label: string }[];
  addOther?: boolean;
  /** address only: which sub-fields exist + whether each is required */
  addressFields?: Record<string, { required?: boolean }>;
  validation?: {
    minLength?: number; maxLength?: number; pattern?: string;
    minimum?: number; maximum?: number; minItems?: number; maxItems?: number;
  };
}

interface Props {
  service: any;
  serviceName: string;
  slot: SelectedSlot;
  fields: BookingFormField[];
  onSuccess: (id: string, startDate?: string) => void;
  onCancel: () => void;
}

// Country display names from the browser-built-in Intl.DisplayNames (no dataset).
const REGION_NAMES =
  typeof Intl !== "undefined" && (Intl as any).DisplayNames
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;
const countryName = (c: string) => {
  try { return REGION_NAMES?.of(c) ?? c; } catch { return c; }
};

// Phone countries (ISO-2) sorted by display name, from libphonenumber-js.
const PHONE_COUNTRIES = getCountries().slice().sort((a, b) => countryName(a).localeCompare(countryName(b)));

// PhoneField — country-code dropdown + number input. Emits an E.164 string
// (e.g. "+14155551234") — the shape createBooking expects for a PHONE_INPUT.
function PhoneField({
  value, required, onChange,
}: { value?: string; required: boolean; onChange: (v: string | null) => void }) {
  const initial = (() => {
    try { return value ? parsePhoneNumber(value) : undefined; } catch { return undefined; }
  })();
  const [country, setCountry] = useState<string>(initial?.country ?? "US");
  const [input, setInput] = useState<string>(initial?.nationalNumber ? String(initial.nationalNumber) : "");

  const emit = (c: string, raw: string) => {
    if (!raw.trim()) { onChange(null); return; }
    try {
      const pn = parsePhoneNumber(raw, c as any);
      onChange(pn?.number ?? `+${getCountryCallingCode(c as any)}${raw.replace(/\D/g, "")}`);
    } catch {
      onChange(`+${getCountryCallingCode(c as any)}${raw.replace(/\D/g, "")}`);
    }
  };
  const display = input ? new AsYouType(country as any).input(input) : "";

  return (
    <div className="booking-phone">
      <select className="booking-input" aria-label="Country calling code" value={country}
        onChange={(e) => { setCountry(e.target.value); emit(e.target.value, input); }}>
        {PHONE_COUNTRIES.map((c) => (
          <option key={c} value={c}>{countryName(c)} +{getCountryCallingCode(c)}</option>
        ))}
      </select>
      <input className="booking-input" type="tel" required={required} value={display} placeholder="Phone number"
        onChange={(e) => { setInput(e.target.value); emit(country, e.target.value); }} />
    </div>
  );
}

// FileField — FILE_UPLOAD / SIGNATURE. Uploads each file via the documented pure-SDK
// round-trip (submissions.getMediaUploadUrl → PUT the bytes) and stores the resulting
// WixFile[] (the shape createBooking expects). `formId` = service.form._id.
function FileField({
  formId, value, required, multiple, onChange,
}: {
  formId: string; value?: any[]; required: boolean; multiple: boolean;
  onChange: (v: any[] | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const files = (value as any[] | undefined) ?? [];

  const upload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setBusy(true); setErr(null);
    try {
      const uploaded: any[] = [];
      for (const file of Array.from(fileList)) {
        const { uploadUrl } = await submissions.getMediaUploadUrl(formId, file.name, file.type || "application/octet-stream");
        if (!uploadUrl) throw new Error("No upload URL returned");
        const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
        const data = await res.json();
        const f = data.file ?? data;
        uploaded.push({
          fileId: f.fileId ?? f.id ?? f._id,
          displayName: f.displayName ?? file.name,
          fileType: file.type || "application/octet-stream",
          ...(f.url ? { url: f.url } : {}),
        });
      }
      onChange(multiple ? [...files, ...uploaded] : uploaded);
    } catch (e: any) {
      console.error("[booking] file upload failed:", e);
      setErr("Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input className="booking-input" type="file" multiple={multiple} required={required && files.length === 0}
        onChange={(e) => upload(e.target.files)} disabled={busy} />
      {busy && <p className="booking-note">Uploading…</p>}
      {files.length > 0 && (
        <ul className="booking-files">
          {files.map((f, i) => (
            <li key={i}>
              {f.displayName}
              <button type="button" className="booking-form-change"
                onClick={() => onChange(multiple ? files.filter((_, j) => j !== i) : null)}>remove</button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="booking-field-error">{err}</p>}
    </div>
  );
}

const friendlyError = (err: any): string => {
  const violations = err?.details?.validationError?.fieldViolations ?? [];
  const first = violations[0]?.description ?? violations[0]?.data?.errors?.[0]?.errorMessage;
  if (first) return first;
  if (typeof err?.message === "string") return err.message;
  return "Something went wrong completing your booking. Please try again.";
};

// Build the formSubmission map keyed by target. Omit empty values; keep 0/false.
// Addresses become a nested object of only the filled sub-fields.
function buildSubmission(values: Record<string, unknown>, fields: BookingFormField[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.target];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (f.valueType === "address") {
      const obj = v as Record<string, string>;
      const filled = Object.fromEntries(
        Object.entries(obj).filter(([, x]) => x != null && String(x).trim() !== ""),
      );
      if (Object.keys(filled).length === 0) continue;
      out[f.target] = filled;
    } else {
      out[f.target] = v;
    }
  }
  return out;
}

export default function BookingForm({ service, serviceName, slot, fields: allFields, onSuccess, onCancel }: Props) {
  // Address is only relevant for a CUSTOMER-location booking (the client's own
  // place) — same as the native Wix booking form. The server does NOT require the
  // form's address for BUSINESS / other locations even when the schema marks it
  // required, so hide it unless the selected slot is a CUSTOMER location.
  const fields = allFields.filter(
    (f) => f.renderType !== "address" || slot.locationType === "CUSTOMER",
  );
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Client validator compiled once from the schema (mirrors server rules; UX only).
  const validate = useMemo(() => buildValidator(fields as any), [fields]);
  // Validate one field on blur (against the cleaned submission); set/clear its error.
  const validateField = (target: string) => {
    const errs = fieldErrors(validate, fields as any, buildSubmission(values, fields));
    setErrors((prev) => {
      const next = { ...prev };
      if (errs[target]) next[target] = errs[target]; else delete next[target];
      return next;
    });
  };

  const set = (target: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [target]: v }));
    setErrors((prev) => { // clear the field's error as the visitor edits it
      if (!prev[target]) return prev;
      const next = { ...prev }; delete next[target]; return next;
    });
  };

  const setAddress = (target: string, key: string, v: string) =>
    setValues((prev) => ({
      ...prev,
      [target]: { ...(prev[target] as Record<string, string> | undefined), [key]: v },
    }));

  // checkbox-group toggle → string[]
  const toggleInArray = (target: string, value: string) =>
    setValues((prev) => {
      const cur = (prev[target] as string[] | undefined) ?? [];
      const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
      return { ...prev, [target]: next };
    });

  // A course is enrolled as a whole series — show its date range, not a single time.
  const isCourse = slot.serviceType === "COURSE";
  const fmtDay = (d: string) =>
    new Date(d).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  const when = isCourse
    ? `${fmtDay(slot.localStartDate)} – ${fmtDay(slot.localEndDate)}`
    : new Date(slot.localStartDate).toLocaleString([], {
        weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
      });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const formSubmission = buildSubmission(values, fields);
    const allErrors = fieldErrors(validate, fields as any, formSubmission);
    if (Object.keys(allErrors).length) { setErrors(allErrors); return; } // block; show field errors
    setStatus("submitting");
    try {
      const result = await book({ service, slot, formSubmission, timezone: slot.timezone });
      if (result.type === BookResultType.CheckoutRequired) {
        const thankYouPageUrl = `${window.location.origin}/booking-confirmation?service=${encodeURIComponent(serviceName)}&startDate=${encodeURIComponent(slot.localStartDate)}`;
        // Abandon / "continue browsing" → catalog, NOT the confirmation page.
        await navigateToCheckout(result.cartId, thankYouPageUrl, `${window.location.origin}/services`);
        return;
      }
      onSuccess(result.orderId, slot.localStartDate);
    } catch (err) {
      console.error("[booking] failed:", err);
      setError(friendlyError(err));
      setStatus("idle");
    }
  };

  const renderField = (field: BookingFormField) => {
    const { target, renderType, required, options } = field;
    const sv = values[target];

    switch (renderType) {
      case "dropdown":
        return (
          <select className="booking-input" required={required}
            value={(sv as string) ?? ""} onChange={(e) => set(target, e.target.value || null)}>
            <option value="">Select an option</option>
            {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      case "radio":
        return (
          <div className="booking-choice-group" role="radiogroup">
            {options?.map((o) => (
              <label key={o.value} className="booking-choice">
                <input type="radio" name={target} value={o.value} required={required}
                  checked={sv === o.value} onChange={() => set(target, o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        );
      case "checkbox_group": {
        const arr = (sv as string[] | undefined) ?? [];
        return (
          <div className="booking-choice-group">
            {options?.map((o) => (
              <label key={o.value} className="booking-choice">
                <input type="checkbox" value={o.value}
                  checked={arr.includes(o.value)} onChange={() => toggleInArray(target, o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        );
      }
      case "checkbox":
        return (
          <label className="booking-choice">
            <input type="checkbox" required={required}
              checked={sv === true} onChange={(e) => set(target, e.target.checked)} />
            <span>{field.label}</span>
          </label>
        );
      case "number":
        return (
          <input className="booking-input" type="number" required={required}
            min={field.validation?.minimum} max={field.validation?.maximum}
            value={sv === undefined || sv === null ? "" : String(sv)}
            onChange={(e) => set(target, e.target.value === "" ? null : Number(e.target.value))} />
        );
      case "date":
        return (
          <input className="booking-input" type="date" required={required}
            value={(sv as string) ?? ""} onChange={(e) => set(target, e.target.value || null)} />
        );
      case "datetime":
        return (
          <input className="booking-input" type="datetime-local" required={required}
            value={(sv as string) ?? ""}
            onChange={(e) => set(target, e.target.value ? `${e.target.value}:00` : null)} />
        );
      case "time":
        return (
          <input className="booking-input" type="time" required={required}
            value={((sv as string) ?? "").slice(0, 5)}
            onChange={(e) => set(target, e.target.value ? `${e.target.value}:00` : null)} />
        );
      case "textarea":
        return (
          <textarea className="booking-input" rows={4} required={required}
            value={(sv as string) ?? ""} onChange={(e) => set(target, e.target.value || null)} />
        );
      case "address": {
        // Faithful multi-line address: a COUNTRY dropdown drives which sub-fields show
        // and whether REGION is a dropdown — from the baked Wix per-country templates
        // (addressData.ts). Submission is a nested object of ISO codes (the shape the
        // validator requires: country ∈ enum, subdivision ∈ that country's codes).
        const obj = (sv as Record<string, string> | undefined) ?? {};
        const country = obj.country ?? "";
        const subs = country ? addressSubFields(country) : [];
        const span = (w: number) => ({ gridColumn: w >= 12 ? "1 / -1" : "auto" } as const);
        return (
          <div className="booking-address">
            <select className="booking-input" style={{ gridColumn: "1 / -1" }} required={required}
              value={country}
              onChange={(e) => set(target, e.target.value ? { country: e.target.value } : null)}>
              <option value="">Select country…</option>
              {ADDRESS_COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
            </select>
            {subs.map((sf) =>
              sf.options ? (
                <select key={sf.target} className="booking-input" style={span(sf.width)}
                  required={required && sf.required} value={obj[sf.target] ?? ""}
                  onChange={(e) => setAddress(target, sf.target, e.target.value)}>
                  <option value="">{sf.label}</option>
                  {sf.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input key={sf.target} className="booking-input" type="text" style={span(sf.width)}
                  placeholder={sf.label} aria-label={`${field.label} — ${sf.label}`}
                  required={required && sf.required} value={obj[sf.target] ?? ""}
                  onChange={(e) => setAddress(target, sf.target, e.target.value)} />
              ),
            )}
          </div>
        );
      }
      case "file": {
        const formId = service?.form?._id;
        if (!formId) return <p className="booking-note">File upload unavailable.</p>;
        return (
          <FileField formId={formId} value={sv as any[] | undefined} required={required}
            multiple={((field as any).fileLimit ?? 1) > 1} onChange={(v) => set(target, v)} />
        );
      }
      case "tel":
        return <PhoneField value={sv as string | undefined} required={required} onChange={(v) => set(target, v)} />;
      case "email":
      case "text":
      default:
        return (
          <input className="booking-input"
            type={renderType === "email" ? "email" : "text"}
            required={required}
            value={(sv as string) ?? ""} onChange={(e) => set(target, e.target.value || null)} />
        );
    }
  };

  return (
    <form className="booking-form" onSubmit={handleSubmit}>
      <div className="booking-form-summary">
        <strong>{serviceName}</strong>
        <span>{when}</span>
        {!isCourse && (
          <button type="button" className="booking-form-change" onClick={onCancel}>Choose another time</button>
        )}
      </div>

      {fields.map((field) => (
        // onBlur bubbles (focusout) → validate this field when focus leaves it.
        <div key={field.target} className="booking-field" onBlur={() => validateField(field.target)}>
          {/* checkbox renders its own inline label */}
          {field.renderType !== "checkbox" && (
            <label className="booking-label">
              {field.label}
              {field.required && <span className="booking-required" aria-hidden="true"> *</span>}
            </label>
          )}
          {renderField(field)}
          {errors[field.target] && (
            <p className="booking-field-error" role="alert">{errors[field.target]}</p>
          )}
        </div>
      ))}

      {error && <p className="booking-error" role="alert">{error}</p>}

      <button type="submit" className="booking-cta" disabled={status === "submitting"}>
        {status === "submitting"
          ? (isCourse ? "Enrolling…" : "Booking…")
          : (isCourse ? "Confirm enrollment" : "Confirm booking")}
      </button>
    </form>
  );
}
