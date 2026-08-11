// Grid tile for one event. Styled with base44 design tokens (shadcn Tailwind classes) — re-skin via
// those tokens (src/index.css :root/.dark), not this JSX. The date/location/teaser field paths and
// the TICKETING "from" price are load-bearing: lowestPrice is a Money object { value, currency,
// formattedValue } — render formattedValue, NEVER the raw object (React "objects are not valid as a
// child" crash). This is a different shape from the ticket-definition price (pricing.fixedPrice.amount)
// used in the picker.
import { Link } from "react-router-dom";

export default function EventCard({ event }) {
  const when = event.dateAndTimeSettings?.formatted?.dateAndTime;
  const where = event.location?.name;
  const isTicketing = event.registration?.type === "TICKETING";
  const fromPrice = event.registration?.tickets?.lowestPrice?.formattedValue;
  const soldOut = event.registration?.tickets?.soldOut;
  const image = event.mainImage?.url;

  return (
    <Link to={`/events/${event.slug}`}
      className="flex flex-col no-underline text-foreground bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      <div className="relative aspect-[3/2] bg-background">
        {image
          ? <img src={image} alt={event.title} loading="lazy" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-muted flex items-center justify-center" aria-hidden="true"><svg viewBox="0 0 24 24" className="w-8 h-8 text-muted-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg></div>}
        {isTicketing && soldOut && (
          <span className="absolute top-2 left-2 py-0.5 px-2 text-xs bg-destructive text-destructive-foreground rounded-sm">Sold out</span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1">
        <h3 className="m-0 font-display text-base font-semibold">{event.title}</h3>
        {when && <span className="text-muted-foreground text-[13px]">{when}</span>}
        {where && <span className="text-muted-foreground text-[13px]">{where}</span>}
        {event.shortDescription && (
          <p className="m-0 mt-1 text-muted-foreground text-sm leading-[1.4]">
            {event.shortDescription}
          </p>
        )}
        {isTicketing && !soldOut && fromPrice && (
          <span className="mt-1 font-semibold text-primary">From {fromPrice}</span>
        )}
      </div>
    </Link>
  );
}
