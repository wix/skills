// The registration controls for one event — wire as-is (the events counterpart of storefront's
// OptionPicker): branches on the event's registration state and type — closed (sold out or closed
// by the organizer), scheduled ("opens <date>"), paused; then TICKETING renders the tier picker
// (fixed, free, donation and pricing-option tiers, steppers clamped to what can still be bought,
// sold-out and sale-period badges, the tax/fee lines, Wix's running totals, the CTA gated by
// canCheckout), RSVP the ORGANIZER'S form (every control type, the guest picker, the waitlist and
// members-only copy) with its confirmed / waitlisted / declined states, EXTERNAL a link out — on
// the @theme tokens. The event page's layout around it is yours; build your own on
// useEventRegistration only when the brief wants more. Mount client:only — it runs
// visitor-session SDK calls and redirects.
import { useEventRegistration } from "../../hooks/events/useEventRegistration";
import type { EventDetail, RsvpFormControl, RsvpFormInput, TicketTier } from "../../wix/events/types";

const input =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary";
const labelText = "mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const cta =
  "mt-5 rounded-control bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50";
const stepper = "h-8 w-8 rounded-control border border-border text-foreground transition-colors hover:bg-secondary disabled:opacity-40";
const badge = "rounded-control bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground";

function Stepper({ label, qty, max, disabled, onChange }: { label: string; qty: number; max: number; disabled: boolean; onChange: (q: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={`Fewer ${label}`} disabled={disabled || qty === 0} onClick={() => onChange(qty - 1)} className={stepper}>
        −
      </button>
      <span className="w-6 text-center text-sm tabular-nums">{qty}</span>
      <button type="button" aria-label={`More ${label}`} disabled={disabled || qty >= max} onClick={() => onChange(qty + 1)} className={stepper}>
        +
      </button>
    </div>
  );
}

function Notes({ notes }: { notes: string[] }) {
  return notes.length ? <p className="mt-0.5 text-xs text-muted-foreground">{notes.join(" · ")}</p> : null;
}

function TierRow({
  tier,
  quantities,
  guestPrice,
  setQuantity,
  setGuestPrice,
}: {
  tier: TicketTier;
  quantities: Record<string, number>;
  guestPrice: string;
  setQuantity: (tierId: string, qty: number, optionId?: string) => void;
  setGuestPrice: (tierId: string, value: string) => void;
}) {
  const qty = quantities[tier.id] ?? 0;
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {tier.name}
            {tier.soldOut && <span className={`${badge} ml-2`}>Sold out</span>}
            {!tier.soldOut && tier.saleStatus === "SALE_ENDED" && <span className={`${badge} ml-2`}>Sale ended</span>}
          </p>
          {tier.description && <p className="mt-0.5 text-xs text-muted-foreground">{tier.description}</p>}
          {tier.pricingType !== "OPTIONS" && tier.price && <p className="mt-1 text-sm text-foreground">{tier.price}</p>}
          {tier.pricingType === "GUEST" && (
            <p className="mt-1 text-sm text-foreground">{tier.minPrice ? `Pay what you want — at least ${tier.minPrice}` : "Pay what you want"}</p>
          )}
          <Notes notes={tier.notes} />
          {tier.saleStartsLabel && <p className="mt-1 text-xs text-muted-foreground">Goes on sale {tier.saleStartsLabel}</p>}
          {tier.available && tier.saleEndsLabel && <p className="mt-1 text-xs text-muted-foreground">Sale ends {tier.saleEndsLabel}</p>}
        </div>
        {tier.pricingType !== "OPTIONS" && (
          <Stepper label={tier.name} qty={qty} max={tier.limitPerCheckout} disabled={!tier.available} onChange={(q) => setQuantity(tier.id, q)} />
        )}
      </div>
      {tier.pricingType === "GUEST" && (
        <label className="mt-3 block max-w-xs">
          <span className={labelText}>Your amount{tier.currency ? ` (${tier.currency})` : ""}</span>
          <input
            type="number"
            inputMode="decimal"
            min={tier.minPriceValue || 0}
            step="0.01"
            value={guestPrice}
            disabled={!tier.available}
            onChange={(e) => setGuestPrice(tier.id, e.target.value)}
            className={input}
          />
        </label>
      )}
      {tier.pricingType === "OPTIONS" && (
        <div className="mt-3 space-y-2">
          {tier.options.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-4 border-t border-border pt-2">
              <div>
                <p className="text-sm text-foreground">{o.name}</p>
                <p className="text-sm text-foreground">{o.price}</p>
                <Notes notes={o.notes} />
              </div>
              <Stepper
                label={`${tier.name} ${o.name}`}
                qty={quantities[`${tier.id}:${o.id}`] ?? 0}
                max={tier.limitPerCheckout}
                disabled={!tier.available}
                onChange={(q) => setQuantity(tier.id, q, o.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormInput({ control, field, value, onChange }: { control: RsvpFormControl; field: RsvpFormInput; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  const text = Array.isArray(value) ? value.join(", ") : (value ?? "");
  const required = field.mandatory ? <span aria-hidden="true"> *</span> : null;
  if (control.type === "CHECKBOX") {
    const picked = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend className={labelText}>
          {field.label}
          {required}
        </legend>
        {field.options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 py-0.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={picked.includes(opt)}
              onChange={(e) => onChange(e.target.checked ? [...picked, opt] : picked.filter((p) => p !== opt))}
            />
            {opt}
          </label>
        ))}
      </fieldset>
    );
  }
  if (control.type === "RADIO") {
    return (
      <fieldset>
        <legend className={labelText}>
          {field.label}
          {required}
        </legend>
        {field.options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 py-0.5 text-sm text-foreground">
            <input type="radio" name={field.name} checked={text === opt} onChange={() => onChange(opt)} />
            {opt}
          </label>
        ))}
      </fieldset>
    );
  }
  if (control.type === "DROPDOWN" || field.options.length) {
    return (
      <label className="block">
        <span className={labelText}>
          {field.label}
          {required}
        </span>
        <select value={text} onChange={(e) => onChange(e.target.value)} className={input}>
          <option value="">Select…</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (control.type === "TEXTAREA") {
    return (
      <label className="block">
        <span className={labelText}>
          {field.label}
          {required}
        </span>
        <textarea value={text} maxLength={field.maxLength || undefined} onChange={(e) => onChange(e.target.value)} className={`${input} min-h-24`} />
      </label>
    );
  }
  const type = control.type === "DATE" || field.type === "DATE_TIME" ? "date" : field.type === "NUMBER" ? "number" : /mail/i.test(field.name) ? "email" : "text";
  return (
    <label className="block">
      <span className={labelText}>
        {field.label}
        {required}
      </span>
      <input type={type} value={text} maxLength={field.maxLength || undefined} onChange={(e) => onChange(e.target.value)} className={input} />
    </label>
  );
}

export default function EventRegistrationView({ event }: { event: EventDetail }) {
  const {
    tiers,
    quantities,
    guestPrices,
    setQuantity,
    setGuestPrice,
    ticketCount,
    ticketLimitPerOrder,
    totals,
    canCheckout,
    checkout,
    rsvpForm,
    rsvpValues,
    setRsvpValue,
    guestCount,
    guestNames,
    setGuestCount,
    setGuestName,
    canRsvp,
    rsvp,
    submitting,
    confirmed,
    error,
  } = useEventRegistration(event);

  if (confirmed && confirmed.kind === "rsvpConfirmed") {
    return (
      <div className="rounded-lg border border-border bg-secondary p-8 text-center">
        <p className="text-lg font-semibold">
          {confirmed.status === "WAITLIST" ? "You're on the waitlist" : confirmed.status === "NO" ? "Thanks for letting us know" : "You're in!"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {confirmed.status === "WAITLIST"
            ? `${event.title} is full — we'll email you if a spot opens up.`
            : confirmed.status === "NO"
              ? "We've recorded that you can't make it."
              : `See you at ${event.title}${event.dateLabel ? ` — ${event.dateLabel}` : ""}. A confirmation email is on its way.`}
        </p>
      </div>
    );
  }

  // Closed is exactly what Wix calls closed; a scheduled opening and a pause are their own states.
  if (event.registrationClosed || event.registrationType === "NONE") {
    return (
      <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
        {event.soldOut ? "This event is sold out." : "Registration for this event is closed."}
      </div>
    );
  }
  if (event.registrationStatus === "SCHEDULED_RSVP") {
    return (
      <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
        {event.registrationOpensAtLabel ? `Registration opens ${event.registrationOpensAtLabel}.` : "Registration hasn't opened yet."}
      </div>
    );
  }
  if (event.registrationPaused || !event.registrationOpen) {
    return <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">Registration is paused right now — check back soon.</div>;
  }

  if (event.registrationType === "EXTERNAL") {
    return (
      <a href={event.externalUrl} className={`${cta} inline-block no-underline`} target="_blank" rel="noreferrer">
        Register
      </a>
    );
  }

  if (event.registrationType === "TICKETING") {
    return (
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tickets</p>
        {tiers === null ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-secondary" />
            ))}
          </div>
        ) : tiers.length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Tickets aren't available right now.</p>
        ) : (
          <div className="space-y-3">
            {tiers.map((t) => (
              <TierRow key={t.id} tier={t} quantities={quantities} guestPrice={guestPrices[t.id] ?? ""} setQuantity={setQuantity} setGuestPrice={setGuestPrice} />
            ))}
          </div>
        )}
        {totals && (
          <dl className="mt-4 space-y-1 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{totals.subtotal}</dd>
            </div>
            {event.taxSettings && !event.taxSettings.includedInPrice && (
              <div className="flex justify-between">
                <dt>{event.taxSettings.name}</dt>
                <dd className="tabular-nums">{totals.tax}</dd>
              </div>
            )}
            {(tiers ?? []).some((t) => t.feeType === "FEE_ADDED_AT_CHECKOUT") && (
              <div className="flex justify-between">
                <dt>Ticket service fee</dt>
                <dd className="tabular-nums">{totals.fee}</dd>
              </div>
            )}
            <div className="flex justify-between font-medium text-foreground">
              <dt>Total</dt>
              <dd className="tabular-nums">{totals.total}</dd>
            </div>
          </dl>
        )}
        {ticketCount >= ticketLimitPerOrder && <p className="mt-2 text-xs text-muted-foreground">Up to {ticketLimitPerOrder} tickets per order.</p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <button type="button" disabled={!canCheckout || submitting} onClick={() => checkout().catch(() => {})} className={cta}>
          {submitting ? "Reserving…" : ticketCount > 0 ? `Get ${ticketCount} ticket${ticketCount > 1 ? "s" : ""}` : "Get tickets"}
        </button>
      </div>
    );
  }

  if (event.registrationType === "RSVP") {
    const guest = rsvpForm.guestControl;
    return (
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{event.waitlistOnly ? "Waitlist" : "RSVP"}</p>
        {event.waitlistOnly && <p className="mb-3 text-sm text-muted-foreground">This event is full — join the waitlist and we'll email you if a spot opens up.</p>}
        {event.membersOnly && <p className="mb-3 text-sm text-muted-foreground">Registration is for site members — sign in to your account on this site first.</p>}
        <div className="grid max-w-md gap-3">
          {rsvpForm.controls.map((control) =>
            control.inputs.map((field) => (
              <FormInput key={`${control.id}:${field.name}`} control={control} field={field} value={rsvpValues[field.name]} onChange={(v) => setRsvpValue(field.name, v)} />
            )),
          )}
          {guest && guest.maxGuests > 0 && (
            <>
              <label className="block">
                <span className={labelText}>{guest.label}</span>
                <select value={guestCount} onChange={(e) => setGuestCount(Number(e.target.value))} className={input}>
                  {Array.from({ length: guest.maxGuests + 1 }, (_, n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {Array.from({ length: guestCount }, (_, i) => (
                <label key={i} className="block">
                  <span className={labelText}>
                    {guest.namesLabel} {i + 1}
                  </span>
                  <input type="text" value={guestNames[i] ?? ""} onChange={(e) => setGuestName(i, e.target.value)} className={input} />
                </label>
              ))}
            </>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="button" disabled={!canRsvp || submitting} onClick={() => rsvp(true).catch(() => {})} className={cta}>
            {submitting ? "Sending…" : event.waitlistOnly ? "Join the waitlist" : "Count me in"}
          </button>
          {event.rsvpResponseType === "YES_AND_NO" && (
            <button
              type="button"
              disabled={!canRsvp || submitting}
              onClick={() => rsvp(false).catch(() => {})}
              className="mt-5 rounded-control border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              Can't make it
            </button>
          )}
        </div>
      </div>
    );
  }

  return <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">Registration isn't open for this event.</div>;
}
