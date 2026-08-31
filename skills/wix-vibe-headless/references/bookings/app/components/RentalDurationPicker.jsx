// Rental length picker — pure UI. The options, the selection handler and the priced total all
// come from useRentalDuration; no data wiring lives here.
//
// Renders the step an ordinary service doesn't have: the customer has already picked a START
// (SlotPicker), and now picks HOW LONG. The running total sits beside the choices because a
// rental's cost depends on the length — showing only a rate per hour leaves the customer
// discovering the real number at checkout.
//
// Show this only when `rental.isRental` — an appointment or class has no length to choose.
// Styled with base44 design tokens (shadcn Tailwind classes).
const optionCls = "py-2.5 px-3 cursor-pointer text-sm font-body border rounded-sm transition-colors";
const idle = "border-border bg-card text-foreground hover:border-foreground/40";
const active = "border-primary bg-primary text-primary-foreground";

/**
 * @param {{
 *   rental: object,        // the whole return of useRentalDuration
 *   startLabel?: string,   // e.g. "Fri 4 Sep, 10:00" — what the customer already picked
 * }} props
 */
export default function RentalDurationPicker({ rental, startLabel }) {
  const { isRental, duration, options, selected, select, price, loading, error } = rental;
  if (!isRental) return null;

  const unitWord = duration?.unit === "DAY" ? "days" : "hours";

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          How long{startLabel ? ` from ${startLabel}` : ""}
        </p>
        {price?.total ? (
          <p className="text-sm font-semibold text-foreground">{price.total}</p>
        ) : selected ? (
          <p className="text-sm text-muted-foreground">Pricing…</p>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading available {unitWord}…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !options.length ? (
        // An empty list is a real answer: this start has no bookable length. Say so, and leave
        // the start picker in place so the customer can choose another one.
        <p className="text-sm text-muted-foreground">
          Nothing available from that start — pick another time.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {options.map((option) => (
            <button
              key={option.localEndDate}
              type="button"
              aria-pressed={selected?.localEndDate === option.localEndDate}
              className={`${optionCls} ${selected?.localEndDate === option.localEndDate ? active : idle}`}
              onClick={() => select(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
