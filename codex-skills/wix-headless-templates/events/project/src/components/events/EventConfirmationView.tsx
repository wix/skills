// REFERENCE post-checkout confirmation: the Wix-hosted checkout redirects to
// /event-confirmation?orderNumber=&eventId= on success — this island reads those params and
// binds the order store: the event for context, the order (invoice, status, ticket PDF) polled
// until Wix has generated the tickets. Mount client:only (it reads the browser URL). Landing here
// IS the success signal for a ticket order (Wix redirects only after checkout completes); when
// the visitor scope can't read the order, the page still confirms and says the tickets arrive by
// email — never invented order details.
import { useState } from "react";
import { useEventConfirmation } from "../../hooks/events/useEventConfirmation";

const row = "flex justify-between gap-4 py-1";

export default function EventConfirmationView({ eventsHref = "/events" }: { eventsHref?: string }) {
  const [params] = useState(() => {
    if (typeof window === "undefined") return { orderNumber: "", eventId: "" };
    const q = new URLSearchParams(window.location.search);
    return { orderNumber: q.get("orderNumber") ?? "", eventId: q.get("eventId") ?? "" };
  });
  const { event, order, orderUnavailable, polling, loading } = useEventConfirmation(params);

  if (!params.orderNumber) {
    // Direct visit with no order in the URL — an honest state, not a fake confirmation.
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-lg font-semibold">No order to show</p>
        <a href={eventsHref} className="mt-4 inline-block text-sm text-foreground underline">
          Browse events
        </a>
      </div>
    );
  }

  const settled = order ? order.settled : true;
  return (
    <div className="mx-auto max-w-lg py-16">
      <div className="text-center">
        <p className="eyebrow">Order {params.orderNumber}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{settled ? "You're going!" : "Thanks for your order"}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {event ? `${event.title}${event.dateLabel ? ` — ${event.dateLabel}` : ""}. ` : ""}
          {order && !order.settled && order.statusLabel
            ? `${order.statusLabel}. `
            : ""}
          {order?.email ? `Your tickets are on their way to ${order.email}.` : "Your tickets are on their way to your email."}
        </p>
        {event?.address && <p className="mt-1 text-sm text-muted-foreground">{event.address}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {order?.ticketsReady && order.ticketsPdfUrl && (
            <a href={order.ticketsPdfUrl} target="_blank" rel="noreferrer" className="rounded-control bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground no-underline transition-opacity hover:opacity-90">
              Download tickets
            </a>
          )}
          {order && !order.ticketsReady && polling && <span className="self-center text-sm text-muted-foreground">Preparing your tickets…</span>}
          {event?.addToCalendar.google && (
            <a href={event.addToCalendar.google} target="_blank" rel="noreferrer" className="rounded-control border border-border px-6 py-2.5 text-sm font-medium text-foreground no-underline transition-colors hover:bg-secondary">
              Add to Google Calendar
            </a>
          )}
          {event?.addToCalendar.ics && (
            <a href={event.addToCalendar.ics} className="rounded-control border border-border px-6 py-2.5 text-sm font-medium text-foreground no-underline transition-colors hover:bg-secondary">
              iCal
            </a>
          )}
        </div>
      </div>

      {loading && !order && <div className="mt-8 h-24 animate-pulse rounded-lg bg-secondary" aria-busy="true" />}

      {order && (
        <div className="mt-8 rounded-lg border border-border p-5 text-sm">
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>{order.createdLabel}</span>
            <span>{order.statusLabel}</span>
          </div>
          <dl className="mt-3 divide-y divide-border">
            {order.items.map((item, i) => (
              <div key={i} className={row}>
                <dt className="text-foreground">
                  {item.name}
                  <span className="text-muted-foreground"> × {item.quantity}</span>
                </dt>
                <dd className="tabular-nums text-foreground">{item.total}</dd>
              </div>
            ))}
          </dl>
          <dl className="mt-3 border-t border-border pt-3 text-muted-foreground">
            {order.subtotal && (
              <div className={row}>
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{order.subtotal}</dd>
              </div>
            )}
            {order.couponDiscount && (
              <div className={row}>
                <dt>Coupon</dt>
                <dd className="tabular-nums">−{order.couponDiscount}</dd>
              </div>
            )}
            {order.paidPlanDiscount && (
              <div className={row}>
                <dt>Plan discount{order.paidPlanDiscount.ratePercent ? ` (${order.paidPlanDiscount.ratePercent}%)` : ""}</dt>
                <dd className="tabular-nums">−{order.paidPlanDiscount.amount}</dd>
              </div>
            )}
            {order.tax && (
              <div className={row}>
                <dt>
                  {order.tax.name}
                  {order.tax.ratePercent ? ` (${order.tax.ratePercent}%)` : ""}
                </dt>
                <dd className="tabular-nums">{order.tax.amount}</dd>
              </div>
            )}
            {order.fee && (
              <div className={row}>
                <dt>Ticket service fee{order.fee.ratePercent ? ` (${order.fee.ratePercent}%)` : ""}</dt>
                <dd className="tabular-nums">{order.fee.amount}</dd>
              </div>
            )}
            {order.total && (
              <div className={`${row} font-medium text-foreground`}>
                <dt>Total</dt>
                <dd className="tabular-nums">{order.total}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {orderUnavailable && !order && <p className="mt-8 text-center text-xs text-muted-foreground">Order details aren't available here — the confirmation email has everything.</p>}

      <div className="mt-6 text-center">
        <a href={eventsHref} className="text-sm text-muted-foreground underline">
          Back to events
        </a>
      </div>
    </div>
  );
}
