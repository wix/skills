// REFERENCE post surface (SPA use — Astro renders the header statically and mounts only
// RichContent as an island). Correct and complete; per the skill's model you design and
// build your own on usePost. Chips display .label; the body renders ONLY via RichContent.
import type { ComponentType } from "react";
import { usePost } from "../../hooks/blog/usePost";
import type { BlogCategory, BlogTag, PostDetail } from "../../wix/blog/types";
import RichContent from "./RichContent";
import type { LinkLikeProps } from "./BlogFeedView";

export interface PostViewProps {
  slug: string;
  initialPost?: PostDetail;
  initialCategories?: BlogCategory[];
  initialTags?: BlogTag[];
  /** Where a chip routes; omit to render chips as plain labels. */
  categoryHref?: (slug: string) => string;
  tagHref?: (slug: string) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

const PlainLink = ({ href, className, children }: LinkLikeProps) => (
  <a href={href} className={className}>
    {children}
  </a>
);

const chipClass =
  "rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground no-underline";

export default function PostView({
  slug,
  initialPost,
  initialCategories,
  initialTags,
  categoryHref,
  tagHref,
  LinkComponent = PlainLink,
}: PostViewProps) {
  const { post, notFound, categories, tags, error } = usePost({
    slug,
    initialPost,
    initialCategories,
    initialTags,
  });

  if (notFound) {
    return (
      <div className="py-24 text-center">
        <p className="text-lg font-medium">Post not found</p>
        <p className="mt-2 text-sm text-muted-foreground">It may have been unpublished or moved.</p>
      </div>
    );
  }
  if (error) return <p className="py-8 text-sm text-red-600">{error}</p>;
  if (post === null) {
    return (
      <div aria-busy="true">
        <div className="h-8 w-2/3 animate-pulse rounded bg-secondary" />
        <div className="mt-6 aspect-[16/9] animate-pulse rounded-lg bg-secondary" />
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-3xl">
      {categories.length > 0 && (
        <p className="eyebrow">
          {categories.map((c, i) => (
            <span key={c.id}>
              {i > 0 && " · "}
              {categoryHref ? (
                <LinkComponent href={categoryHref(c.slug)} className="no-underline">
                  {c.label}
                </LinkComponent>
              ) : (
                c.label
              )}
            </span>
          ))}
        </p>
      )}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{post.title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {post.dateLabel && <time dateTime={post.dateISO}>{post.dateLabel}</time>}
        {post.dateLabel && post.minutesToRead > 0 ? " · " : ""}
        {post.minutesToRead > 0 ? `${post.minutesToRead} min read` : ""}
      </p>
      {post.coverUrl && (
        <div className="mt-6 aspect-[16/9] overflow-hidden rounded-xl bg-secondary">
          <img src={post.coverUrl} alt={post.title} className="h-full w-full object-cover" />
        </div>
      )}
      <div className="mt-8">
        <RichContent content={post.richContent} fallbackParagraphs={post.paragraphs} />
      </div>
      {tags.length > 0 && (
        <div className="mt-10 flex flex-wrap gap-2">
          {tags.map((t) =>
            tagHref ? (
              <LinkComponent key={t.id} href={tagHref(t.slug)} className={chipClass}>
                {t.label}
              </LinkComponent>
            ) : (
              <span key={t.id} className={chipClass}>
                {t.label}
              </span>
            ),
          )}
        </div>
      )}
    </article>
  );
}
