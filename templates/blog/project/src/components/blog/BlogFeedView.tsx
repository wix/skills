// REFERENCE feed surface: taxonomy filter chips + post grid + load-more on the @theme tokens.
// Correct and complete; per the skill's model you design and build your own on useBlogFeed.
// What it gets right that yours must too: the empty state renders only when there is NO error; a
// byline, a counter, or a cover appears only when the DTO carries one; hrefs come from the path
// helpers (slugs may contain "/"); the cover's alt is the DTO's.
import type { ComponentType, ReactNode } from "react";
import { useBlogFeed } from "../../hooks/blog/useBlogFeed";
import { formatCount, postMetaLine, postPath } from "../../wix/blog/posts";
import type { BlogCategory, BlogTag, PostPage, PostSummary } from "../../wix/blog/types";

export interface LinkLikeProps {
  href: string;
  className?: string;
  children?: ReactNode;
  "aria-current"?: "page";
}

const PlainLink = ({ href, className, children, ...rest }: LinkLikeProps) => (
  <a href={href} className={className} {...rest}>
    {children}
  </a>
);

export interface PostCardProps {
  post: PostSummary;
  postHref?: (slug: string) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

/** "By <author> · 1.2K views · 3 comments" — only the parts the post carries. */
export function PostByline({ post }: { post: PostSummary }) {
  const parts = [
    post.authorName,
    post.viewCount !== undefined ? `${formatCount(post.viewCount)} views` : "",
    post.commentCount !== undefined ? `${formatCount(post.commentCount)} comments` : "",
    post.likeCount !== undefined ? `${formatCount(post.likeCount)} likes` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      {post.authorAvatarUrl && <img src={post.authorAvatarUrl} alt="" width={20} height={20} loading="lazy" className="h-5 w-5 rounded-full object-cover" />}
      <span>{parts.join(" · ")}</span>
    </p>
  );
}

export function PostCard({ post, postHref = postPath, LinkComponent = PlainLink }: PostCardProps) {
  return (
    <LinkComponent href={postHref(post.slug)} className="group block no-underline">
      {post.coverUrl && (
        <div className="aspect-[16/9] overflow-hidden rounded-lg bg-secondary">
          <img
            src={post.coverUrl}
            alt={post.coverAlt}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </div>
      )}
      <h3 className="mt-3 text-base font-semibold leading-snug text-foreground">{post.title}</h3>
      {post.excerpt && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        <time dateTime={post.dateISO}>{postMetaLine(post)}</time>
      </p>
      <PostByline post={post} />
    </LinkComponent>
  );
}

export interface BlogFeedViewProps {
  initialPage?: PostPage;
  /** The filter `initialPage` was fetched with (a category/tag page). */
  initialCategoryId?: string | null;
  initialTagId?: string | null;
  initialCategories?: BlogCategory[];
  initialTags?: BlogTag[];
  emptyMessage?: string;
  postHref?: PostCardProps["postHref"];
  /**
   * When given, category pills are LINKS to category pages (and "All" to `allHref`) instead of
   * client-side filters — the choice for a site with category pages, so every filter has a URL.
   */
  categoryHref?: (slug: string) => string;
  allHref?: string;
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<PostCardProps>;
}

const pill = (active: boolean) =>
  `rounded-control border px-4 py-1.5 text-sm font-medium no-underline transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

export default function BlogFeedView({
  initialPage,
  initialCategoryId,
  initialTagId,
  initialCategories,
  initialTags,
  emptyMessage = "No posts yet — check back soon.",
  postHref,
  categoryHref,
  allHref = "/blog",
  LinkComponent = PlainLink,
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
  } = useBlogFeed({ initialPage, initialCategoryId, initialTagId, initialCategories, initialTags });

  const visibleCategories = categories.filter((c) => c.postCount > 0);

  return (
    <div>
      {visibleCategories.length > 1 && (
        <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Categories">
          {categoryHref ? (
            <>
              <LinkComponent href={allHref} className={pill(activeCategoryId === null)} aria-current={activeCategoryId === null ? "page" : undefined}>
                All
              </LinkComponent>
              {visibleCategories.map((c) => (
                <LinkComponent key={c.id} href={categoryHref(c.slug)} className={pill(activeCategoryId === c.id)} aria-current={activeCategoryId === c.id ? "page" : undefined}>
                  {c.label}
                </LinkComponent>
              ))}
            </>
          ) : (
            <>
              <button type="button" className={pill(activeCategoryId === null)} onClick={() => setActiveCategoryId(null)}>
                All
              </button>
              {visibleCategories.map((c) => (
                <button key={c.id} type="button" className={pill(activeCategoryId === c.id)} onClick={() => setActiveCategoryId(c.id)}>
                  {c.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {error && (
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          The posts could not be loaded. {error}
        </p>
      )}
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
        // An empty list over a failed read is not an empty blog — the error above is the state then.
        !error && <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>
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
