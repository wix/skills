// Category + tag rules and DTO mapping — transport-agnostic, imported by both ./taxonomy.ts (SDK)
// and the REST twin in references/blog/rest/taxonomy.ts (fetch). Raw entities may carry `_id`
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

export function toCategory(raw: Raw, imgSrc: ImgSrc): BlogCategory {
  return {
    id: rawId(raw),
    slug: raw.slug ?? "",
    label: raw.label ?? "", // the API's display name is `label`, never `name`
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
