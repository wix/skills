// Post likes (Wix Blog Like service) over the SDK — the `likes` module of @wix/blog. Every call
// here runs as the CALLING identity: a member, or the anonymous visitor the token stands for. The
// like read is personal ("did I like it?") and the writes are the viewer's, so all three are
// CLIENT-ONLY — the post store runs them only in a browser, never during SSR (where the identity
// is the app and the read answers PermissionDenied). The rules (FQDN, query, body) live in
// ./posts-core, shared with the REST twin in templates/blog/rest/post-likes.ts.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/likes/create-like.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/likes/query-likes.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/likes/delete-like-by-fqdn-and-entity-id.md
import { likes as likesModule } from "@wix/blog";
import { wixModule } from "../sdk";
import { fetchPostMetrics } from "./posts";
import { BLOG_POST_FQDN } from "./posts-core";
import type { LikeState } from "./types";

const likes = wixModule(likesModule);

/** Like the post as the current viewer. Throws on failure — the store rolls its optimistic flip back. */
export async function likePost(postId: string): Promise<void> {
  await likes.createLike({ like: { entityId: postId, fqdn: BLOG_POST_FQDN } });
}

/** Remove the current viewer's like. */
export async function unlikePost(postId: string): Promise<void> {
  await likes.deleteLikeByFqdnAndEntityId({ fqdn: BLOG_POST_FQDN, entityId: postId });
}

/**
 * Whether THIS viewer liked the post, plus the post's fresh counters — two independent reads
 * (allSettled): a failed metrics read still delivers the liked flag and vice versa. The like
 * read is `limit(1)`: the only question is whether this viewer's row exists.
 */
export async function fetchLikeState(postId: string): Promise<LikeState> {
  const [likeRes, metrics] = await Promise.allSettled([
    likes.queryLikes().eq("fqdn", BLOG_POST_FQDN).eq("entityId", postId).limit(1).find(),
    fetchPostMetrics(postId),
  ]);
  return {
    liked: likeRes.status === "fulfilled" && (likeRes.value.items ?? []).length > 0,
    metrics: metrics.status === "fulfilled" ? metrics.value : null,
  };
}
