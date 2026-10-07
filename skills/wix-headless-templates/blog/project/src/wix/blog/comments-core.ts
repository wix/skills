// Comment rules and DTO mapping — transport-agnostic, imported by both ./comments.ts and the REST
// twin in templates/blog/rest/comments.ts. Wix Comments is one service for every app; a blog post's
// thread is addressed by the Blog app id plus the post's REFERENCE ID as both contextId and
// resourceId (the public-SDK shape Wix's own headless blog uses; the classic Blog widget uses the
// post id through an internal client instead — verify on a live site that the dashboard's threads
// come back). Threads are two levels deep: a reply is stored under its TOP-level comment, and its
// `parentComment` may itself be a reply ("replying to"). Imports are type-only.
import type { BlogAuthor, BlogComment, CommentPage, CommentStatus, CommentThread } from "./types";
import type { Raw } from "./posts-core";

// A copy of posts-core's BLOG_APP_ID and dateParts, so this file stands alone when stripped.
const BLOG_APP_ID = "14bcded7-0066-7c35-14d7-466cb3f09103";
function dateParts(value: unknown): { dateLabel: string; dateISO: string } {
  if (!value) return { dateLabel: "", dateISO: "" };
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return { dateLabel: "", dateISO: "" };
  return { dateLabel: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }), dateISO: d.toISOString() };
}

/** Top-level comments per page (Wix's default) and replies per "show more replies". */
export const COMMENTS_PAGE_SIZE = 10;
export const REPLIES_PAGE_SIZE = 10;

/** The two orders a blog thread offers; replies are always oldest first. */
export type CommentSort = "NEWEST_FIRST" | "OLDEST_FIRST";
export const DEFAULT_COMMENT_SORT: CommentSort = "NEWEST_FIRST";

export interface ListCommentsOptions {
  /** `PostDetail.referenceId` — the thread. */
  referenceId: string;
  cursor?: string | null;
  limit?: number;
  sort?: CommentSort;
}

/**
 * The list-by-resource request as flat query-string params (the endpoint is a GET; nested fields
 * travel as dotted keys, the SDK flattens them the same way). `repliesLimit: 0` asks for the reply
 * SEAMS only — each top-level comment's reply cursor comes back without its replies, which load on
 * demand with `listRepliesParams`.
 */
export function listCommentsParams({ referenceId, cursor, limit = COMMENTS_PAGE_SIZE, sort = DEFAULT_COMMENT_SORT }: ListCommentsOptions): Record<string, string> {
  return {
    appId: BLOG_APP_ID,
    contextId: referenceId,
    resourceId: referenceId,
    "commentSort.order": sort,
    "replySort.order": "OLDEST_FIRST",
    "cursorPaging.limit": String(limit),
    "cursorPaging.repliesLimit": "0",
    ...(cursor ? { "cursorPaging.cursor": cursor } : {}),
  };
}

/** The same GET, continuing ONE top-level comment's replies from the cursor the list handed back. */
export function listRepliesParams({ referenceId, cursor, limit = REPLIES_PAGE_SIZE }: { referenceId: string; cursor: string; limit?: number }): Record<string, string> {
  return {
    appId: BLOG_APP_ID,
    contextId: referenceId,
    resourceId: referenceId,
    "replySort.order": "OLDEST_FIRST",
    "cursorPaging.limit": String(limit),
    "cursorPaging.cursor": cursor,
  };
}

export interface CreateCommentOptions {
  referenceId: string;
  /** Plain text — wrapped into a one-paragraph Ricos document. */
  text?: string;
  /** Or a ready Ricos document (from a rich editor). */
  richContent?: Record<string, unknown>;
  /** Reply to this comment (a top-level comment or a reply). */
  parentId?: string | null;
}

/** A one-paragraph Ricos document: TEXT is always a leaf inside a PARAGRAPH; the leaf's id is "". */
export function textToRichContent(text: string): Record<string, unknown> {
  return {
    nodes: [
      { type: "PARAGRAPH", id: "c1", nodes: [{ type: "TEXT", id: "", nodes: [], textData: { text, decorations: [] } }], paragraphData: {} },
    ],
  };
}

/** The create body: `{ comment }`, the reply's parent as `parentComment.id`. */
export function createCommentBody({ referenceId, text, richContent, parentId }: CreateCommentOptions): Raw {
  return {
    comment: {
      appId: BLOG_APP_ID,
      contextId: referenceId,
      resourceId: referenceId,
      content: { richContent: richContent ?? textToRichContent(text ?? "") },
      ...(parentId ? { parentComment: { id: parentId } } : {}),
    },
  };
}

/** The plain text of a Ricos document — every TEXT leaf, paragraphs joined by newlines. */
export function richContentText(rc: Raw | null | undefined): string {
  const walk = (node: Raw): string =>
    node.type === "TEXT" ? (node.textData?.text ?? "") : ((node.nodes ?? []) as Raw[]).map(walk).join("");
  return ((rc?.nodes ?? []) as Raw[]).map(walk).map((s) => s.trim()).filter(Boolean).join("\n");
}

const STATUSES: readonly CommentStatus[] = ["PUBLISHED", "PENDING", "DELETED", "HIDDEN"];

export interface CommentContext {
  authors: Record<string, BlogAuthor>;
  currentMemberId: string | null;
  /** The top-level comment a reply hangs under; null for top-level comments. */
  topLevelId: string | null;
}

export function toComment(raw: Raw, { authors, currentMemberId, topLevelId }: CommentContext): BlogComment {
  const status: CommentStatus = STATUSES.includes(raw.status) ? raw.status : "UNKNOWN";
  // A PENDING comment (awaiting the owner's approval) carries its text as draftContent, not content.
  const content: Raw | null = raw.content?.richContent ?? (status === "PENDING" ? raw.draftContent?.richContent : null) ?? null;
  const authorId: string = raw.author?.memberId ?? "";
  const author = authors[authorId];
  const parentAuthor = authors[raw.parentComment?.author?.memberId ?? ""];
  return {
    id: raw._id ?? raw.id ?? "",
    topLevelId,
    parentId: raw.parentComment?._id ?? raw.parentComment?.id ?? null,
    parentAuthorName: parentAuthor?.name ?? "",
    authorId,
    authorName: author?.name ?? "",
    authorAvatarUrl: author?.avatarUrl ?? "",
    isOwn: Boolean(currentMemberId) && authorId === currentMemberId,
    ...dateParts(raw.commentDate ?? raw._createdDate ?? raw.createdDate),
    status,
    content,
    text: richContentText(content),
    replyCount: typeof raw.replyCount === "number" ? raw.replyCount : 0,
  };
}

/** Every member id a raw comment list references (authors and reply-to authors), for one batched lookup. */
export function commentAuthorIds(raws: readonly Raw[]): string[] {
  return [...new Set(raws.flatMap((c) => [c.author?.memberId, c.parentComment?.author?.memberId]).filter((id): id is string => Boolean(id)))];
}

/** All raw comments a list response carries — the top-level ones and every seam's replies. */
export function rawCommentsOf(res: Raw | null | undefined): Raw[] {
  const replies = Object.values((res?.commentReplies ?? {}) as Record<string, Raw>).flatMap((r) => (r.replies ?? []) as Raw[]);
  return [...((res?.comments ?? []) as Raw[]), ...replies];
}

export function toCommentPage(res: Raw | null | undefined, ctx: Omit<CommentContext, "topLevelId">): CommentPage {
  const replies: Record<string, CommentThread> = {};
  for (const [topLevelId, r] of Object.entries((res?.commentReplies ?? {}) as Record<string, Raw>)) {
    replies[topLevelId] = {
      comments: ((r.replies ?? []) as Raw[]).map((c) => toComment(c, { ...ctx, topLevelId })),
      nextCursor: r.pagingMetadata?.cursors?.next ?? null,
    };
  }
  return {
    comments: ((res?.comments ?? []) as Raw[]).map((c) => toComment(c, { ...ctx, topLevelId: null })),
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
    replies,
  };
}

/** A replies page: the same response shape, its `comments` being the replies of one top-level comment. */
export function toCommentThread(res: Raw | null | undefined, ctx: CommentContext): CommentThread {
  return {
    comments: ((res?.comments ?? []) as Raw[]).map((c) => toComment(c, ctx)),
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
  };
}

/** Re-mark ownership once the current member is known (the list and the member read run in parallel). */
export function markOwn<T extends Pick<BlogComment, "authorId" | "isOwn">>(items: T[], currentMemberId: string | null): T[] {
  return items.map((c) => ({ ...c, isOwn: Boolean(currentMemberId) && c.authorId === currentMemberId }));
}

/** A deleted comment that still has replies stays as a placeholder: no author, no body. */
export function toDeletedPlaceholder(c: BlogComment): BlogComment {
  return { ...c, status: "DELETED", content: null, text: "", authorId: "", authorName: "", authorAvatarUrl: "", isOwn: false };
}

/** Merge a page into a list by id, keeping the existing order and appending what is new. */
export function mergeById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map(existing.map((c) => [c.id, c]));
  for (const c of incoming) byId.set(c.id, c);
  const seen = new Set(existing.map((c) => c.id));
  return [...existing.map((c) => byId.get(c.id)!), ...incoming.filter((c) => !seen.has(c.id))];
}
