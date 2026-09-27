// Blog DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Cover images are
// resolved https URLs; dates are pre-formatted display strings plus an ISO value for <time>.

/** A post as a feed/grid tile needs it. */
export interface PostSummary {
  id: string;
  slug: string;
  title: string;
  /** Short summary (≤500 chars) — the card body. May be "". */
  excerpt: string;
  /** Display-ready publish date, e.g. "Aug 26, 2026" ("" when missing). */
  dateLabel: string;
  /** ISO publish date for <time datetime> ("" when missing). */
  dateISO: string;
  /** Estimated reading time in minutes (0 when unknown). */
  minutesToRead: number;
  featured: boolean;
  /** Pinned posts lead the default feed order. */
  pinned: boolean;
  /** Resolved https cover URL ("" when the post has no cover). */
  coverUrl: string;
  categoryIds: string[];
  tagIds: string[];
}

/** A post as the post page needs it. */
export interface PostDetail extends PostSummary {
  /**
   * Ricos rich-content document (plain JSON) — the real post body. Render it ONLY through
   * the shipped RichContent component (@wix/ricos viewer); it is not HTML and not text.
   */
  richContent: Record<string, unknown> | null;
  /** Plain-text body split into paragraphs — the honest fallback when richContent is null. */
  paragraphs: string[];
}

export interface BlogCategory {
  id: string;
  slug: string;
  /** Display name (the API calls it `label`, never `name`). */
  label: string;
  description: string;
  /** Number of posts in the category (hide empty categories with it). */
  postCount: number;
  /** Resolved https cover URL ("" when none). */
  coverUrl: string;
}

export interface BlogTag {
  id: string;
  slug: string;
  label: string;
  /** Number of PUBLISHED posts with this tag. */
  postCount: number;
}

/** One feed page; pass `nextCursor` back to fetch the next (null → no more). */
export interface PostPage {
  posts: PostSummary[];
  nextCursor: string | null;
}
