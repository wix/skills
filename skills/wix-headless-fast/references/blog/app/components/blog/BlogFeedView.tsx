// REFERENCE feed surface: taxonomy filter chips + post grid + load-more on the @theme tokens.
// Correct and complete; per the skill's model you design and build your own on useBlogFeed.
import type { ComponentType, ReactNode } from "react";
import { useBlogFeed } from "../../hooks/blog/useBlogFeed";
import type { BlogCategory, BlogTag, PostPage, PostSummary } from "../../wix/blog/types";

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

export interface PostCardProps {
  post: PostSummary;
  postHref?: (slug: string) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

export function PostCard({ post, postHref = (slug) => `/blog/${slug}`, LinkComponent = PlainLink }: PostCardProps) {
  return (
    <LinkComponent href={postHref(post.slug)} className="group block no-underline">
      {post.coverUrl && (
        <div className="aspect-[16/9] overflow-hidden rounded-lg bg-secondary">
          <img
            src={post.coverUrl}
            alt={post.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </div>
      )}
      <h3 className="mt-3 text-base font-semibold leading-snug text-foreground">{post.title}</h3>
      {post.excerpt && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        {post.dateLabel && <time dateTime={post.dateISO}>{post.dateLabel}</time>}
        {post.dateLabel && post.minutesToRead > 0 ? " · " : ""}
        {post.minutesToRead > 0 ? `${post.minutesToRead} min read` : ""}
      </p>
    </LinkComponent>
  );
}

export interface BlogFeedViewProps {
  initialPage?: PostPage;
  initialCategories?: BlogCategory[];
  initialTags?: BlogTag[];
  emptyMessage?: string;
  postHref?: PostCardProps["postHref"];
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<PostCardProps>;
}

const pill = (active: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

export default function BlogFeedView({
  initialPage,
  initialCategories,
  initialTags,
  emptyMessage = "No posts yet — check back soon.",
  postHref,
  LinkComponent,
  CardComponent = PostCard,
}: BlogFeedViewProps) {
  const {
    posts,
    categories,
    activeCategoryId,
    setActiveCategoryId,
    hasMore,
    loadMore,
    loadingMore,
    error,
  } = useBlogFeed({ initialPage, initialCategories, initialTags });

  const visibleCategories = categories.filter((c) => c.postCount > 0);

  return (
    <div>
      {visibleCategories.length > 1 && (
        <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Categories">
          <button type="button" className={pill(activeCategoryId === null)} onClick={() => setActiveCategoryId(null)}>
            All
          </button>
          {visibleCategories.map((c) => (
            <button key={c.id} type="button" className={pill(activeCategoryId === c.id)} onClick={() => setActiveCategoryId(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {posts === null ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="aspect-[16/9] animate-pulse rounded-lg bg-secondary" />
              <div className="mt-3 h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <CardComponent key={p.id} post={p} postHref={postHref} LinkComponent={LinkComponent} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-10 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-border px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
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
