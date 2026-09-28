// Category + tag reads (Wix Blog V3) over the SDK — the only file that touches raw taxonomy
// entities on this transport. Everything it returns is a plain DTO from ./types. The mappers live
// in ./taxonomy-core (shared with the REST twin in templates/blog/rest/); this file is the
// transport only. Copy as-is; extend by adding functions.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/query-categories.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/get-category-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/query-tags.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/get-tag-by-slug.md
import { categories as categoriesModule, tags as tagsModule } from "@wix/blog";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { TAG_BY_IDS_LIMIT, TAXONOMY_LIMIT, inIdOrder, toCategory, toTag, type FetchCategoriesOptions } from "./taxonomy-core";
import type { Raw } from "./posts-core";
import type { BlogCategory, BlogTag } from "./types";

export { inIdOrder, type FetchCategoriesOptions };

const categories = wixModule(categoriesModule);
const tags = wixModule(tagsModule);

/** Categories in menu order (displayPosition); `withPosts` drops empty ones at the source — non-fatal (empty array on failure). */
export async function fetchBlogCategories({ withPosts = false }: FetchCategoriesOptions = {}): Promise<BlogCategory[]> {
  try {
    let q = categories.queryCategories().ascending("displayPosition").limit(TAXONOMY_LIMIT);
    if (withPosts) q = q.gt("postCount", 0);
    const res = await q.find();
    return (res.items ?? []).map((c: Raw) => toCategory(c, imgSrc)).filter((c) => c.id);
  } catch {
    return [];
  }
}

/** Tags, most-published-posts first — a tag cloud; non-fatal (empty array on failure). */
export async function fetchBlogTags(): Promise<BlogTag[]> {
  try {
    const res = await tags.queryTags().descending("publishedPostCount").limit(TAXONOMY_LIMIT).find();
    return (res.items ?? []).map((t: Raw) => toTag(t)).filter((t) => t.id);
  } catch {
    return [];
  }
}

/**
 * A post's tags by id, in the post's own order (a blog's tags run to hundreds — a catalog page would
 * silently drop chips). Non-fatal: [] on failure.
 */
export async function fetchTagsByIds(ids: readonly string[]): Promise<BlogTag[]> {
  if (!ids.length) return [];
  try {
    const res = await tags.queryTags().in("_id", [...ids]).limit(TAG_BY_IDS_LIMIT).find();
    return inIdOrder(ids, (res.items ?? []).map((t: Raw) => toTag(t)).filter((t) => t.id));
  } catch {
    return [];
  }
}

// The two by-slug getters return DIFFERENT envelopes upstream ({ category } vs { tag } here;
// getTag(id) even returns the tag bare) — the mapping below absorbs that asymmetry once.

/** One category by its URL slug. Null when not found. */
export async function fetchCategoryBySlug(slug: string): Promise<BlogCategory | null> {
  try {
    const res = await categories.getCategoryBySlug(slug);
    return res.category ? toCategory(res.category as Raw, imgSrc) : null;
  } catch {
    return null;
  }
}

/** One tag by its URL slug. Null when not found. */
export async function fetchTagBySlug(slug: string): Promise<BlogTag | null> {
  try {
    const res = await tags.getTagBySlug(slug);
    return res.tag ? toTag(res.tag as Raw) : null;
  } catch {
    return null;
  }
}
