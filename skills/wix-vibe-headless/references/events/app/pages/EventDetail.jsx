// Event detail page — thin view over useEventDetail (all logic lives in the hook). Renders the
// event summary + the registration surface. Styled with base44 design tokens (shadcn Tailwind classes).
//
// shortDescription is a PLAIN string (safe to render). event.description is Ricos rich content
// { nodes: [...] } — NOT a string; to show the full body render it with @wix/ricos or walk `nodes`.
// NEVER call string methods (.slice/.substring/.split) on event.description — that crashes the page.
import { useParams } from "react-router-dom";
import { useEventDetail } from "@/hooks/useEventDetail";
import EventRegistration from "@/components/EventRegistration";

export default function EventDetail() {
  const { slug } = useParams();
  const d = useEventDetail(slug);

  if (d.notFound) return <Centered>Event not found.</Centered>;
  if (!d.event) return <Centered>Loading…</Centered>;

  const { event } = d;
  const when = event.dateAndTimeSettings?.formatted?.dateAndTime;
  const where = event.location?.name;

  return (
    <main className="max-w-[1200px] mx-auto p-4 grid gap-8 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
      <div className="aspect-[3/2] bg-card rounded-lg overflow-hidden">
        {event.mainImage?.url &&
          <img src={event.mainImage.url} alt={event.title} className="w-full h-full object-cover" />}
      </div>

      <div>
        <h1 className="font-display m-0 mb-2">{event.title}</h1>
        {when && <p className="m-0 mb-1 text-muted-foreground">{when}</p>}
        {where && <p className="m-0 mb-4 text-muted-foreground">{where}</p>}

        {event.shortDescription && (
          <p className="text-foreground leading-relaxed mb-6">
            {event.shortDescription}
          </p>
        )}

        <EventRegistration event={event} type={d.type} open={d.open} registration={d.registration} />
      </div>
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
