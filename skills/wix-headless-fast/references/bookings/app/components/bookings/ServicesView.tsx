// REFERENCE listing surface: category filter + services grid on the @theme tokens.
// Correct and complete; per the skill's model you design and build your own on useServices.
import type { ComponentType, ReactNode } from "react";
import { useServices } from "../../hooks/bookings/useServices";
import type { BookingCategory, ServiceSummary } from "../../wix/bookings/types";

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
        <span className="absolute left-3 top-3 rounded-full bg-background/90 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur">
          {service.type === "CLASS" ? "Class" : "Appointment"}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{service.name}</p>
      {service.tagLine && <p className="mt-0.5 text-xs text-muted-foreground">{service.tagLine}</p>}
      <p className="mt-1 text-sm text-muted-foreground">
        {service.durationMinutes ? `${service.durationMinutes} min · ` : ""}
        <span className="text-foreground">{service.price}</span>
      </p>
    </LinkComponent>
  );
}

export interface ServicesViewProps {
  initialServices?: ServiceSummary[];
  initialCategories?: BookingCategory[];
  emptyMessage?: string;
  serviceHref?: ServiceCardProps["serviceHref"];
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<ServiceCardProps>;
}

const pill = (active: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

export default function ServicesView({
  initialServices,
  initialCategories,
  emptyMessage = "No services yet — check back soon.",
  serviceHref,
  LinkComponent,
  CardComponent = ServiceCard,
}: ServicesViewProps) {
  const { services, categories, activeCategoryId, setActiveCategoryId, error } = useServices({
    initialServices,
    initialCategories,
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
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
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
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <CardComponent key={s.id} service={s} serviceHref={serviceHref} LinkComponent={LinkComponent} />
          ))}
        </div>
      )}
    </div>
  );
}
