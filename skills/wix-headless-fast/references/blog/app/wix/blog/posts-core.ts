// Post rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./posts.ts (the
// SDK, managed Astro and React) and the REST twin in references/blog/rest/posts.ts (fetch, a static
// site or a port to another language). Every rule about dates, covers, the feed's sort and filters,
// and the body fieldsets lives HERE, once. A raw post may come from the SDK (`_id`, media as a
// `wix:image://` string, dates as Date) or from REST (`id`, media as an { id, url } object, dates
// as ISO strings); the mappers accept both and produce the same DTO. Imports are type-only so a
// strip to JS emits no imports.
import type { PostDetail, PostSummary } from "./types";

/** A raw Blog V3 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** The Wix Blog app id (Astro item-page routing; comments use it as appId). */
export const BLOG_APP_ID = "14bcded7-0066-7c35-14d7-466cb3f09103";

/** The body fieldsets — without them richContent and contentText come back undefined. */
export const DETAIL_FIELDSETS = ["RICH_CONTENT", "CONTENT_TEXT"] as const;

/** The feed's order: newest first; Wix places pinned posts first on its own. */
export const FEED_SORT = [{ fieldName: "firstPublishedDate", order: "DESC" }] as const;

/** Cover size every card and post header gets — 16:9, one scaled URL per post. */
export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 675;

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

/**
 * A media value in the form imgSrc scales. The SDK hands over the `wix:image://v1/<file>/<name>#…`
 * string; REST hands over the Image object { id, url, width, height, filename }. Rebuilding the
 * wix:image form from the object makes both transports scale to the SAME URL — passing the object's
 * `url` through would skip scaling and the two paths would disagree on coverUrl.
 */
export function mediaValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const o = value as Raw;
  if (o.id && !String(o.id).startsWith("http")) {
    const size = o.width && o.height ? `#originWidth=${o.width}&originHeight=${o.height}` : "";
    return `wix:image://v1/${o.id}/${o.filename ?? ""}${size}`;
  }
  return o.url ?? o.image ?? "";
}

/** Display date + ISO date from either a Date (SDK) or an ISO string (REST); both "" when missing or invalid. */
export function dateParts(value: unknown): { dateLabel: string; dateISO: string } {
  if (!value) return { dateLabel: "", dateISO: "" };
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return { dateLabel: "", dateISO: "" };
  return {
    dateLabel: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    dateISO: d.toISOString(),
  };
}

/** "Aug 27, 2026 · 4 min read" — the card's and header's meta line; either half alone, "" when neither is known. */
export function postMetaLine(post: Pick<PostSummary, "dateLabel" | "minutesToRead">): string {
  return [post.dateLabel, post.minutesToRead > 0 ? `${post.minutesToRead} min read` : ""].filter(Boolean).join(" · ");
}

export function toSummary(raw: Raw, imgSrc: ImgSrc): PostSummary {
  return {
    id: rawId(raw),
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    excerpt: raw.excerpt ?? "",
    ...dateParts(raw.firstPublishedDate),
    minutesToRead: raw.minutesToRead ?? 0,
    featured: raw.featured === true,
    pinned: raw.pinned === true,
    // The cover lives at media.wixMedia.image — a media string (SDK) or an Image object (REST).
    coverUrl: imgSrc(mediaValue(raw.media?.wixMedia?.image), COVER_WIDTH, COVER_HEIGHT),
    categoryIds: raw.categoryIds ?? [],
    tagIds: raw.tagIds ?? [],
  };
}

export function toDetail(raw: Raw, imgSrc: ImgSrc): PostDetail {
  return {
    ...toSummary(raw, imgSrc),
    richContent: raw.richContent ?? null,
    // contentText is plain text — split on newlines for the fallback body.
    paragraphs: String(raw.contentText ?? "")
      .split("\n")
      .map((s: string) => s.trim())
      .filter(Boolean),
  };
}

export interface FetchPostsOptions {
  limit?: number;
  /** `nextCursor` from a previous page. */
  cursor?: string | null;
  /** Server-side filters (first page only — the cursor carries them on later pages). */
  categoryId?: string | null;
  tagId?: string | null;
}

/**
 * The feed query as one object — the REST body's `query`, and the rule the SDK builder in ./posts.ts
 * spells with .descending()/.hasSome()/.skipTo(). A cursor encodes the original filter+sort, so a
 * cursor request carries ONLY cursorPaging; the first page carries the sort and the filters.
 */
export function feedQuery({ limit = 20, cursor, categoryId, tagId }: FetchPostsOptions = {}): Raw {
  if (cursor) return { cursorPaging: { limit, cursor } };
  const filter: Raw = {};
  if (categoryId) filter.categoryIds = { $hasSome: [categoryId] };
  if (tagId) filter.tagIds = { $hasSome: [tagId] };
  return { ...(Object.keys(filter).length ? { filter } : {}), sort: FEED_SORT, cursorPaging: { limit } };
}

/** The by-slug query (REST body's `query`): exact slug, one row. */
export function slugQuery(slug: string): Raw {
  return { filter: { slug: { $eq: slug } }, cursorPaging: { limit: 1 } };
}
