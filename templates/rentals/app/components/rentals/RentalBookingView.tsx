// REFERENCE rental surface: the start picker ONE DAY AT A TIME (a strip of the days that have
// availability, then that day's times bucketed into morning / afternoon / evening; a daily rental
// shows the strip alone, since a day IS the start), window paging at the ends of the strip, the
// time-zone line, the length picker for the chosen start, the server-priced quote, the schema-driven
// form, and the CTA labelled from ctaState — on the @theme tokens. A rental's resources are usually
// bookable around the clock, so a week of starts is over three hundred chips; listing them all
// buries the form and reads as a wall of numbers. Correct and complete; per the skill's model you
// design and build your own on useRentalFlow. Mount client:only — availability is time-zone-specific.
import { useEffect, useState } from "react";
import { useRentalFlow } from "../../hooks/rentals/useRentalFlow";
import type { RentalDetail, StartOption } from "../../wix/rentals/types";

const chip = (selected: boolean, disabled = false) =>
  `rounded-control border px-4 py-1.5 text-sm transition-colors ${
    disabled ? "cursor-not-allowed border-border text-muted-foreground line-through opacity-60" : selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-secondary"
  }`;
const dayTile = (selected: boolean, disabled = false) =>
  `w-[68px] shrink-0 rounded-md border px-1 py-2 text-center transition-colors ${
    disabled ? "cursor-not-allowed border-border text-muted-foreground opacity-60" : selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-secondary"
  }`;
const pager = "w-[68px] shrink-0 rounded-md border border-border px-1 py-2 text-center text-xs leading-tight text-foreground transition-colors hover:bg-secondary";

const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary";
const heading = "mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground";

// startLocal is "YYYY-MM-DDThh:mm:ss" (no zone): chars 11–13 are the local hour, no Date parsing needed.
const hourOf = (s: StartOption): number => Number(s.startLocal.slice(11, 13));
const BUCKETS: { label: string; test: (h: number) => boolean }[] = [
  { label: "Morning", test: (h) => h < 12 },
  { label: "Afternoon", test: (h) => h >= 12 && h < 17 },
  { label: "Evening", test: (h) => h >= 17 },
];
const fmtDay = (dayKey: string, opts: Intl.DateTimeFormatOptions): string => {
  try {
    return new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined, opts);
  } catch {
    return dayKey;
  }
};

export default function RentalBookingView({ rental }: { rental: RentalDetail }) {
  const { days, windowDays, nextWindow, prevWindow, timeZone, selectedStart, setSelectedStart, endOptions, selectedEnd, setSelectedEnd, quote, formFields, values, setValue, ctaState, canRent, rent, renting, confirmed, error } =
    useRentalFlow(rental);
  const [activeDay, setActiveDay] = useState<string | null>(null);

  // Follow the data: land on the first day with availability, and don't strand the view on a day
  // that left when the window moved.
  useEffect(() => {
    if (days && days.length && !days.some((d) => d.dayKey === activeDay)) setActiveDay(days[0].dayKey);
  }, [days, activeDay]);

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

  const current = days?.find((d) => d.dayKey === activeDay) ?? days?.[0] ?? null;
  const buckets = current ? BUCKETS.map((b) => ({ label: b.label, starts: current.starts.filter((s) => b.test(hourOf(s))) })).filter((b) => b.starts.length) : [];

  // Switching day drops a start chosen on another day — otherwise the CTA names a time that isn't on screen.
  const pickDay = (dayKey: string) => {
    setActiveDay(dayKey);
    if (selectedStart && selectedStart.dayKey !== dayKey) setSelectedStart(null);
  };

  return (
    <div>
      <p className={heading}>{daily ? "Pick a start day" : "Pick a day"}</p>
      {days === null ? (
        <div className="flex gap-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-14 w-[68px] animate-pulse rounded-md bg-secondary" />
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={daily ? "Choose a start day" : "Choose a day"}>
          <button type="button" onClick={prevWindow} className={pager} aria-label={`Previous ${windowDays} days`}>
            Earlier
          </button>
          {days.length === 0 && <p className="self-center text-sm text-muted-foreground">Nothing available in these {windowDays} days.</p>}
          {days.map((day) => {
            const start = daily ? day.starts[0] : null; // a daily rental's day is its start
            const active = daily ? selectedStart?.key === start?.key : day.dayKey === current?.dayKey;
            return (
              <button key={day.dayKey} type="button" aria-pressed={active} disabled={daily && !start?.bookable} className={dayTile(active, daily && !start?.bookable)} onClick={() => (daily && start ? setSelectedStart(start) : pickDay(day.dayKey))}>
                <span className="block text-[10px] uppercase tracking-wide opacity-70">{fmtDay(day.dayKey, { weekday: "short" })}</span>
                <span className="block text-lg font-semibold leading-tight">{fmtDay(day.dayKey, { day: "numeric" })}</span>
              </button>
            );
          })}
          <button type="button" onClick={nextWindow} className={pager} aria-label={`Next ${windowDays} days`}>
            More
            <br />
            dates
          </button>
        </div>
      )}

      {!daily && current && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{fmtDay(current.dayKey, { weekday: "long", month: "short", day: "numeric" })}</p>
            <span className="text-xs text-muted-foreground">
              {current.starts.length} {current.starts.length === 1 ? "start" : "starts"}
              {timeZone ? ` · times in ${timeZone.replace(/_/g, " ")}` : ""}
            </span>
          </div>
          <div className="space-y-4">
            {buckets.map((b) => (
              <div key={b.label}>
                <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{b.label}</p>
                <div className="flex flex-wrap gap-2">
                  {b.starts.map((s) => (
                    <button key={s.key} type="button" disabled={!s.bookable} title={s.location?.name || undefined} className={chip(selectedStart?.key === s.key, !s.bookable)} onClick={() => setSelectedStart(s)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedStart && (
        <div className="mt-6">
          <p className={heading}>How long{daily ? ` from ${selectedStart.label}` : ""}</p>
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

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <button type="button" disabled={!canRent || renting} onClick={() => rent().catch(() => {})} className="mt-5 rounded-control bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
        {renting ? "Reserving…" : rental.free ? `${verb} — free` : quote?.total ? `${verb} · ${quote.total}` : rental.rateLabel ? `${verb} · ${rental.rateLabel}` : verb}
      </button>
    </div>
  );
}
