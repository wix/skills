// Event detail page — thin view over useEventDetail (all logic lives in the hook). Renders the
// event summary + the registration surface. Token-styled; re-skin via theme.css.
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
    <main style={{
      maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)",
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "calc(var(--space) * 2)",
    }}>
      <div style={{
        aspectRatio: "3 / 2", background: "var(--color-surface)",
        borderRadius: "var(--radius)", overflow: "hidden",
      }}>
        {event.mainImage?.url &&
          <img src={event.mainImage.url} alt={event.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>

      <div>
        <h1 style={{ fontFamily: "var(--font-display)", margin: "0 0 8px" }}>{event.title}</h1>
        {when && <p style={{ margin: "0 0 4px", color: "var(--color-muted)" }}>{when}</p>}
        {where && <p style={{ margin: "0 0 var(--space)", color: "var(--color-muted)" }}>{where}</p>}

        {event.shortDescription && (
          <p style={{ color: "var(--color-text)", lineHeight: 1.6, marginBottom: "calc(var(--space) * 1.5)" }}>
            {event.shortDescription}
          </p>
        )}

        <EventRegistration event={event} type={d.type} open={d.open} registration={d.registration} />
      </div>
    </main>
  );
}

function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
