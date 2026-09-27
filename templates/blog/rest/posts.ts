// Post reads over REST — the twin of app/wix/blog/posts.ts. Same exports, same DTOs; the rules and
// mappers come from posts-core (the SAME file the SDK transport uses, deployed flat next to this one
// by deploy.mjs --stack static), so this file is only the transport: one fetch with a literal body
// per function. Every call here is safe from a browser with a visitor token — only PUBLISHED posts
// come back to it. Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-post-by-slug.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { BLOG_APP_ID, DETAIL_FIELDSETS, feedQuery, postMetaLine, slugQuery, toDetail, toSummary, type FetchPostsOptions, type Raw } from "./posts-core.js";
import type { PostDetail, PostPage } from "./types.js";

export { BLOG_APP_ID, postMetaLine, type FetchPostsOptions };

const POSTS_QUERY = "/blog/v3/posts/query";

/**
 * One page of published posts, newest first (pinned posts lead); `nextCursor` continues the same
 * query — send it alone, the filters ride inside it.
 * POST /blog/v3/posts/query  { query: { filter?, sort, cursorPaging: { limit } } }   — first page
 * POST /blog/v3/posts/query  { query: { cursorPaging: { limit, cursor } } }            — later pages
 */
export async function fetchPosts(o: FetchPostsOptions = {}): Promise<PostPage> {
  const res = await wixRequest<Raw>(POSTS_QUERY, { body: { query: feedQuery(o) } });
  const paging: Raw = res?.pagingMetadata ?? {};
  return {
    posts: ((res?.posts ?? []) as Raw[]).map((p) => toSummary(p, imgSrc)),
    nextCursor: paging.hasNext ? (paging.cursors?.next ?? null) : null,
  };
}

/**
 * One post by URL slug with the full body (the RICH_CONTENT + CONTENT_TEXT fieldsets — without
 * them richContent and contentText are absent). Null when the slug resolves to nothing — a real
 * 404 for the page, never a fallback to another post.
 * POST /blog/v3/posts/query  { fieldsets: ["RICH_CONTENT", "CONTENT_TEXT"], query: { filter: { slug: { $eq } }, cursorPaging: { limit: 1 } } }
 */
export async function fetchPostBySlug(slug: string): Promise<PostDetail | null> {
  const res = await wixRequest<Raw>(POSTS_QUERY, { body: { fieldsets: DETAIL_FIELDSETS, query: slugQuery(slug) } });
  const raw: Raw | undefined = res?.posts?.[0];
  return raw ? toDetail(raw, imgSrc) : null;
}
