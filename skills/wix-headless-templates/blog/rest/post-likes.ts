// Post likes over REST — the twin of app/wix/blog/post-likes.ts. Same exports, same DTOs; the FQDN,
// query, and body come from posts-core. Every call runs as the calling identity (member or the
// anonymous visitor the token stands for), so all three are CLIENT-ONLY — in a port, never from a
// process-wide token. Porting: keep the paths, keep the bodies.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/likes/create-like.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/likes/query-likes.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/likes/delete-like-by-fqdn-and-entity-id.md
import { wixRequest } from "./client.js";
import { fetchPostMetrics } from "./posts.js";
import { BLOG_POST_FQDN, likeBody, likeStateQuery, type Raw } from "./posts-core.js";
import type { LikeState } from "./types.js";

/** Like the post as the current viewer.  POST /blog/v1/likes  { like: { entityId, fqdn: "wix.blog.v3.post" } } */
export async function likePost(postId: string): Promise<void> {
  await wixRequest("/blog/v1/likes", { body: likeBody(postId) });
}

/** Remove the current viewer's like.  DELETE /blog/v1/likes/fqdn/{fqdn}/entity-id/{entityId} */
export async function unlikePost(postId: string): Promise<void> {
  await wixRequest(`/blog/v1/likes/fqdn/${encodeURIComponent(BLOG_POST_FQDN)}/entity-id/${encodeURIComponent(postId)}`, { method: "DELETE" });
}

/**
 * Whether THIS viewer liked the post (one row = yes; the service scopes the query to the caller),
 * plus the fresh counters — two independent reads (allSettled).
 * POST /blog/v1/likes/query  { query: { filter: { fqdn: { $eq }, entityId: { $eq } }, cursorPaging: { limit: 1 } } }
 */
export async function fetchLikeState(postId: string): Promise<LikeState> {
  const [likeRes, metrics] = await Promise.allSettled([
    wixRequest<Raw>("/blog/v1/likes/query", { body: { query: likeStateQuery(postId) } }),
    fetchPostMetrics(postId),
  ]);
  return {
    liked: likeRes.status === "fulfilled" && ((likeRes.value?.likes ?? []) as Raw[]).length > 0,
    metrics: metrics.status === "fulfilled" ? metrics.value : null,
  };
}
