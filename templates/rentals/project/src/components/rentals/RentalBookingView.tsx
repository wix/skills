// REFERENCE rental surface: the start picker (times grouped by day for an hourly rental, one chip
// per day for a daily one) with window paging and the time-zone line, the length picker for the
// chosen start, the server-priced quote, the schema-driven form, and the CTA labelled from
// ctaState — on the @theme tokens. Correct and complete; per the skill's model you design and build
// your own on useRentalFlow. Mount client:only — availability is time-zone/session-specific.
import { useRentalFlow } from "../../hooks/rentals/useRentalFlow";
import type { RentalDetail } from "../../wix/rentals/types";

const chip = (selected: boolean, disabled = false) =>
  `rounded-full border px-4 py-1.5 text-sm transition-colors ${
    disabled ? "cursor-not-allowed border-border text-muted-foreground line-through opacity-60" : selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-secondary"
  }`;

const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary";
const heading = "mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const pager = "rounded-full border border-border px-3 py-1 text-sm text-foreground transition-colors hover:bg-secondary";

export default function RentalBookingView({ rental }: { rental: RentalDetail }) {
  const { days, windowDays, nextWindow, prevWindow, timeZone, selectedStart, setSelectedStart, endOptions, selectedEnd, setSelectedEnd, quote, formFields, values, setValue, ctaState, canRent, rent, renting, confirmed, error } =
    useRentalFlow(rental);

  const daily = rental.unit === "DAY";
  const verb = ctaState === "requestToRent" ? "Request to rent" : "Rent";

  if (confirmed) {
    return (
      <div className="rounded-lg border border-border bg-secondary p-8 text-center">
        <p className="text-lg font-semibold">{ctaState === "requestToRent" ? "Request sent" : "You're all set!"}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {rental.name}
          {selectedStart && selectedEnd ? ` — ${selectedStart.label}, ${selectedEnd.label}` : ""}.{" "}
          {ctaState === "requestToRent" ? "You'll hear back once the request is approved." : "A confirmation email is on its way."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className={heading}>{daily ? "Pick a start day" : "Pick a start time"}</p>
        <div className="flex gap-2">
          <button type="button" onClick={prevWindow} aria-label={`Previous ${windowDays} days`} className={pager}>
            Prev
          </button>
          <button type="button" onClick={nextWindow} aria-label={`Next ${windowDays} days`} className={pager}>
            Next
          </button>
        </div>
      </div>
      {timeZone && !daily && <p className="mb-3 text-xs text-muted-foreground">Times in {timeZone.replace(/_/g, " ")}.</p>}

      {days === null ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-secondary" />
          ))}
        </div>
      ) : days.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Nothing available in these {windowDays} days. Try the next ones.</p>
      ) : daily ? (
        <div className="flex flex-wrap gap-2">
          {days.map((day) =>
            day.starts.map((s) => (
              <button key={s.key} type="button" disabled={!s.bookable} className={chip(selectedStart?.key === s.key, !s.bookable)} onClick={() => setSelectedStart(s)}>
                {day.dayLabel}
              </button>
            )),
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <div key={day.dayKey}>
              <p className="mb-2 text-sm font-medium">{day.dayLabel}</p>
              <div className="flex flex-wrap gap-2">
                {day.starts.map((s) => (
                  <button key={s.key} type="button" disabled={!s.bookable} title={s.location?.name || undefined} className={chip(selectedStart?.key === s.key, !s.bookable)} onClick={() => setSelectedStart(s)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedStart && (
        <div className="mt-6">
          <p className={heading}>How long</p>
          {endOptions === null ? (
            <div className="h-10 animate-pulse rounded-md bg-secondary" aria-busy="true" />
          ) : endOptions.length === 0 ? (
            <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">This start can't be rented for the minimum length. Pick another start.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {endOptions.map((o) => (
                <button key={o.endLocal} type="button" className={chip(selectedEnd?.endLocal === o.endLocal)} onClick={() => setSelectedEnd(o)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {selectedEnd && (
            <p className="mt-3 text-sm text-muted-foreground">
              {quote === null ? "Calculating the price…" : quote.total ? <>Total <span className="font-medium text-foreground">{quote.total}</span></> : rental.free ? "Free" : ""}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid max-w-md gap-3">
        {formFields.map((f) => (
          <label key={f.target} className="block">
            <span className={heading}>
              {f.label}
              {f.required ? " *" : ""}
            </span>
            {f.options?.length ? (
              <select value={values[f.target] ?? ""} onChange={(e) => setValue(f.target, e.target.value)} className={input}>
                <option value="">Choose…</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "EMAIL" ? "email" : f.type === "PHONE" ? "tel" : f.type === "NUMBER" ? "number" : f.type === "URL" ? "url" : "text"}
                value={values[f.target] ?? ""}
                required={f.required}
                onChange={(e) => setValue(f.target, e.target.value)}
                className={input}
              />
            )}
          </label>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button type="button" disabled={!canRent || renting} onClick={() => rent().catch(() => {})} className="mt-5 rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
        {renting ? "Reserving…" : rental.free ? `${verb} — free` : quote?.total ? `${verb} · ${quote.total}` : rental.rateLabel ? `${verb} · ${rental.rateLabel}` : verb}
      </button>
    </div>
  );
}
