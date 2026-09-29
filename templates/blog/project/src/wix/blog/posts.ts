// Post reads (Wix Blog V3) over the SDK — the only file that touches raw post entities on this
// transport. Everything it returns is a plain DTO from ./types. The rules and mappers live in
// ./posts-core (shared with the REST twin in templates/blog/rest/); this file is the transport
// only. Copy as-is; extend by adding functions, not by editing these. Blog posts are NOT CMS
// collections — always @wix/blog, never @wix/data.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-post-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-post-metrics.md
import { posts as postsModule } from "@wix/blog";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { fetchAuthorsByIds } from "./authors";
import {
  BLOG_APP_ID,
  CARD_FIELDSETS,
  DETAIL_FIELDSETS,
  RELATED_LIMIT,
  categoryPath,
  formatCount,
  isNotFound,
  pickCurated,
  postMetaLine,
  postPath,
  relativeDateLabel,
  tagPath,
  toDetail,
  toMetrics,
  toSummary,
  withAuthors,
  type FetchPostsOptions,
  type Raw,
} from "./posts-core";
import type { PostDetail, PostMetrics, PostPage, PostSummary } from "./types";

export { BLOG_APP_ID, categoryPath, formatCount, postMetaLine, postPath, relativeDateLabel, tagPath, type FetchPostsOptions };

const posts = wixModule(postsModule);

// Cards carry METRICS (view/like/comment counts); the fieldsets option rides outside the query.
const cardQuery = () => posts.queryPosts({ fieldsets: [...CARD_FIELDSETS] as any });

// The authors of one page in one batched read, joined onto the DTOs; a failed read leaves "" (no byline).
async function withPageAuthors<T extends PostSummary>(items: T[]): Promise<T[]> {
  return withAuthors(items, await fetchAuthorsByIds(items.map((p) => p.authorId)));
}

/**
 * One page of published posts: pinned first, then newest first. Only published posts come back
 * to a visitor token — a "missing" post usually wasn't published, not a query bug. The builder
 * below spells posts-core's feedQuery: sort + filters on the first page, the cursor alone after.
 */
export async function fetchPosts({ limit = 20, cursor, categoryId, tagId }: FetchPostsOptions = {}): Promise<PostPage> {
  let q = cardQuery().limit(limit);
  if (cursor) {
    // A cursor encodes the original filter+sort — re-sending them alongside it is rejected.
    q = q.skipTo(cursor);
  } else {
    // queryPosts with an explicit sort does not pin on its own — the pinned key comes first.
    q = q.descending("pinned").descending("firstPublishedDate");
    if (categoryId) q = q.hasSome("categoryIds", [categoryId]);
    if (tagId) q = q.hasSome("tagIds", [tagId]);
  }
  const res = await q.find();
  return {
    posts: await withPageAuthors((res.items ?? []).map((p: Raw) => toSummary(p, imgSrc))),
    nextCursor: res.hasNext() ? (res.cursors?.next ?? null) : null,
  };
}

/**
 * One post by its URL slug with the full body and SEO/comments fields (RICH_CONTENT, CONTENT_TEXT,
 * SEO, REFERENCE_ID, INTERNAL_ID — without them those fields come back undefined; INTERNAL_ID is the
 * one that actually carries referenceId). Null when the slug resolves
 * to nothing (404 / NOT_FOUND is an expected miss); any other failure throws. The dedicated
 * by-slug read, not a slug query: slugs are per translation, so a slug-only query is ambiguous on
 * a multilingual site.
 */
export async function fetchPostBySlug(slug: string): Promise<PostDetail | null> {
  let raw: Raw | undefined;
  try {
    raw = (await posts.getPostBySlug(slug, { fieldsets: [...DETAIL_FIELDSETS] as any })).post as Raw | undefined;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  if (!raw) return null;
  const [detail] = await withPageAuthors([toDetail(raw, imgSrc)]);
  return detail;
}

/** Posts by id, as cards (order is the API's — callers restore their own). Non-fatal: [] on failure. */
export async function fetchPostsByIds(ids: string[]): Promise<PostSummary[]> {
  if (!ids.length) return [];
  try {
    const res = await cardQuery().in("_id", ids).limit(ids.length).find();
    return withPageAuthors((res.items ?? []).map((p: Raw) => toSummary(p, imgSrc)));
  } catch {
    return [];
  }
}

/**
 * The post page's related strip: the writer's curated `relatedPostIds` (their order, the current
 * post dropped) when at least one still resolves; else the newest posts sharing a category with this
 * one (site-wide recents when it has none). Strictly either/or — never topped up. Non-fatal: [].
 */
export async function fetchRelatedPosts(post: Pick<PostDetail, "id" | "categoryIds" | "relatedPostIds">, limit = RELATED_LIMIT): Promise<PostSummary[]> {
  try {
    if (post.relatedPostIds.length) {
      const curated = pickCurated(post.relatedPostIds, await fetchPostsByIds(post.relatedPostIds), post.id, limit);
      if (curated.length) return curated;
    }
    let q = cardQuery().ne("_id", post.id).descending("firstPublishedDate").limit(limit);
    if (post.categoryIds.length) q = q.hasSome("categoryIds", post.categoryIds);
    const res = await q.find();
    return withPageAuthors((res.items ?? []).map((p: Raw) => toSummary(p, imgSrc)));
  } catch {
    return [];
  }
}

/**
 * The post's fresh counters — the API's designated source (the `metrics` field on a post is
 * deprecated as potentially inconsistent). Null on failure: keep the count you had.
 */
export async function fetchPostMetrics(postId: string): Promise<PostMetrics | null> {
  try {
    return toMetrics((await posts.getPostMetrics(postId)).metrics as Raw | undefined);
  } catch {
    return null;
  }
}
