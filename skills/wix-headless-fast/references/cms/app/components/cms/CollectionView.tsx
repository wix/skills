// REFERENCE listing surface: a generic card grid over any collection, driven by a field
// map from the seed plan. Correct and complete; per the skill's model you design and build
// your own on useCollection.
import type { ComponentType, ReactNode } from "react";
import { useCollection } from "../../hooks/cms/useCollection";
import type { CmsFilter, CmsItem, CmsSort } from "../../wix/cms/types";

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

/** Which field keys (from the seed plan) fill each card slot. */
export interface CmsFieldMap {
  /** TEXT field for the card title. */
  title: string;
  /** IMAGE field (DTO value is a resolved https URL). */
  image?: string;
  /** Short text under the title. */
  subtitle?: string;
  /** DATE/DATETIME field (DTO value is an ISO string). */
  date?: string;
  /** Field used in item URLs (default: the item's `_id`). */
  slug?: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

export interface CollectionCardProps {
  item: CmsItem;
  fieldMap: CmsFieldMap;
  itemHref: (item: CmsItem) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

export function CollectionCard({ item, fieldMap, itemHref, LinkComponent = PlainLink }: CollectionCardProps) {
  const imageUrl = fieldMap.image ? text(item[fieldMap.image]) : "";
  const dateIso = fieldMap.date ? text(item[fieldMap.date]) : "";
  return (
    <LinkComponent href={itemHref(item)} className="group block no-underline">
      {imageUrl && (
        <div className="aspect-[4/3] overflow-hidden rounded-lg bg-secondary">
          <img
            src={imageUrl}
            alt={text(item[fieldMap.title])}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </div>
      )}
      <p className="mt-3 text-sm font-medium text-foreground">{text(item[fieldMap.title])}</p>
      {fieldMap.subtitle && text(item[fieldMap.subtitle]) && (
        <p className="mt-0.5 text-xs text-muted-foreground">{text(item[fieldMap.subtitle])}</p>
      )}
      {dateIso && (
        <p className="mt-1 text-xs text-muted-foreground">{new Date(dateIso).toLocaleDateString()}</p>
      )}
    </LinkComponent>
  );
}

export interface CollectionViewProps {
  collectionId: string;
  fieldMap: CmsFieldMap;
  filters?: CmsFilter[];
  sort?: CmsSort[];
  limit?: number;
  initialItems?: CmsItem[];
  initialHasNext?: boolean;
  emptyMessage?: string;
  /** Route shape is yours — default `/<collectionId>/<slug-or-_id>`. */
  itemHref?: (item: CmsItem) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<CollectionCardProps>;
}

export default function CollectionView({
  collectionId,
  fieldMap,
  filters,
  sort,
  limit,
  initialItems,
  initialHasNext,
  emptyMessage = "Nothing here yet — check back soon.",
  itemHref,
  LinkComponent,
  CardComponent = CollectionCard,
}: CollectionViewProps) {
  const { items, hasNext, loadMore, loadingMore, error } = useCollection(collectionId, {
    filters,
    sort,
    limit,
    initialItems,
    initialHasNext,
  });
  const href =
    itemHref ??
    ((item: CmsItem) =>
      `/${collectionId}/${encodeURIComponent(text(fieldMap.slug ? item[fieldMap.slug] : "") || item._id)}`);

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {items === null ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="aspect-[4/3] animate-pulse rounded-lg bg-secondary" />
              <div className="mt-3 h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <CardComponent
                key={item._id}
                item={item}
                fieldMap={fieldMap}
                itemHref={href}
                LinkComponent={LinkComponent}
              />
            ))}
          </div>
          {hasNext && (
            <div className="mt-10 text-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={loadMore}
                className="rounded-lg border border-border px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
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
