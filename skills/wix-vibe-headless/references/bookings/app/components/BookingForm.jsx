// Contact + participants form — pure UI. All state/handlers (field setters, participant cap,
// submit, submitting, error) come from useServiceDetail; this only renders them. The participant
// selector shows ONLY when maxParticipants > 1 (commonly 1 → no selector, book exactly one).
// Styled with base44 design tokens (shadcn Tailwind classes).
const fieldCls =
  "px-3 py-2.5 box-border font-body border border-border rounded-sm bg-background text-foreground";

export default function BookingForm({
  contact, setContactField, maxParticipants, participants, setParticipants,
  onSubmit, submitting, canSubmit, error,
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex flex-col gap-4">
      <input required type="email" placeholder="Email" value={contact.email} onChange={setContactField("email")} className={`${fieldCls} w-full`} />
      <div className="flex gap-4">
        <input placeholder="First name" value={contact.firstName} onChange={setContactField("firstName")} className={`${fieldCls} w-full`} />
        <input placeholder="Last name" value={contact.lastName} onChange={setContactField("lastName")} className={`${fieldCls} w-full`} />
      </div>
      <input placeholder="Phone" value={contact.phone} onChange={setContactField("phone")} className={`${fieldCls} w-full`} />

      {maxParticipants > 1 && (
        <label className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
          Participants
          <input type="number" min={1} max={maxParticipants} value={participants}
            onChange={(e) => setParticipants(Math.max(1, Math.min(maxParticipants, Number(e.target.value) || 1)))}
            className={`${fieldCls} w-[100px]`} />
        </label>
      )}

      {error && <p className="m-0 text-destructive text-sm">{error}</p>}

      <button type="submit" disabled={!canSubmit}
        className="px-6 py-3 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
        {submitting ? "Booking…" : "Book"}
      </button>
    </form>
  );
}
