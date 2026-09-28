// Post comments over REST — the twin of app/wix/blog/comments.ts. Same exports, same DTOs; the
// rules and mappers come from comments-core (the SAME file the SDK transport uses, deployed flat
// next to this one). Every call runs as the calling identity — in a port, the viewer's session
// token, never a process-wide one (a create would be attributed to whoever that token is).
// docs: https://dev.wix.com/docs/api-reference/crm/community/comments/comments/list-comments-by-resource.md
// docs: https://dev.wix.com/docs/api-reference/crm/community/comments/comments/create-comment.md
// docs: https://dev.wix.com/docs/api-reference/crm/community/comments/comments/delete-comment.md
import { wixRequest } from "./client.js";
import { fetchAuthorsByIds } from "./authors.js";
import {
  commentAuthorIds,
  createCommentBody,
  listCommentsParams,
  listRepliesParams,
  rawCommentsOf,
  toComment,
  toCommentPage,
  toCommentThread,
  type CreateCommentOptions,
  type ListCommentsOptions,
} from "./comments-core.js";
import type { Raw } from "./posts-core.js";
import type { BlogComment, CommentPage, CommentThread } from "./types.js";

export { type CreateCommentOptions, type ListCommentsOptions };

const COMMENTS = "/comments/v1/comments";

/**
 * One page of top-level comments plus each one's reply seam (cursor, no replies yet).
 * GET /comments/v1/comments/list-by-resource?appId=&contextId=&resourceId=&commentSort.order=&replySort.order=OLDEST_FIRST&cursorPaging.limit=10&cursorPaging.repliesLimit=0[&cursorPaging.cursor=]
 */
export async function fetchComments(o: ListCommentsOptions & { currentMemberId?: string | null }): Promise<CommentPage> {
  const res = await wixRequest<Raw>(`${COMMENTS}/list-by-resource`, { method: "GET", query: listCommentsParams(o) });
  const authors = await fetchAuthorsByIds(commentAuthorIds(rawCommentsOf(res)));
  return toCommentPage(res, { authors, currentMemberId: o.currentMemberId ?? null });
}

/**
 * One page of a top-level comment's replies, from the cursor its seam (or a previous page) handed back.
 * GET /comments/v1/comments/list-by-resource?appId=&contextId=&resourceId=&replySort.order=OLDEST_FIRST&cursorPaging.limit=10&cursorPaging.cursor=
 */
export async function fetchReplies(o: { referenceId: string; topLevelId: string; cursor: string; currentMemberId?: string | null }): Promise<CommentThread> {
  const res = await wixRequest<Raw>(`${COMMENTS}/list-by-resource`, { method: "GET", query: listRepliesParams(o) });
  const authors = await fetchAuthorsByIds(commentAuthorIds(rawCommentsOf(res)));
  return toCommentThread(res, { authors, currentMemberId: o.currentMemberId ?? null, topLevelId: o.topLevelId });
}

/**
 * Post a comment (or a reply, with `parentId`) as the current identity. Throws a WixApiError —
 * isPermissionDenied(e) means this viewer may not comment here (sign in).
 * POST /comments/v1/comments  { comment: { appId, contextId, resourceId, content: { richContent }, parentComment?: { id } } }
 */
export async function createComment(o: CreateCommentOptions & { topLevelId?: string | null; currentMemberId?: string | null }): Promise<BlogComment> {
  const res = await wixRequest<Raw>(COMMENTS, { body: createCommentBody(o) });
  const raw: Raw = res?.comment ?? {};
  const authors = await fetchAuthorsByIds(commentAuthorIds([raw]));
  return toComment(raw, { authors, currentMemberId: o.currentMemberId ?? null, topLevelId: o.topLevelId ?? o.parentId ?? null });
}

/** Delete the current member's own comment.  DELETE /comments/v1/comments/{commentId} */
export async function deleteComment(commentId: string): Promise<void> {
  await wixRequest(`${COMMENTS}/${encodeURIComponent(commentId)}`, { method: "DELETE" });
}
