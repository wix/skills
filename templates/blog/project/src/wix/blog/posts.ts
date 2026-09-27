// Post reads (Wix Blog V3) over the SDK — the only file that touches raw post entities on this
// transport. Everything it returns is a plain DTO from ./types. The rules and mappers live in
// ./posts-core (shared with the REST twin in references/blog/rest/); this file is the transport
// only. Copy as-is; extend by adding functions, not by editing these. Blog posts are NOT CMS
// collections — always @wix/blog, never @wix/data.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-post-by-slug.md
import { posts as postsModule } from "@wix/blog";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { BLOG_APP_ID, DETAIL_FIELDSETS, postMetaLine, toDetail, toSummary, type FetchPostsOptions, type Raw } from "./posts-core";
import type { PostDetail, PostPage } from "./types";

export { BLOG_APP_ID, postMetaLine, type FetchPostsOptions };

const posts = wixModule(postsModule);

/**
 * One page of published posts, newest first (pinned posts lead). Only published posts come
 * back to a visitor token — a "missing" post usually wasn't published, not a query bug.
 * The builder below spells posts-core's feedQuery: sort + filters on the first page, the cursor alone after.
 */
export async function fetchPosts({ limit = 20, cursor, categoryId, tagId }: FetchPostsOptions = {}): Promise<PostPage> {
  let q = posts.queryPosts().limit(limit);
  if (cursor) {
    // A cursor encodes the original filter+sort — re-sending them alongside it is rejected.
    q = q.skipTo(cursor);
  } else {
    q = q.descending("firstPublishedDate");
    if (categoryId) q = q.hasSome("categoryIds", [categoryId]);
    if (tagId) q = q.hasSome("tagIds", [tagId]);
  }
  const res = await q.find();
  return {
    posts: (res.items ?? []).map((p: Raw) => toSummary(p, imgSrc)),
    nextCursor: res.hasNext() ? (res.cursors?.next ?? null) : null,
  };
}

/**
 * Fetch one post by its URL slug with the full body (RICH_CONTENT + CONTENT_TEXT fieldsets —
 * without them the body fields come back undefined). Null when not found.
 */
export async function fetchPostBySlug(slug: string): Promise<PostDetail | null> {
  const res = await posts
    .queryPosts({ fieldsets: [...DETAIL_FIELDSETS] as any })
    .eq("slug", slug)
    .limit(1)
    .find();
  const raw = res.items?.[0];
  return raw ? toDetail(raw as Raw, imgSrc) : null;
}
