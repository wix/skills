// Blog DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Cover images are
// resolved https URLs; dates are pre-formatted display strings plus an ISO value for <time>.
// A field that is "" or undefined means "not known" — render nothing for it, never a placeholder.

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
  /** Estimated reading time in minutes (0 when unknown — render nothing, never "0 min read"). */
  minutesToRead: number;
  featured: boolean;
  /** Pinned posts lead the default feed order. */
  pinned: boolean;
  /**
   * Resolved https cover URL, 16:9 ("" when the post has no cover, or its author hid it). A video
   * cover resolves to its poster, an external embed (YouTube/Vimeo) to its thumbnail.
   */
  coverUrl: string;
  /** Alt text for the cover: the author's alt text, else the title ("" when there is no cover). */
  coverAlt: string;
  categoryIds: string[];
  tagIds: string[];
  /** The author's member id ("" when none). */
  authorId: string;
  /** The author's display name ("" when unresolved — render no byline then). */
  authorName: string;
  /** Resolved https avatar URL ("" when none). */
  authorAvatarUrl: string;
  /** Counters (the METRICS fieldset). undefined = unknown → render nothing. */
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
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
  /** Display-ready last-published date ("" when the post was never republished). */
  updatedLabel: string;
  updatedISO: string;
  /** The owner's SEO title override, else the title — the <title> on stacks without the SEO service. */
  seoTitle: string;
  /** The owner's meta-description override, else the excerpt, else the body text cut to 500 chars. */
  seoDescription: string;
  /** Writer-curated related posts, in the writer's order (may be empty). */
  relatedPostIds: string[];
  /** Comments are open on this post (the dashboard's per-post switch). */
  commentingEnabled: boolean;
  /** The comments thread id (the REFERENCE_ID fieldset); "" when the API answered without it. */
  referenceId: string;
}

/** A post author — a site member's public profile. */
export interface BlogAuthor {
  id: string;
  /** Display name ("" when the member set none). */
  name: string;
  /** Resolved https avatar URL ("" when none). */
  avatarUrl: string;
}

/** The post's counters as the API's dedicated metrics read answers them. */
export interface PostMetrics {
  views?: number;
  likes?: number;
  comments?: number;
}

/** The viewer's like state for one post, plus the fresh counters read alongside it. */
export interface LikeState {
  /** Whether THIS viewer (member or anonymous visitor) has liked the post. */
  liked: boolean;
  /** null when the metrics read failed — keep the count you had. */
  metrics: PostMetrics | null;
}

export interface BlogCategory {
  id: string;
  slug: string;
  /** Display name (the API calls it `label`, never `name`). */
  label: string;
  /** The category's SEO title ("" when the owner set none) — the <title> of a category page. */
  title: string;
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

/** PUBLISHED is the normal state; PENDING awaits the owner's approval; DELETED is a placeholder kept for its replies. */
export type CommentStatus = "PUBLISHED" | "PENDING" | "DELETED" | "HIDDEN" | "UNKNOWN";

/** One comment — a top-level comment or a reply. Threads are two levels deep (Wix's rule). */
export interface BlogComment {
  id: string;
  /** The top-level comment this reply hangs under; null for a top-level comment. */
  topLevelId: string | null;
  /** The comment this one replies to (may itself be a reply — show "replying to"); null for a top-level comment. */
  parentId: string | null;
  /** The parent's author name ("" when unknown or a top-level comment). */
  parentAuthorName: string;
  /** The author's member id ("" for a guest or a deleted comment). */
  authorId: string;
  /** The author's display name ("" when unresolved). */
  authorName: string;
  authorAvatarUrl: string;
  /** True when the current member wrote it — show the delete control only then. */
  isOwn: boolean;
  dateLabel: string;
  dateISO: string;
  status: CommentStatus;
  /** Ricos document (plain JSON) — render through RichContent where it deploys; a PENDING comment carries its draft. */
  content: Record<string, unknown> | null;
  /** The comment's plain text — the body on stacks without the Ricos viewer ("" for a DELETED placeholder). */
  text: string;
  /** Number of replies (any depth) under a top-level comment. */
  replyCount: number;
}

/** The replies of one top-level comment; `nextCursor` continues them (null → none or all loaded). */
export interface CommentThread {
  comments: BlogComment[];
  nextCursor: string | null;
}

/** One page of top-level comments plus the reply seams the API answered for them. */
export interface CommentPage {
  comments: BlogComment[];
  nextCursor: string | null;
  /** Keyed by top-level comment id — its replies (empty until loaded) and their cursor. */
  replies: Record<string, CommentThread>;
}
