// Category + tag reads over REST — the twin of app/wix/blog/taxonomy.ts. Same exports, same DTOs;
// the mappers come from taxonomy-core (the SAME file the SDK transport uses, deployed flat next to
// this one). Taxonomy queries page by OFFSET (`paging`), unlike posts (`cursorPaging`); a blog's
// taxonomy fits in one read of 100. All calls are visitor-safe.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/query-categories.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/get-category-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/query-tags.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/get-tag-by-slug.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { TAG_SORT, TAXONOMY_LIMIT, categoriesQuery, inIdOrder, tagsByIdsQuery, toCategory, toTag, type FetchCategoriesOptions } from "./taxonomy-core.js";
import type { Raw } from "./posts-core.js";
import type { BlogCategory, BlogTag } from "./types.js";

export { inIdOrder, type FetchCategoriesOptions };

/**
 * Categories in menu order; `withPosts` drops empty ones at the source. Non-fatal: [] on failure
 * (the feed renders without its filter row).
 * POST /blog/v3/categories/query  { query: { filter?: { postCount: { $gt: 0 } }, sort: [{ fieldName: "displayPosition", order: "ASC" }], paging: { limit: 100 } } }
 */
export async function fetchBlogCategories(o: FetchCategoriesOptions = {}): Promise<BlogCategory[]> {
  try {
    const res = await wixRequest<Raw>("/blog/v3/categories/query", { body: { query: categoriesQuery(o) } });
    return ((res?.categories ?? []) as Raw[]).map((c) => toCategory(c, imgSrc)).filter((c) => c.id);
  } catch {
    return [];
  }
}

/**
 * Tags, most-published-posts first — a tag cloud. Non-fatal: [] on failure.
 * POST /blog/v3/tags/query  { query: { sort: [{ fieldName: "publishedPostCount", order: "DESC" }], paging: { limit: 100 } } }
 */
export async function fetchBlogTags(): Promise<BlogTag[]> {
  try {
    const res = await wixRequest<Raw>("/blog/v3/tags/query", { body: { query: { sort: TAG_SORT, paging: { limit: TAXONOMY_LIMIT } } } });
    return ((res?.tags ?? []) as Raw[]).map(toTag).filter((t) => t.id);
  } catch {
    return [];
  }
}

/**
 * A post's tags by id, in the post's own order. Non-fatal: [] on failure.
 * POST /blog/v3/tags/query  { query: { filter: { id: { $in: ids } }, paging: { limit: 30 } } }
 */
export async function fetchTagsByIds(ids: readonly string[]): Promise<BlogTag[]> {
  if (!ids.length) return [];
  try {
    const res = await wixRequest<Raw>("/blog/v3/tags/query", { body: { query: tagsByIdsQuery([...ids]) } });
    return inIdOrder(ids, ((res?.tags ?? []) as Raw[]).map(toTag).filter((t) => t.id));
  } catch {
    return [];
  }
}

// The two by-slug getters answer in DIFFERENT envelopes ({ category } and { tag }); a missing slug
// is a 404 — mapped to null here, as the SDK transport does.

/** One category by its URL slug. Null when not found.  GET /blog/v3/categories/slugs/{slug} */
export async function fetchCategoryBySlug(slug: string): Promise<BlogCategory | null> {
  try {
    const res = await wixRequest<Raw>(`/blog/v3/categories/slugs/${encodeURIComponent(slug)}`, { method: "GET" });
    return res?.category ? toCategory(res.category, imgSrc) : null;
  } catch {
    return null;
  }
}

/** One tag by its URL slug. Null when not found.  GET /blog/v3/tags/slugs/{slug} */
export async function fetchTagBySlug(slug: string): Promise<BlogTag | null> {
  try {
    const res = await wixRequest<Raw>(`/blog/v3/tags/slugs/${encodeURIComponent(slug)}`, { method: "GET" });
    return res?.tag ? toTag(res.tag) : null;
  } catch {
    return null;
  }
}
