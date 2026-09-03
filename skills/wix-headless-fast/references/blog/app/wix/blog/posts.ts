// Post reads (Wix Blog V3) — the only file that touches raw post entities. Everything it
// returns is a plain DTO from ./types. Copy as-is; extend by adding functions, not by editing
// these. Blog posts are NOT CMS collections — always @wix/blog, never @wix/data.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-post-by-slug.md
import { posts as postsModule } from "@wix/blog";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import type { PostDetail, PostPage, PostSummary } from "./types";

const posts = wixModule(postsModule);

/** The Wix Blog app id (Astro item-page routing; comments use it as appId). */
export const BLOG_APP_ID = "14bcded7-0066-7c35-14d7-466cb3f09103";

type Raw = Record<string, any>;

function dateParts(value: unknown): { dateLabel: string; dateISO: string } {
  if (!value) return { dateLabel: "", dateISO: "" };
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return { dateLabel: "", dateISO: "" };
  return {
    dateLabel: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    dateISO: d.toISOString(),
  };
}

function toSummary(raw: Raw): PostSummary {
  return {
    id: raw._id ?? "",
    slug: raw.slug ?? "",
    title: raw.title ?? "",
    excerpt: raw.excerpt ?? "",
    ...dateParts(raw.firstPublishedDate),
    minutesToRead: raw.minutesToRead ?? 0,
    featured: raw.featured === true,
    pinned: raw.pinned === true,
    // The cover is a media STRING (wix:image:// or https) at media.wixMedia.image.
    coverUrl: imgSrc(raw.media?.wixMedia?.image, 1200, 675),
    categoryIds: raw.categoryIds ?? [],
    tagIds: raw.tagIds ?? [],
  };
}

function toDetail(raw: Raw): PostDetail {
  return {
    ...toSummary(raw),
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
 * One page of published posts, newest first (pinned posts lead). Only published posts come
 * back to a visitor token — a "missing" post usually wasn't published, not a query bug.
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
    posts: (res.items ?? []).map((p: Raw) => toSummary(p)),
    nextCursor: res.hasNext() ? (res.cursors?.next ?? null) : null,
  };
}

/**
 * Fetch one post by its URL slug with the full body (RICH_CONTENT + CONTENT_TEXT fieldsets —
 * without them the body fields come back undefined). Null when not found.
 */
export async function fetchPostBySlug(slug: string): Promise<PostDetail | null> {
  const res = await posts
    .queryPosts({ fieldsets: ["RICH_CONTENT", "CONTENT_TEXT"] })
    .eq("slug", slug)
    .limit(1)
    .find();
  const raw = res.items?.[0];
  return raw ? toDetail(raw as Raw) : null;
}
