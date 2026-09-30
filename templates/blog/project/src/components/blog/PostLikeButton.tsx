// REFERENCE like control + counters — the post page's engagement row. On Astro this is the island
// the statically rendered header mounts (`client:load`): it re-creates the post store from the
// server-fetched post and reads only the viewer's like state (personal, client-only), so nothing
// else is fetched twice. In a SPA, PostView renders the same row from its own usePost.
import { usePost } from "../../hooks/blog/usePost";
import { formatCount } from "../../wix/blog/posts";
import type { PostDetail } from "../../wix/blog/types";

export interface PostLikeButtonProps {
  /** The server-fetched post (SSR) — the store starts from it and skips every read but the like state. */
  post: PostDetail;
}

/** The row itself, for a surface that already holds a usePost result. */
export function EngagementRow({
  isLiked,
  likeCount,
  likeCountLoaded,
  viewCount,
  commentCount,
  liking,
  toggleLike,
}: {
  isLiked: boolean;
  likeCount: number | undefined;
  likeCountLoaded: boolean;
  viewCount: number | undefined;
  commentCount: number | undefined;
  liking: boolean;
  toggleLike: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
      {viewCount !== undefined && <span>{formatCount(viewCount)} views</span>}
      {commentCount !== undefined && <span>{formatCount(commentCount)} comments</span>}
      <button
        type="button"
        onClick={toggleLike}
        disabled={liking}
        aria-pressed={isLiked}
        className={`ml-auto inline-flex items-center gap-1.5 rounded-control border px-3 py-1 transition-colors disabled:opacity-50 ${
          isLiked ? "border-primary text-primary" : "border-border text-foreground hover:bg-secondary"
        }`}
      >
        <span aria-hidden="true">{isLiked ? "♥" : "♡"}</span>
        <span>{isLiked ? "Liked" : "Like"}</span>
        {/* The count waits for the fresh read; a skeleton beats a stale number that jumps. */}
        {likeCountLoaded || likeCount !== undefined ? (
          likeCount !== undefined && <span className="tabular-nums">{formatCount(likeCount)}</span>
        ) : (
          <span className="inline-block h-3 w-5 animate-pulse rounded bg-secondary" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export default function PostLikeButton({ post }: PostLikeButtonProps) {
  // Seeded with everything the page already rendered, so start() reads only the viewer's like state.
  const state = usePost({ slug: post.slug, initialPost: post, initialCategories: [], initialTags: [], initialRelated: [] });
  return <EngagementRow {...state} />;
}
