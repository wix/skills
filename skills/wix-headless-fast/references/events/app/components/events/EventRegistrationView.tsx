// REFERENCE registration surface: branches on event.registrationType — TICKETING renders
// the tier picker (quantity steppers → checkout CTA), RSVP the built-in name+email form,
// EXTERNAL a link out, NONE/closed an honest closed state — on the @theme tokens. Correct
// and complete; per the skill's model you design and build your own on useEventRegistration.
// Mount client:only — it runs visitor-session SDK calls and redirects.
import { useEventRegistration } from "../../hooks/events/useEventRegistration";
import type { EventDetail } from "../../wix/events/types";

const input =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary";
const cta =
  "mt-5 rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50";

export default function EventRegistrationView({ event }: { event: EventDetail }) {
  const {
    tiers,
    quantities,
    setQuantity,
    ticketCount,
    canCheckout,
    checkout,
    rsvpValues,
    setRsvpValue,
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
          {confirmed.status === "WAITLIST"
            ? "You're on the waitlist"
            : confirmed.status === "NO"
              ? "Thanks for letting us know"
              : "You're in! 🎉"}
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

  if (!event.registrationOpen) {
    return (
      <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
        {event.soldOut ? "This event is sold out." : "Registration for this event is closed."}
      </div>
    );
  }

  if (event.registrationType === "EXTERNAL") {
    return (
      <a href={event.externalUrl} className={`${cta} inline-block no-underline`} target="_blank" rel="noreferrer">
        Register ↗
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
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            Tickets aren't available right now.
          </p>
        ) : (
          <div className="space-y-3">
            {tiers.map((t) => {
              const onSale = t.saleStatus === "SALE_STARTED";
              const qty = quantities[t.id] ?? 0;
              return (
                <div key={t.id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.name}</p>
                    {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
                    <p className="mt-1 text-sm text-foreground">{t.price}</p>
                    {!onSale && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.saleStatus === "SALE_SCHEDULED" ? "Sale hasn't started yet" : "Sale ended"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Fewer ${t.name}`}
                      disabled={!onSale || qty === 0}
                      onClick={() => setQuantity(t.id, qty - 1)}
                      className="h-8 w-8 rounded-full border border-border text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm tabular-nums">{qty}</span>
                    <button
                      type="button"
                      aria-label={`More ${t.name}`}
                      disabled={!onSale || qty >= t.limitPerCheckout}
                      onClick={() => setQuantity(t.id, qty + 1)}
                      className="h-8 w-8 rounded-full border border-border text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button type="button" disabled={!canCheckout || submitting} onClick={() => checkout().catch(() => {})} className={cta}>
          {submitting ? "Reserving…" : ticketCount > 0 ? `Get ${ticketCount} ticket${ticketCount > 1 ? "s" : ""}` : "Get tickets"}
        </button>
      </div>
    );
  }

  if (event.registrationType === "RSVP") {
    return (
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">RSVP</p>
        <div className="grid max-w-md gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">First name</span>
            <input type="text" value={rsvpValues.firstName} onChange={(e) => setRsvpValue("firstName", e.target.value)} className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last name</span>
            <input type="text" value={rsvpValues.lastName} onChange={(e) => setRsvpValue("lastName", e.target.value)} className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</span>
            <input type="email" value={rsvpValues.email} onChange={(e) => setRsvpValue("email", e.target.value)} className={input} />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="button" disabled={!canRsvp || submitting} onClick={() => rsvp(true).catch(() => {})} className={cta}>
            {submitting ? "Sending…" : "Count me in"}
          </button>
          {event.rsvpResponseType === "YES_AND_NO" && (
            <button
              type="button"
              disabled={!canRsvp || submitting}
              onClick={() => rsvp(false).catch(() => {})}
              className="mt-5 rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              Can't make it
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
      Registration isn't open for this event.
    </div>
  );
}
