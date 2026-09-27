// Category + tag reads (Wix Blog V3) over the SDK — the only file that touches raw taxonomy
// entities on this transport. Everything it returns is a plain DTO from ./types. The mappers live
// in ./taxonomy-core (shared with the REST twin in references/blog/rest/); this file is the
// transport only. Copy as-is; extend by adding functions.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/query-categories.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/query-tags.md
import { categories as categoriesModule, tags as tagsModule } from "@wix/blog";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { TAXONOMY_LIMIT, toCategory, toTag } from "./taxonomy-core";
import type { Raw } from "./posts-core";
import type { BlogCategory, BlogTag } from "./types";

const categories = wixModule(categoriesModule);
const tags = wixModule(tagsModule);

/** Categories in menu order (displayPosition) — non-fatal (empty array on failure). */
export async function fetchBlogCategories(): Promise<BlogCategory[]> {
  try {
    const res = await categories.queryCategories().ascending("displayPosition").limit(TAXONOMY_LIMIT).find();
    return (res.items ?? []).map((c: Raw) => toCategory(c, imgSrc)).filter((c) => c.id);
  } catch {
    return [];
  }
}

/** Tags, most-published-posts first — non-fatal (empty array on failure). */
export async function fetchBlogTags(): Promise<BlogTag[]> {
  try {
    const res = await tags.queryTags().descending("publishedPostCount").limit(TAXONOMY_LIMIT).find();
    return (res.items ?? []).map((t: Raw) => toTag(t)).filter((t) => t.id);
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
