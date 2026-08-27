// REFERENCE gallery surface: collections grid on the @theme tokens.
// Correct and complete; per the skill's model you design and build your own on useCollections.
import type { ComponentType, ReactNode } from "react";
import { useCollections } from "../../hooks/portfolio/useCollections";
import type { CollectionSummary } from "../../wix/portfolio/types";

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

export interface CollectionCardProps {
  collection: CollectionSummary;
  collectionHref?: (slug: string) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

export function CollectionCard({
  collection,
  collectionHref = (slug) => `/portfolio/${slug}`,
  LinkComponent = PlainLink,
}: CollectionCardProps) {
  return (
    <LinkComponent href={collectionHref(collection.slug)} className="group block no-underline">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-secondary">
        {collection.imageUrl && (
          <img
            src={collection.imageUrl}
            alt={collection.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{collection.title}</p>
      {collection.description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{collection.description}</p>
      )}
    </LinkComponent>
  );
}

export interface CollectionsViewProps {
  initialCollections?: CollectionSummary[];
  emptyMessage?: string;
  collectionHref?: CollectionCardProps["collectionHref"];
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<CollectionCardProps>;
}

export default function CollectionsView({
  initialCollections,
  emptyMessage = "No collections yet — check back soon.",
  collectionHref,
  LinkComponent,
  CardComponent = CollectionCard,
}: CollectionsViewProps) {
  const { collections, error } = useCollections({ initialCollections });

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {collections === null ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="aspect-[4/3] animate-pulse rounded-lg bg-secondary" />
              <div className="mt-3 h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : collections.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c) => (
            <CardComponent key={c.id} collection={c} collectionHref={collectionHref} LinkComponent={LinkComponent} />
          ))}
        </div>
      )}
    </div>
  );
}
