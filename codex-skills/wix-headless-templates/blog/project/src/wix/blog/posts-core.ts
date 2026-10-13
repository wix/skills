// Post rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./posts.ts (the
// SDK, managed Astro and React) and the REST twin in templates/blog/rest/posts.ts (fetch, a static
// site or a port to another language). Every rule about dates, covers, the feed's sort and filters,
// the body fieldsets, SEO overrides, related posts, likes, and URLs lives HERE, once. A raw post may
// come from the SDK (`_id`, media as a `wix:image://` string, dates as Date) or from REST (`id`,
// media as an { id, url } object, dates as ISO strings); the mappers accept both and produce the
// same DTO. Imports are type-only so a strip to JS emits no imports.
import type { BlogAuthor, PostDetail, PostMetrics, PostSummary } from "./types";

/** A raw Blog V3 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** The Wix Blog app id (Astro item-page routing; comments use it as appId). */
export const BLOG_APP_ID = "14bcded7-0066-7c35-14d7-466cb3f09103";

/** Where the blog lives in the site's URL space; every path helper below builds on it. */
export const BLOG_BASE = "/blog";

/**
 * The post page's fieldsets — without them richContent, contentText, seoData, and referenceId come
 * back undefined. SEO carries the owner's title/description overrides. The comments thread id is
 * `referenceId`: verified live, the REFERENCE_ID fieldset returns the post WITHOUT it (silently),
 * while INTERNAL_ID returns both `internalId` and `referenceId` — so both are requested, and the
 * mapper falls back to the post id (which is what referenceId equalled on every post read live, and
 * what Wix's own Blog widget addresses the thread by). (Fieldset enum: URL, CONTENT_TEXT, METRICS,
 * SEO, CONTACT_ID, RICH_CONTENT, REFERENCE_ID; INTERNAL_ID is accepted on the wire.)
 */
export const DETAIL_FIELDSETS = ["RICH_CONTENT", "CONTENT_TEXT", "SEO", "REFERENCE_ID", "INTERNAL_ID"] as const;

/**
 * The card fieldsets: METRICS puts view/like/comment counts on every post of a page in one read. The
 * field is deprecated on the SDK's Post type ("data can be inconsistent") but live on the wire; the
 * post page refreshes it with the dedicated metrics read (fetchPostMetrics / fetchLikeState).
 */
export const CARD_FIELDSETS = ["METRICS"] as const;

/**
 * The feed's order: pinned posts first, then newest first. Only listPosts' FEED default pins on its
 * own; queryPosts with an explicit sort is pure date order, so the pinned key is spelled out here.
 */
export const FEED_SORT = [
  { fieldName: "pinned", order: "DESC" },
  { fieldName: "firstPublishedDate", order: "DESC" },
] as const;

/** Related posts: newest first among posts sharing a category (no pinned key — Wix's related strip has none). */
export const RECENT_SORT = [{ fieldName: "firstPublishedDate", order: "DESC" }] as const;

/** How many related posts a post page shows (Wix's default; curated lists are capped the same way). */
export const RELATED_LIMIT = 3;

/** The Like service scopes likes by entity FQDN; blog posts use the V3 post FQDN. */
export const BLOG_POST_FQDN = "wix.blog.v3.post";

/** Meta descriptions are cut here — the Blog API caps its own `excerpt` at the same length. */
export const SEO_DESCRIPTION_MAX = 500;

/** Cover size every card and post header gets — 16:9, one scaled URL per post. */
export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 675;

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

// ---- URLs ----------------------------------------------------------------------------------

/** A slug may contain "/" — encode per segment so the path keeps its shape and a `[...slug]` route re-joins it. */
export const encodeSlugPath = (slug: string): string => slug.split("/").map(encodeURIComponent).join("/");
/** The post page: /blog/<slug>. Never build it from an id, never use `post.url` (the legacy blog page). */
export const postPath = (slug: string): string => `${BLOG_BASE}/${encodeSlugPath(slug)}`;
/** The category page: /blog/category/<slug>. */
export const categoryPath = (slug: string): string => `${BLOG_BASE}/category/${encodeSlugPath(slug)}`;
/** The tag page: /blog/tag/<slug>. */
export const tagPath = (slug: string): string => `${BLOG_BASE}/tag/${encodeSlugPath(slug)}`;

// ---- media ---------------------------------------------------------------------------------

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
  const id = o._id ?? o.id;
  if (id && !String(id).startsWith("http")) {
    const size = o.width && o.height ? `#originWidth=${o.width}&originHeight=${o.height}` : "";
    return `wix:image://v1/${id}/${o.filename ?? ""}${size}`;
  }
  return o.url ?? o.image ?? "";
}

/**
 * A video cover's poster as a wix:image value. The SDK's videoV2 is the string
 * `wix:video://v1/<id>/<file>#posterUri=<file>&posterWidth=<w>&posterHeight=<h>`; REST's is the
 * object { id, filename, posters: [{ id, url, width, height }] } (the SDK builds its string from
 * the LAST poster). "" when the video carries no poster.
 */
export function videoPoster(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    const hash = value.split("#")[1] ?? "";
    const params = new URLSearchParams(hash);
    const uri = params.get("posterUri");
    if (!uri) return "";
    const w = params.get("posterWidth"), h = params.get("posterHeight");
    return `wix:image://v1/${uri}/${uri}${w && h ? `#originWidth=${w}&originHeight=${h}` : ""}`;
  }
  const posters: Raw[] = (value as Raw).posters ?? [];
  const poster = posters[posters.length - 1];
  if (!poster) return "";
  const id = poster.id || (poster.url ? String(poster.url).slice(String(poster.url).lastIndexOf("/") + 1) : "");
  return id ? mediaValue({ id, filename: id, width: poster.width, height: poster.height }) : "";
}

/**
 * The cover as a card renders it. `media.displayed === false` is the author hiding the cover —
 * no cover at all. Otherwise the image wins, then a Wix video's poster, then an external embed's
 * thumbnail (YouTube/Vimeo). Alt text is the author's, else the title.
 */
export function coverOf(raw: Raw, imgSrc: ImgSrc): { coverUrl: string; coverAlt: string } {
  const media: Raw | undefined = raw.media;
  if (!media || media.displayed === false) return { coverUrl: "", coverAlt: "" };
  const coverUrl =
    imgSrc(mediaValue(media.wixMedia?.image), COVER_WIDTH, COVER_HEIGHT) ||
    imgSrc(videoPoster(media.wixMedia?.videoV2), COVER_WIDTH, COVER_HEIGHT) ||
    (media.embedMedia?.thumbnail?.url ?? "");
  return { coverUrl, coverAlt: coverUrl ? (media.altText ?? raw.title ?? "") : "" };
}

// ---- dates and numbers -----------------------------------------------------------------------

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

const DAY_MS = 86_400_000;

/**
 * Wix's default date style: relative under a week ("3 days ago"), "Aug 5" in the current year,
 * "Aug 5, 2024" otherwise. Pass the SAME `now` on the server and the client (e.g. a `fetchedAt`
 * you put in the island's props) or the two renders disagree and hydration warns. "" when unknown.
 */
export function relativeDateLabel(dateISO: string, now: number = Date.now(), locale?: string): string {
  if (!dateISO) return "";
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return "";
  const diff = now - d.getTime();
  if (diff >= 0 && diff < 7 * DAY_MS) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (diff < 60_000) return rtf.format(-Math.round(diff / 1000), "second");
    if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), "minute");
    if (diff < DAY_MS) return rtf.format(-Math.round(diff / 3_600_000), "hour");
    return rtf.format(-Math.round(diff / DAY_MS), "day");
  }
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, { ...(sameYear ? {} : { year: "numeric" }), month: "short", day: "numeric" }).format(d);
}

/** "1.2K" (compact, the default) or "1,234" (full) — counters. "" for an unknown count. */
export function formatCount(n: number | undefined, style: "compact" | "full" = "compact", locale?: string): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return new Intl.NumberFormat(locale, style === "compact" ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(n);
}

/** "Aug 27, 2026 · 4 min read" — the card's and header's meta line; either half alone, "" when neither is known. */
export function postMetaLine(post: Pick<PostSummary, "dateLabel" | "minutesToRead">): string {
  return [post.dateLabel, post.minutesToRead > 0 ? `${post.minutesToRead} min read` : ""].filter(Boolean).join(" · ");
}

// ---- SEO overrides (the dashboard's Advanced SEO panel, on posts and categories) --------------

const liveSeoTags = (seoData: Raw | undefined | null): Raw[] => ((seoData?.tags ?? []) as Raw[]).filter((t) => !t.disabled);

/** The owner's title override, "" when none. A title tag carries its value in `children`. */
export function seoTitleFrom(seoData: Raw | undefined | null): string {
  return liveSeoTags(seoData).find((t) => t.type === "title")?.children || "";
}

/** The owner's meta-description override, "" when none: a `meta` tag with props.name "description". */
export function seoDescriptionFrom(seoData: Raw | undefined | null): string {
  const c = liveSeoTags(seoData).find((t) => t.type === "meta" && t.props?.name === "description")?.props?.content;
  return typeof c === "string" ? c : "";
}

// ---- mappers -------------------------------------------------------------------------------

const count = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** The counters from a metrics object (a post's `metrics` field or the metrics read's `metrics`). */
export function toMetrics(raw: Raw | undefined | null): PostMetrics {
  return { views: count(raw?.views), likes: count(raw?.likes), comments: count(raw?.comments) };
}

export function toSummary(raw: Raw, imgSrc: ImgSrc): PostSummary {
  const metrics = toMetrics(raw.metrics);
  return {
    id: rawId(raw),
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    excerpt: raw.excerpt ?? "",
    ...dateParts(raw.firstPublishedDate),
    minutesToRead: raw.minutesToRead ?? 0,
    featured: raw.featured === true,
    pinned: raw.pinned === true,
    ...coverOf(raw, imgSrc),
    categoryIds: raw.categoryIds ?? [],
    tagIds: raw.tagIds ?? [],
    authorId: raw.memberId ?? "",
    authorName: "",
    authorAvatarUrl: "",
    viewCount: metrics.views,
    likeCount: metrics.likes,
    commentCount: metrics.comments,
  };
}

export function toDetail(raw: Raw, imgSrc: ImgSrc): PostDetail {
  const summary = toSummary(raw, imgSrc);
  const contentText = String(raw.contentText ?? "");
  const updated = dateParts(raw.lastPublishedDate);
  return {
    ...summary,
    richContent: raw.richContent ?? null,
    // contentText is plain text — split on newlines for the fallback body.
    paragraphs: contentText
      .split("\n")
      .map((s: string) => s.trim())
      .filter(Boolean),
    updatedLabel: updated.dateLabel,
    updatedISO: updated.dateISO,
    seoTitle: seoTitleFrom(raw.seoData) || summary.title,
    seoDescription: (seoDescriptionFrom(raw.seoData) || summary.excerpt || contentText).slice(0, SEO_DESCRIPTION_MAX),
    relatedPostIds: raw.relatedPostIds ?? [],
    commentingEnabled: raw.commentingEnabled === true,
    referenceId: raw.referenceId ?? raw.internalId ?? raw.id ?? "",
  };
}

/** Join resolved authors onto posts; a post whose author did not resolve keeps "" (no byline). */
export function withAuthors<T extends PostSummary>(posts: T[], authors: Record<string, BlogAuthor>): T[] {
  return posts.map((p) => {
    const a = authors[p.authorId];
    return a ? { ...p, authorName: a.name, authorAvatarUrl: a.avatarUrl } : p;
  });
}

// ---- queries -------------------------------------------------------------------------------

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

/** The by-slug query (REST body's `query`): exact slug, one row. A documented fallback — the by-slug getter is the primary read. */
export function slugQuery(slug: string): Raw {
  return { filter: { slug: { $eq: slug } }, cursorPaging: { limit: 1 } };
}

/** Posts by id (REST body's `query`; the SDK spells it .in("_id", ids)) — the curated related posts. */
export function byIdsQuery(ids: string[], limit: number = ids.length): Raw {
  return { filter: { id: { $in: ids } }, cursorPaging: { limit } };
}

/**
 * The algorithmic related posts: newest first among posts sharing a category with the current one,
 * the current one excluded. A post with no categories gets plain site-wide recents — a
 * `$hasSome: []` matches nothing, so the category filter is added only when there is one.
 */
export function recentRelatedQuery(post: Pick<PostSummary, "id" | "categoryIds">, limit = RELATED_LIMIT): Raw {
  const filter: Raw = { id: { $ne: post.id } };
  if (post.categoryIds.length) filter.categoryIds = { $hasSome: post.categoryIds };
  return { filter, sort: RECENT_SORT, cursorPaging: { limit } };
}

/**
 * The curated list in the WRITER's order (the query answers in its own), the current post dropped,
 * ids that no longer resolve to a visible post dropped, capped at `limit`. Strictly either/or with
 * the algorithmic list: when at least one curated pick survives, exactly those are shown, never
 * topped up.
 */
export function pickCurated<T extends { id: string }>(ids: string[], items: T[], currentId: string, limit = RELATED_LIMIT): T[] {
  const byId = new Map(items.map((p) => [p.id, p]));
  return ids
    .filter((id) => id !== currentId)
    .map((id) => byId.get(id))
    .filter((p): p is T => p !== undefined)
    .slice(0, limit);
}

/**
 * "Did THIS viewer like the post?" — the Like service scopes queryLikes to the calling identity
 * (member or anonymous visitor), so one row means yes. REST body's `query`; the SDK spells it
 * .eq("fqdn").eq("entityId").limit(1). Personal → client-only, never during SSR.
 */
export function likeStateQuery(postId: string): Raw {
  return { filter: { fqdn: { $eq: BLOG_POST_FQDN }, entityId: { $eq: postId } }, cursorPaging: { limit: 1 } };
}

/** The like write's body — the same object for createLike and for the REST POST. */
export function likeBody(postId: string): Raw {
  return { like: { entityId: postId, fqdn: BLOG_POST_FQDN } };
}

/**
 * An expected miss, not a failure: a 404, or an application error whose code names NOT_FOUND.
 * Guarded with String() — the SDK's transformed error carries a NUMERIC code for HTTP failures.
 */
export function isNotFound(e: unknown): boolean {
  const err = (e ?? {}) as { status?: unknown; code?: unknown; details?: { applicationError?: { code?: unknown } } };
  return err.status === 404 || String(err.details?.applicationError?.code ?? err.code ?? "").includes("NOT_FOUND");
}

/** A write the caller's identity may not perform — an anonymous visitor commenting where members only may. */
export function isPermissionDenied(e: unknown): boolean {
  const err = (e ?? {}) as { status?: unknown; code?: unknown; details?: { applicationError?: { code?: unknown } } };
  const code = String(err.details?.applicationError?.code ?? err.code ?? "");
  return err.status === 401 || err.status === 403 || /PERMISSION_DENIED|UNAUTHENTICATED|FORBIDDEN/.test(code);
}
