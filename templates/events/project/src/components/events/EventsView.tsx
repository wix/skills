// REFERENCE listing surface: category filter + events grid + "load more" on the @theme tokens.
// Correct and complete; per the skill's model you design and build your own on useEvents.
import type { ComponentType, ReactNode } from "react";
import { useEvents } from "../../hooks/events/useEvents";
import { imgAttrs } from "../../wix/media";
import type { EventSummary } from "../../wix/events/types";

export interface LinkLikeProps {
  href: string;
  className?: string;
  children?: ReactNode;
}

const PlainLink = ({ href, className, children }: LinkLikeProps) => (
  <a href={href} className={className}>
    {children}
  </a>
);

export interface EventCardProps {
  event: EventSummary;
  eventHref?: (slug: string) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

export function EventCard({
  event,
  eventHref = (slug) => `/events/${encodeURIComponent(slug)}`,
  LinkComponent = PlainLink,
}: EventCardProps) {
  return (
    <LinkComponent href={eventHref(event.slug)} className="group block no-underline">
      <div className="relative aspect-[3/2] overflow-hidden rounded-lg bg-secondary">
        {event.imageUrl && (
          <img
            {...imgAttrs(event.imageUrl, "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw", 2 / 3)}
            alt={event.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}
        {event.soldOut && (
          <span className="absolute left-3 top-3 rounded-control bg-background/90 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur">
            Sold out
          </span>
        )}
      </div>
      {event.dateLabel && <p className="eyebrow mt-3">{event.dateLabel}</p>}
      <p className="mt-1 text-sm font-medium text-foreground">{event.title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {event.locationType === "ONLINE" ? "Online" : event.locationName}
        {event.priceLabel ? ` · ${event.priceLabel}` : ""}
      </p>
    </LinkComponent>
  );
}

export interface EventsViewProps {
  initialEvents?: EventSummary[];
  /** From fetchEventsPage — lets the list know there is more to load. */
  initialTotal?: number;
  emptyMessage?: string;
  eventHref?: EventCardProps["eventHref"];
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<EventCardProps>;
}

const pill = (active: boolean) =>
  `rounded-control border px-4 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

export default function EventsView({
  initialEvents,
  initialTotal,
  emptyMessage = "No upcoming events — check back soon.",
  eventHref,
  LinkComponent,
  CardComponent = EventCard,
}: EventsViewProps) {
  const { events, categories, activeCategoryId, setActiveCategoryId, hasMore, loadingMore, loadMore, error } = useEvents({
    initialEvents,
    initialTotal,
  });

  return (
    <div>
      {categories.length > 1 && (
        <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Categories">
          <button type="button" className={pill(activeCategoryId === null)} onClick={() => setActiveCategoryId(null)}>
            All
          </button>
          {categories.map((c) => (
            <button key={c.id} type="button" className={pill(activeCategoryId === c.id)} onClick={() => setActiveCategoryId(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {events === null ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="aspect-[3/2] animate-pulse rounded-lg bg-secondary" />
              <div className="mt-3 h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{loadingMore ? "Loading…" : emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <CardComponent key={e.id} event={e} eventHref={eventHref} LinkComponent={LinkComponent} />
          ))}
        </div>
      )}
      {hasMore && (
        <div className="mt-10 text-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="rounded-control border border-border px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
