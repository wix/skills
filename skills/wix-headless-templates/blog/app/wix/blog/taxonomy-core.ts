// Category + tag rules and DTO mapping — transport-agnostic, imported by both ./taxonomy.ts (SDK)
// and the REST twin in templates/blog/rest/taxonomy.ts (fetch). Raw entities may carry `_id`
// (SDK) or `id` (REST). Has its own rawId/mediaValue (copies of posts-core's) so it stands alone
// when stripped; imports are type-only.
import type { BlogCategory, BlogTag } from "./types";
import type { ImgSrc, Raw } from "./posts-core";

/** Menu order — displayPosition ascending; -1 (unplaced) sorts first, which is also what the SDK path shows. */
export const CATEGORY_SORT = [{ fieldName: "displayPosition", order: "ASC" }] as const;
/** Most-published-posts first. */
export const TAG_SORT = [{ fieldName: "publishedPostCount", order: "DESC" }] as const;
/** Blog taxonomies are small — one read of up to 100 is the whole list. */
export const TAXONOMY_LIMIT = 100;
/** A post carries at most 30 tag ids (the API's own cap), so one by-id read answers a post in full. */
export const TAG_BY_IDS_LIMIT = 30;
/** Server-side "only categories that have posts" — the filter row's rule, applied at the source. */
export const WITH_POSTS_FILTER = { postCount: { $gt: 0 } } as const;

const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

// A copy of posts-core's mediaValue: the REST Image object → the wix:image form imgSrc scales.
function mediaValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const o = value as Raw;
  if (o.id && !String(o.id).startsWith("http")) {
    const size = o.width && o.height ? `#originWidth=${o.width}&originHeight=${o.height}` : "";
    return `wix:image://v1/${o.id}/${o.filename ?? ""}${size}`;
  }
  return o.url ?? o.image ?? "";
}

export interface FetchCategoriesOptions {
  /** Only categories with at least one post (the filter row's rule) — applied by Wix. */
  withPosts?: boolean;
}

/** The categories query (REST body's `query`); the SDK spells it .ascending("displayPosition").gt("postCount", 0).limit(100). */
export function categoriesQuery({ withPosts = false }: FetchCategoriesOptions = {}): Raw {
  return { ...(withPosts ? { filter: WITH_POSTS_FILTER } : {}), sort: CATEGORY_SORT, paging: { limit: TAXONOMY_LIMIT } };
}

/**
 * Tags BY ID (REST body's `query`; the SDK spells it .in("_id", ids).limit(30)) — a post's chips are
 * read this way, not joined off a top-100 catalog: a blog's tags run to hundreds, and a tag past the
 * first page would silently lose its chip. Categories run to tens, so their catalog is joined in memory.
 */
export function tagsByIdsQuery(ids: string[]): Raw {
  return { filter: { id: { $in: ids } }, paging: { limit: TAG_BY_IDS_LIMIT } };
}

/**
 * Items in the order the POST lists them (its `categoryIds`/`tagIds`), ids that resolved to nothing
 * dropped — the catalog's displayPosition and the query's own order are not the post's order.
 */
export function inIdOrder<T extends { id: string }>(ids: readonly string[], items: readonly T[]): T[] {
  const byId = new Map(items.map((x) => [x.id, x]));
  return ids.map((id) => byId.get(id)).filter((x): x is T => x !== undefined);
}

export function toCategory(raw: Raw, imgSrc: ImgSrc): BlogCategory {
  return {
    id: rawId(raw),
    slug: raw.slug ?? "",
    label: raw.label ?? "", // the API's display name is `label`, never `name`
    title: raw.title ?? "", // the category's SEO title (the dashboard's "title tag"); "" until the owner sets one
    description: raw.description ?? "",
    postCount: raw.postCount ?? 0,
    coverUrl: imgSrc(mediaValue(raw.coverImage), 1200, 675),
  };
}

export function toTag(raw: Raw): BlogTag {
  return {
    id: rawId(raw),
    slug: raw.slug ?? "",
    label: raw.label ?? "",
    postCount: raw.publishedPostCount ?? 0, // PUBLISHED posts — postCount also counts drafts
  };
}
