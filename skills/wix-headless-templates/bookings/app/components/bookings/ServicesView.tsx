// REFERENCE listing surface: category + location filters, services grid, load-more, on the @theme
// tokens. Correct and complete; per the skill's model you design and build your own on useServices.
import type { ComponentType, ReactNode } from "react";
import { useServices } from "../../hooks/bookings/useServices";
import { OTHER_LOCATIONS_ID } from "../../wix/bookings/services-store";
import type { BookingCategory, LocationOption, ServiceSummary, Weekday } from "../../wix/bookings/types";

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

const TYPE_LABEL: Record<ServiceSummary["type"], string> = { APPOINTMENT: "Appointment", CLASS: "Class", COURSE: "Course" };
const DAY_SHORT: Record<Weekday, string> = { MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun" };

/** The price line a tile shows: "From €30", a struck-through base price beside a discount, or the plain price. */
export function PriceLine({ service }: { service: ServiceSummary }) {
  if (!service.price) return null;
  return (
    <span className="text-foreground">
      {service.priceFrom ? "From " : ""}
      {service.price}
      {service.basePrice && <s className="ml-1 text-muted-foreground">{service.basePrice}</s>}
      {service.discountName && <span className="ml-1 text-xs text-muted-foreground">{service.discountName}</span>}
      {service.calculatedAtCheckout && <span className="ml-1 text-xs text-muted-foreground">(discount at checkout)</span>}
    </span>
  );
}

export interface ServiceCardProps {
  service: ServiceSummary;
  serviceHref?: (slug: string) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

export function ServiceCard({
  service,
  serviceHref = (slug) => `/services/${slug}`,
  LinkComponent = PlainLink,
}: ServiceCardProps) {
  return (
    <LinkComponent href={serviceHref(service.slug)} className="group block no-underline">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-secondary">
        {service.imageUrl && (
          <img
            src={service.imageUrl}
            alt={service.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}
        <span className="absolute left-3 top-3 flex gap-1">
          <span className="rounded-control bg-background/90 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur">{TYPE_LABEL[service.type]}</span>
          {service.conferencing && <span className="rounded-control bg-background/90 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur">Online</span>}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{service.name}</p>
      {service.tagLine && <p className="mt-0.5 text-xs text-muted-foreground">{service.tagLine}</p>}
      <p className="mt-1 text-sm text-muted-foreground">
        {service.durationLabel ? `${service.durationLabel} · ` : ""}
        <PriceLine service={service} />
      </p>
      {service.offeredDays.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{service.offeredDays.map((d) => DAY_SHORT[d]).join(", ")}</p>}
      {service.locations.length > 0 && service.locations[0].name && (
        <p className="mt-0.5 text-xs text-muted-foreground">{service.locations.map((l) => l.name).filter(Boolean).join(" · ")}</p>
      )}
    </LinkComponent>
  );
}

export interface ServicesViewProps {
  initialServices?: ServiceSummary[];
  initialHasMore?: boolean;
  initialCategories?: BookingCategory[];
  initialLocations?: { locations: LocationOption[]; hasOtherLocations: boolean };
  initialCategoryId?: string | null;
  initialLocationId?: string | null;
  emptyMessage?: string;
  serviceHref?: ServiceCardProps["serviceHref"];
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<ServiceCardProps>;
}

const pill = (active: boolean) =>
  `rounded-control border px-4 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

export default function ServicesView({
  initialServices,
  initialHasMore,
  initialCategories,
  initialLocations,
  initialCategoryId,
  initialLocationId,
  emptyMessage = "No services yet — check back soon.",
  serviceHref,
  LinkComponent,
  CardComponent = ServiceCard,
}: ServicesViewProps) {
  const {
    services,
    categories,
    locations,
    hasOtherLocations,
    activeCategoryId,
    setActiveCategoryId,
    activeLocationId,
    setActiveLocationId,
    hasMore,
    loadingMore,
    loadMore,
    error,
  } = useServices({ initialServices, initialHasMore, initialCategories, initialLocations, initialCategoryId, initialLocationId });

  const locationOptions = locations.length + (hasOtherLocations ? 1 : 0);

  return (
    <div>
      {categories.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Categories">
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
      {locationOptions > 1 && (
        <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Locations">
          <button type="button" className={pill(activeLocationId === null)} onClick={() => setActiveLocationId(null)}>
            All locations
          </button>
          {locations.map((l) => (
            <button key={l.id} type="button" className={pill(activeLocationId === l.id)} onClick={() => setActiveLocationId(l.id)}>
              {l.name}
            </button>
          ))}
          {hasOtherLocations && (
            <button type="button" className={pill(activeLocationId === OTHER_LOCATIONS_ID)} onClick={() => setActiveLocationId(OTHER_LOCATIONS_ID)}>
              Other locations
            </button>
          )}
        </div>
      )}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {services === null ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="aspect-[4/3] animate-pulse rounded-lg bg-secondary" />
              <div className="mt-3 h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : services.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <CardComponent key={s.id} service={s} serviceHref={serviceHref} LinkComponent={LinkComponent} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-10 text-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="rounded-control border border-border px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
