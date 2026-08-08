// Responsive event grid + empty state. Styled with base44 design tokens (shadcn Tailwind classes).
import EventCard from "./EventCard";

export default function EventGrid({ events, empty = "No events yet." }) {
  if (!events?.length) {
    return <p className="text-muted-foreground p-4 text-center">{empty}</p>;
  }
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
      {events.map((e) => <EventCard key={e.id} event={e} />)}
    </div>
  );
}
