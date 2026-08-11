// Contact + participants form — pure UI. All state/handlers (field setters, participant cap,
// submit, submitting, error) come from useServiceDetail; this only renders them. The participant
// selector shows ONLY when maxParticipants > 1 (commonly 1 → no selector, book exactly one).
// Styled with base44 design tokens (shadcn Tailwind classes).
const fieldCls =
  "w-full px-3 py-2.5 box-border font-body border border-input rounded-sm bg-background text-foreground";
const labelCls = "block mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground";

export default function BookingForm({
  contact, setContactField, maxParticipants, participants, setParticipants,
  onSubmit, submitting, canSubmit, error, needsApproval, timeLabel, priceLabel,
}) {
  // Naming the time and price on the button is the last confirmation before payment, so what the
  // buyer clicks states exactly what they're committing to.
  const what = [timeLabel, priceLabel].filter(Boolean).join(" · ");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls} htmlFor="bk-first">First name</label>
          <input id="bk-first" className={fieldCls} value={contact.firstName} onChange={setContactField("firstName")} />
        </div>
        <div className="flex-1">
          <label className={labelCls} htmlFor="bk-last">Last name</label>
          <input id="bk-last" className={fieldCls} value={contact.lastName} onChange={setContactField("lastName")} />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="bk-email">Email</label>
        <input id="bk-email" required type="email" autoComplete="email" placeholder="you@example.com"
          className={fieldCls} value={contact.email} onChange={setContactField("email")} />
      </div>

      <div>
        <label className={labelCls} htmlFor="bk-phone">
          Phone <span className="normal-case tracking-normal">optional</span>
        </label>
        <input id="bk-phone" type="tel" autoComplete="tel" className={fieldCls}
          value={contact.phone} onChange={setContactField("phone")} />
      </div>

      {maxParticipants > 1 && (
        <div>
          <label className={labelCls} htmlFor="bk-participants">Participants</label>
          <input id="bk-participants" type="number" min={1} max={maxParticipants} value={participants}
            onChange={(e) => setParticipants(Math.max(1, Math.min(maxParticipants, Number(e.target.value) || 1)))}
            className={`${fieldCls} w-[100px]`} />
        </div>
      )}

      {error && <p role="alert" className="m-0 text-destructive text-sm">{error}</p>}

      {/* The business confirms a manual-approval service after the fact, so this asks rather than books. */}
      <button type="submit" disabled={!canSubmit}
        className="px-6 py-3 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
        {submitting
          ? (needsApproval ? "Requesting…" : "Booking…")
          : needsApproval
            ? (what ? `Request ${what}` : "Request appointment")
            : (what ? `Book ${what}` : "Book appointment")}
      </button>
    </form>
  );
}
