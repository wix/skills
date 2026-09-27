// Category + tag reads over REST — the twin of app/wix/blog/taxonomy.ts. Same exports, same DTOs;
// the mappers come from taxonomy-core (the SAME file the SDK transport uses, deployed flat next to
// this one). Taxonomy queries page by OFFSET (`paging`), unlike posts (`cursorPaging`); a blog's
// taxonomy fits in one read of 100. All four calls are visitor-safe.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/query-categories.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/get-category-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/query-tags.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/get-tag-by-slug.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { CATEGORY_SORT, TAG_SORT, TAXONOMY_LIMIT, toCategory, toTag } from "./taxonomy-core.js";
import type { Raw } from "./posts-core.js";
import type { BlogCategory, BlogTag } from "./types.js";

/**
 * Categories in menu order. Non-fatal: [] on failure (the feed renders without its filter row).
 * POST /blog/v3/categories/query  { query: { sort: [{ fieldName: "displayPosition", order: "ASC" }], paging: { limit: 100 } } }
 */
export async function fetchBlogCategories(): Promise<BlogCategory[]> {
  try {
    const res = await wixRequest<Raw>("/blog/v3/categories/query", { body: { query: { sort: CATEGORY_SORT, paging: { limit: TAXONOMY_LIMIT } } } });
    return ((res?.categories ?? []) as Raw[]).map((c) => toCategory(c, imgSrc)).filter((c) => c.id);
  } catch {
    return [];
  }
}

/**
 * Tags, most-published-posts first. Non-fatal: [] on failure.
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
