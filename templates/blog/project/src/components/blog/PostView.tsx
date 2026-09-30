// REFERENCE post surface (SPA use — Astro renders the header statically and mounts RichContent,
// PostLikeButton, and CommentsView as islands). Correct and complete; per the skill's model you
// design and build your own on usePost. Chips display .label in the post's order; the body renders
// ONLY via RichContent; the byline, counters, related strip, and comments appear only when the
// DTO carries them.
import type { ComponentType } from "react";
import { usePost } from "../../hooks/blog/usePost";
import { categoryPath, postMetaLine, postPath, tagPath } from "../../wix/blog/posts";
import type { BlogCategory, BlogTag, PostDetail, PostSummary } from "../../wix/blog/types";
import RichContent from "./RichContent";
import CommentsView from "./CommentsView";
import { EngagementRow } from "./PostLikeButton";
import { PostCard, type LinkLikeProps } from "./BlogFeedView";

export interface PostViewProps {
  slug: string;
  initialPost?: PostDetail;
  initialCategories?: BlogCategory[];
  initialTags?: BlogTag[];
  initialRelated?: PostSummary[];
  /** Where a chip routes (defaults to the category/tag pages). */
  categoryHref?: (slug: string) => string;
  tagHref?: (slug: string) => string;
  postHref?: (slug: string) => string;
  /** Where "sign in" points when a guest's comment is refused. */
  signInHref?: string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

const PlainLink = ({ href, className, children }: LinkLikeProps) => (
  <a href={href} className={className}>
    {children}
  </a>
);

const chipClass = "rounded-control border border-border px-3 py-1 text-xs font-medium text-muted-foreground no-underline";

export default function PostView({
  slug,
  initialPost,
  initialCategories,
  initialTags,
  initialRelated,
  categoryHref = categoryPath,
  tagHref = tagPath,
  postHref = postPath,
  signInHref,
  LinkComponent = PlainLink,
}: PostViewProps) {
  const { post, notFound, categories, tags, related, error, ...engagement } = usePost({
    slug,
    initialPost,
    initialCategories,
    initialTags,
    initialRelated,
  });

  if (notFound) {
    return (
      <div className="py-24 text-center">
        <p className="text-lg font-medium">Post not found</p>
        <p className="mt-2 text-sm text-muted-foreground">It may have been unpublished or moved.</p>
      </div>
    );
  }
  if (error) return <p className="py-8 text-sm text-destructive">{error}</p>;
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
              <LinkComponent href={categoryHref(c.slug)} className="no-underline">
                {c.label}
              </LinkComponent>
            </span>
          ))}
        </p>
      )}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{post.title}</h1>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {post.authorAvatarUrl && <img src={post.authorAvatarUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-full object-cover" />}
        {post.authorName && <span>{post.authorName}</span>}
        {post.authorName && postMetaLine(post) && <span aria-hidden="true">·</span>}
        <time dateTime={post.dateISO}>{postMetaLine(post)}</time>
        {post.updatedLabel && post.updatedISO !== post.dateISO && (
          <span>
            · Updated <time dateTime={post.updatedISO}>{post.updatedLabel}</time>
          </span>
        )}
      </p>
      {post.coverUrl && (
        <div className="mt-6 aspect-[16/9] overflow-hidden rounded-xl bg-secondary">
          <img src={post.coverUrl} alt={post.coverAlt} className="h-full w-full object-cover" />
        </div>
      )}
      <div className="mt-8">
        <RichContent content={post.richContent} fallbackParagraphs={post.paragraphs} />
      </div>
      <div className="mt-8 border-t border-border pt-4">
        <EngagementRow {...engagement} />
      </div>
      {tags.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {tags.map((t) => (
            <LinkComponent key={t.id} href={tagHref(t.slug)} className={chipClass}>
              {t.label}
            </LinkComponent>
          ))}
        </div>
      )}
      {related && related.length > 0 && (
        <aside className="mt-14">
          <h2 className="mb-6 text-lg font-semibold">Related posts</h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {related.map((p) => (
              <PostCard key={p.id} post={p} postHref={postHref} LinkComponent={LinkComponent} />
            ))}
          </div>
        </aside>
      )}
      {post.commentingEnabled && post.referenceId && (
        <div className="mt-14">
          <CommentsView referenceId={post.referenceId} signInHref={signInHref} />
        </div>
      )}
    </article>
  );
}
