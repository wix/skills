// Post comments (Wix Comments) — the only file that touches raw comment entities on this transport.
// Goes over `wixFetch` (the SDK's authenticated fetch — the same identity as every module call,
// member or anonymous visitor) rather than the `@wix/comments` module, which the blog template does
// not depend on. The rules and mappers live in ./comments-core (shared with the REST twin in
// templates/blog/rest/comments.ts). Who may comment (members only, or guests too) is the dashboard's
// "Who can comment" setting, enforced by the server — a denied create surfaces as isPermissionDenied.
// docs: https://dev.wix.com/docs/api-reference/crm/community/comments/comments/list-comments-by-resource.md
// docs: https://dev.wix.com/docs/api-reference/crm/community/comments/comments/create-comment.md
// docs: https://dev.wix.com/docs/api-reference/crm/community/comments/comments/delete-comment.md
import { wixFetch } from "../sdk";
import { fetchAuthorsByIds } from "./authors";
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
} from "./comments-core";
import type { Raw } from "./posts-core";
import type { BlogComment, CommentPage, CommentThread } from "./types";

export { type CreateCommentOptions, type ListCommentsOptions };

const COMMENTS = "/comments/v1/comments";

// One authenticated JSON call; a non-2xx becomes an Error carrying `status` and the application code,
// the shape posts-core's isNotFound / isPermissionDenied read.
async function call(path: string, init?: RequestInit): Promise<Raw> {
  const res = await wixFetch(path, init);
  if (res.status === 204) return {};
  const json = (await res.json().catch(() => ({}))) as Raw;
  if (!res.ok) {
    throw Object.assign(new Error(json?.message || `${init?.method ?? "GET"} ${path} failed (${res.status}).`), {
      status: res.status,
      code: json?.details?.applicationError?.code,
      details: json?.details,
    });
  }
  return json;
}
const post = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/**
 * One page of top-level comments plus each one's reply seam (cursor, no replies yet).
 * GET /comments/v1/comments/list-by-resource?appId=&contextId=&resourceId=&commentSort.order=&replySort.order=OLDEST_FIRST&cursorPaging.limit=10&cursorPaging.repliesLimit=0[&cursorPaging.cursor=]
 */
export async function fetchComments(o: ListCommentsOptions & { currentMemberId?: string | null }): Promise<CommentPage> {
  const res = await call(`${COMMENTS}/list-by-resource?${new URLSearchParams(listCommentsParams(o))}`);
  const authors = await fetchAuthorsByIds(commentAuthorIds(rawCommentsOf(res)));
  return toCommentPage(res, { authors, currentMemberId: o.currentMemberId ?? null });
}

/**
 * One page of a top-level comment's replies, from the cursor its seam (or a previous page) handed back.
 * GET /comments/v1/comments/list-by-resource?appId=&contextId=&resourceId=&replySort.order=OLDEST_FIRST&cursorPaging.limit=10&cursorPaging.cursor=
 */
export async function fetchReplies(o: { referenceId: string; topLevelId: string; cursor: string; currentMemberId?: string | null }): Promise<CommentThread> {
  const res = await call(`${COMMENTS}/list-by-resource?${new URLSearchParams(listRepliesParams(o))}`);
  const authors = await fetchAuthorsByIds(commentAuthorIds(rawCommentsOf(res)));
  return toCommentThread(res, { authors, currentMemberId: o.currentMemberId ?? null, topLevelId: o.topLevelId });
}

/**
 * Post a comment (or a reply, with `parentId`) as the current identity. Throws — isPermissionDenied(e)
 * means this viewer may not comment here (sign in). The answer may be PENDING when the owner moderates.
 * POST /comments/v1/comments  { comment: { appId, contextId, resourceId, content: { richContent }, parentComment?: { id } } }
 */
export async function createComment(o: CreateCommentOptions & { topLevelId?: string | null; currentMemberId?: string | null }): Promise<BlogComment> {
  const res = await post(COMMENTS, createCommentBody(o));
  const raw: Raw = res?.comment ?? {};
  const authors = await fetchAuthorsByIds(commentAuthorIds([raw]));
  return toComment(raw, { authors, currentMemberId: o.currentMemberId ?? null, topLevelId: o.topLevelId ?? o.parentId ?? null });
}

/** Delete the current member's own comment.  DELETE /comments/v1/comments/{commentId} */
export async function deleteComment(commentId: string): Promise<void> {
  await call(`${COMMENTS}/${encodeURIComponent(commentId)}`, { method: "DELETE" });
}
