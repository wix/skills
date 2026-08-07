// Responsive event grid + empty state. Token-styled; re-skin via theme.css.
import EventCard from "./EventCard";

export default function EventGrid({ events, empty = "No events yet." }) {
  if (!events?.length) {
    return (
      <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>{empty}</p>
    );
  }
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: "var(--space)",
    }}>
      {events.map((e) => <EventCard key={e.id} event={e} />)}
    </div>
  );
}
