// Post reads over REST — the twin of app/wix/blog/posts.ts. Same exports, same DTOs; the rules and
// mappers come from posts-core (the SAME file the SDK transport uses, deployed flat next to this one
// by deploy.mjs --stack static), so this file is only the transport: one fetch with a literal body
// per function. Every call here is safe from a browser with a visitor token — only PUBLISHED posts
// come back to it. Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-post-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-post-metrics.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { fetchAuthorsByIds } from "./authors.js";
import {
  BLOG_APP_ID,
  CARD_FIELDSETS,
  DETAIL_FIELDSETS,
  RELATED_LIMIT,
  byIdsQuery,
  categoryPath,
  feedQuery,
  formatCount,
  isNotFound,
  pickCurated,
  postMetaLine,
  postPath,
  recentRelatedQuery,
  relativeDateLabel,
  tagPath,
  toDetail,
  toMetrics,
  toSummary,
  withAuthors,
  type FetchPostsOptions,
  type Raw,
} from "./posts-core.js";
import type { PostDetail, PostMetrics, PostPage, PostSummary } from "./types.js";

export { BLOG_APP_ID, categoryPath, formatCount, postMetaLine, postPath, relativeDateLabel, tagPath, type FetchPostsOptions };

const POSTS_QUERY = "/blog/v3/posts/query";

// The authors of one page in one batched read, joined onto the DTOs; a failed read leaves "" (no byline).
async function withPageAuthors<T extends PostSummary>(items: T[]): Promise<T[]> {
  return withAuthors(items, await fetchAuthorsByIds(items.map((p) => p.authorId)));
}

/**
 * One page of published posts, pinned first then newest first; `nextCursor` continues the same
 * query — send it alone, the filters ride inside it. Cards carry METRICS (counts).
 * POST /blog/v3/posts/query  { fieldsets: ["METRICS"], query: { filter?, sort, cursorPaging: { limit } } }   — first page
 * POST /blog/v3/posts/query  { fieldsets: ["METRICS"], query: { cursorPaging: { limit, cursor } } }            — later pages
 */
export async function fetchPosts(o: FetchPostsOptions = {}): Promise<PostPage> {
  const res = await wixRequest<Raw>(POSTS_QUERY, { body: { fieldsets: CARD_FIELDSETS, query: feedQuery(o) } });
  const paging: Raw = res?.pagingMetadata ?? {};
  return {
    posts: await withPageAuthors(((res?.posts ?? []) as Raw[]).map((p) => toSummary(p, imgSrc))),
    nextCursor: paging.hasNext ? (paging.cursors?.next ?? null) : null,
  };
}

/**
 * One post by URL slug with the full body and SEO/comments fields. Null when the slug resolves to
 * nothing (a 404 from this read) — a real 404 for the page, never a fallback to another post; any
 * other failure throws.
 * GET /blog/v3/posts/slugs/{slug}?fieldsets=RICH_CONTENT&fieldsets=CONTENT_TEXT&fieldsets=SEO&fieldsets=REFERENCE_ID&fieldsets=INTERNAL_ID
 * (INTERNAL_ID is the fieldset that carries referenceId; REFERENCE_ID alone returns the post without it)
 */
export async function fetchPostBySlug(slug: string): Promise<PostDetail | null> {
  let raw: Raw | undefined;
  try {
    raw = (await wixRequest<Raw>(`/blog/v3/posts/slugs/${encodeURIComponent(slug)}`, { method: "GET", query: { fieldsets: DETAIL_FIELDSETS } }))?.post;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  if (!raw) return null;
  const [detail] = await withPageAuthors([toDetail(raw, imgSrc)]);
  return detail;
}

/**
 * Posts by id, as cards (order is the API's — callers restore their own). Non-fatal: [] on failure.
 * POST /blog/v3/posts/query  { fieldsets: ["METRICS"], query: { filter: { id: { $in } }, cursorPaging: { limit } } }
 */
export async function fetchPostsByIds(ids: string[]): Promise<PostSummary[]> {
  if (!ids.length) return [];
  try {
    const res = await wixRequest<Raw>(POSTS_QUERY, { body: { fieldsets: CARD_FIELDSETS, query: byIdsQuery(ids) } });
    return withPageAuthors(((res?.posts ?? []) as Raw[]).map((p) => toSummary(p, imgSrc)));
  } catch {
    return [];
  }
}

/**
 * The post page's related strip: curated `relatedPostIds` (writer order) when at least one still
 * resolves, else the newest posts sharing a category, the current post excluded. Never topped up.
 * POST /blog/v3/posts/query  { fieldsets: ["METRICS"], query: { filter: { id: { $ne }, categoryIds?: { $hasSome } }, sort, cursorPaging: { limit: 3 } } }
 */
export async function fetchRelatedPosts(post: Pick<PostDetail, "id" | "categoryIds" | "relatedPostIds">, limit = RELATED_LIMIT): Promise<PostSummary[]> {
  try {
    if (post.relatedPostIds.length) {
      const curated = pickCurated(post.relatedPostIds, await fetchPostsByIds(post.relatedPostIds), post.id, limit);
      if (curated.length) return curated;
    }
    const res = await wixRequest<Raw>(POSTS_QUERY, { body: { fieldsets: CARD_FIELDSETS, query: recentRelatedQuery(post, limit) } });
    return withPageAuthors(((res?.posts ?? []) as Raw[]).map((p) => toSummary(p, imgSrc)));
  } catch {
    return [];
  }
}

/**
 * The post's fresh counters. Null on failure: keep the count you had.
 * GET /blog/v3/posts/{postId}/metrics  → { metrics: { views, likes, comments } }
 */
export async function fetchPostMetrics(postId: string): Promise<PostMetrics | null> {
  try {
    return toMetrics((await wixRequest<Raw>(`/blog/v3/posts/${encodeURIComponent(postId)}/metrics`, { method: "GET" }))?.metrics);
  } catch {
    return null;
  }
}
