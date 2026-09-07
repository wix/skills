// REFERENCE post-checkout confirmation: the Wix-hosted checkout redirects to
// /event-confirmation?orderNumber=&eventId= on success — this island reads those params and
// fetches the event for context. Mount client:only (it reads the browser URL). Landing here
// IS the success signal for a ticket order (Wix redirects only after checkout completes);
// the ticket PDF/QR arrives by email — echo the order number, don't invent order details.
import { useEffect, useState } from "react";
import { fetchEventById } from "../../wix/events/events";
import type { EventDetail } from "../../wix/events/types";

export default function EventConfirmationView({ eventsHref = "/events" }: { eventsHref?: string }) {
  const [params] = useState(() => {
    if (typeof window === "undefined") return { orderNumber: "", eventId: "" };
    const q = new URLSearchParams(window.location.search);
    return { orderNumber: q.get("orderNumber") ?? "", eventId: q.get("eventId") ?? "" };
  });
  const [event, setEvent] = useState<EventDetail | null>(null);

  useEffect(() => {
    let alive = true;
    if (params.eventId) {
      fetchEventById(params.eventId).then((e) => alive && setEvent(e));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.eventId]);

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

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="eyebrow">Order {params.orderNumber}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">You're going! 🎟️</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {event ? `${event.title}${event.dateLabel ? ` — ${event.dateLabel}` : ""}. ` : ""}
        Your tickets are on their way to your email.
      </p>
      {event?.addToCalendar.google && (
        <a
          href={event.addToCalendar.google}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-block rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground no-underline transition-colors hover:bg-secondary"
        >
          Add to Google Calendar
        </a>
      )}
      <div className="mt-4">
        <a href={eventsHref} className="text-sm text-muted-foreground underline">
          Back to events
        </a>
      </div>
    </div>
  );
}
