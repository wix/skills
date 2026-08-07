// Grid tile for one event. Styled entirely from theme.css tokens (var(--...)) — re-skin via those
// tokens, not this JSX. The date/location/teaser field paths and the TICKETING "from" price are
// load-bearing: lowestPrice is a Money object { value, currency, formattedValue } — render
// formattedValue, NEVER the raw object (React "objects are not valid as a child" crash). This is a
// different shape from the ticket-definition price (pricing.fixedPrice.amount) used in the picker.
import { Link } from "react-router-dom";

export default function EventCard({ event }) {
  const when = event.dateAndTimeSettings?.formatted?.dateAndTime;
  const where = event.location?.name;
  const isTicketing = event.registration?.type === "TICKETING";
  const fromPrice = event.registration?.tickets?.lowestPrice?.formattedValue;
  const soldOut = event.registration?.tickets?.soldOut;
  const image = event.mainImage?.url;

  return (
    <Link to={`/events/${event.slug}`} style={{
      display: "flex", flexDirection: "column", textDecoration: "none",
      color: "var(--color-text)", background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
      overflow: "hidden", boxShadow: "var(--shadow)",
    }}>
      <div style={{ position: "relative", aspectRatio: "3 / 2", background: "var(--color-bg)" }}>
        {image
          ? <img src={image} alt={event.title} loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%" }} />}
        {isTicketing && soldOut && (
          <span style={{
            position: "absolute", top: 8, left: 8, padding: "2px 8px", fontSize: 12,
            background: "var(--color-danger)", color: "#fff", borderRadius: "var(--radius-sm)",
          }}>Sold out</span>
        )}
      </div>
      <div style={{ padding: "calc(var(--space) * 0.75)", display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600 }}>{event.title}</h3>
        {when && <span style={{ color: "var(--color-muted)", fontSize: 13 }}>{when}</span>}
        {where && <span style={{ color: "var(--color-muted)", fontSize: 13 }}>{where}</span>}
        {event.shortDescription && (
          <p style={{ margin: "4px 0 0", color: "var(--color-muted)", fontSize: 14, lineHeight: 1.4 }}>
            {event.shortDescription}
          </p>
        )}
        {isTicketing && !soldOut && fromPrice && (
          <span style={{ marginTop: 4, fontWeight: 600, color: "var(--color-accent)" }}>From {fromPrice}</span>
        )}
      </div>
    </Link>
  );
}
