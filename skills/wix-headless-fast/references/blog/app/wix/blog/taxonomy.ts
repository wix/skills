// Category + tag reads (Wix Blog V3) — the only file that touches raw taxonomy entities.
// Everything it returns is a plain DTO from ./types. Copy as-is; extend by adding functions.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/query-categories.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/query-tags.md
import { categories as categoriesModule, tags as tagsModule } from "@wix/blog";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import type { BlogCategory, BlogTag } from "./types";

const categories = wixModule(categoriesModule);
const tags = wixModule(tagsModule);

type Raw = Record<string, any>;

function toCategory(raw: Raw): BlogCategory {
  return {
    id: raw._id ?? "",
    slug: raw.slug ?? "",
    label: raw.label ?? "",
    description: raw.description ?? "",
    postCount: raw.postCount ?? 0,
    coverUrl: imgSrc(raw.coverImage, 1200, 675),
  };
}

function toTag(raw: Raw): BlogTag {
  return {
    id: raw._id ?? "",
    slug: raw.slug ?? "",
    label: raw.label ?? "",
    postCount: raw.publishedPostCount ?? 0,
  };
}

/** Categories in menu order (displayPosition) — non-fatal (empty array on failure). */
export async function fetchBlogCategories(): Promise<BlogCategory[]> {
  try {
    const res = await categories.queryCategories().ascending("displayPosition").limit(100).find();
    return (res.items ?? []).map((c: Raw) => toCategory(c)).filter((c) => c.id);
  } catch {
    return [];
  }
}

/** Tags, most-published-posts first — non-fatal (empty array on failure). */
export async function fetchBlogTags(): Promise<BlogTag[]> {
  try {
    const res = await tags.queryTags().descending("publishedPostCount").limit(100).find();
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
    return res.category ? toCategory(res.category as Raw) : null;
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
