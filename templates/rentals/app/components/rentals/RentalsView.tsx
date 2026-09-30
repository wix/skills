// REFERENCE listing surface: rentals grid with the rate and range per tile, skeletons, an honest
// empty state, and load-more, on the @theme tokens. Correct and complete; per the skill's model you
// design and build your own on useRentals.
import type { ComponentType, ReactNode } from "react";
import { useRentals } from "../../hooks/rentals/useRentals";
import type { RentalSummary } from "../../wix/rentals/types";

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

export interface RentalCardProps {
  rental: RentalSummary;
  rentalHref?: (slug: string) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

export function RentalCard({ rental, rentalHref = (slug) => `/rentals/${slug}`, LinkComponent = PlainLink }: RentalCardProps) {
  return (
    <LinkComponent href={rentalHref(rental.slug)} className="group block no-underline">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-secondary">
        {rental.imageUrl && <img src={rental.imageUrl} alt={rental.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />}
        <span className="absolute left-3 top-3 rounded-control bg-background/90 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur">{rental.unit === "DAY" ? "By the day" : "By the hour"}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{rental.name}</p>
      {rental.tagLine && <p className="mt-0.5 text-xs text-muted-foreground">{rental.tagLine}</p>}
      <p className="mt-1 text-sm text-muted-foreground">
        {rental.rateLabel && <span className="text-foreground">{rental.rateLabel}</span>}
        {rental.rateLabel && rental.rangeLabel ? " · " : ""}
        {rental.rangeLabel}
      </p>
      {rental.locations.length > 0 && rental.locations[0].name && <p className="mt-0.5 text-xs text-muted-foreground">{rental.locations.map((l) => l.name).filter(Boolean).join(" · ")}</p>}
    </LinkComponent>
  );
}

export interface RentalsViewProps {
  initialRentals?: RentalSummary[];
  initialHasMore?: boolean;
  emptyMessage?: string;
  rentalHref?: RentalCardProps["rentalHref"];
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<RentalCardProps>;
}

export default function RentalsView({ initialRentals, initialHasMore, emptyMessage = "Nothing to rent yet — check back soon.", rentalHref, LinkComponent, CardComponent = RentalCard }: RentalsViewProps) {
  const { rentals, hasMore, loadingMore, loadMore, error } = useRentals({ initialRentals, initialHasMore });

  return (
    <div>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {rentals === null ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="aspect-[4/3] animate-pulse rounded-lg bg-secondary" />
              <div className="mt-3 h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : rentals.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {rentals.map((r) => (
              <CardComponent key={r.id} rental={r} rentalHref={rentalHref} LinkComponent={LinkComponent} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-10 text-center">
              <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="rounded-control border border-border px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50">
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
