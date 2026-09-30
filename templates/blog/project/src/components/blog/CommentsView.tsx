// REFERENCE comments surface: the thread (two levels — replies under their top-level comment), a
// form, reply forms, delete on the member's own comments, PENDING and DELETED states, load-more for
// comments and for replies, and the sign-in prompt when the server refuses a guest. Correct and
// complete; per the skill's model you design and build your own on useComments. Mount it only when
// `post.commentingEnabled && post.referenceId` — in Astro as a `client:load` island.
import { useState, type FormEvent } from "react";
import { useComments } from "../../hooks/blog/useComments";
import type { BlogComment } from "../../wix/blog/types";

export interface CommentsViewProps {
  /** `PostDetail.referenceId`. */
  referenceId: string;
  /** Where "sign in" points when the server refuses a guest's comment (omit to show text only). */
  signInHref?: string;
}

function CommentForm({
  onSubmit,
  disabled,
  placeholder,
  submitLabel = "Post",
  onCancel,
}: {
  onSubmit: (text: string) => Promise<unknown>;
  disabled: boolean;
  placeholder: string;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const ok = await onSubmit(text);
    if (ok) setText("");
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={3}
        disabled={disabled}
        className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground"
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-secondary">
            Cancel
          </button>
        )}
        <button type="submit" disabled={disabled || !text.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function CommentBody({ comment }: { comment: BlogComment }) {
  if (comment.status === "DELETED") return <p className="text-sm italic text-muted-foreground">This comment was deleted.</p>;
  return (
    <div className="text-sm">
      {/* Plain text, one <p> per line — never the Ricos viewer here: this island is client:load (SSR'd), and the
          viewer breaks under SSR and drags 2 MB into the server bundle (the post body renders it client:only). */}
      {comment.text.split("\n").filter(Boolean).map((line, i) => (
        <p key={i} className="whitespace-pre-wrap">{line}</p>
      ))}
    </div>
  );
}

function CommentHeader({ comment }: { comment: BlogComment }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {comment.authorAvatarUrl && <img src={comment.authorAvatarUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-full object-cover" />}
      {comment.authorName && <span className="font-medium text-foreground">{comment.authorName}</span>}
      {comment.parentAuthorName && <span>replying to {comment.parentAuthorName}</span>}
      {comment.dateLabel && <time dateTime={comment.dateISO}>{comment.dateLabel}</time>}
      {comment.status === "PENDING" && <span className="rounded bg-secondary px-1.5 py-0.5">Awaiting approval</span>}
    </div>
  );
}

export default function CommentsView({ referenceId, signInHref }: CommentsViewProps) {
  const { comments, replies, hasMore, loadingMore, saving, needsSignIn, sort, error, loadMore, loadReplies, setSort, create, remove } =
    useComments({ referenceId });
  const [replyTo, setReplyTo] = useState<{ parentId: string; topLevelId: string } | null>(null);

  const signIn = needsSignIn && (
    <p className="rounded-lg border border-border bg-secondary p-3 text-sm" role="status">
      {signInHref ? (
        <>
          <a href={signInHref} className="font-medium underline">Sign in</a> to comment on this post.
        </>
      ) : (
        "Sign in to comment on this post."
      )}
    </p>
  );

  return (
    <section aria-label="Comments" className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Comments</h2>
        <label className="text-xs text-muted-foreground">
          Sort{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded border border-border bg-background px-2 py-1 text-xs">
            <option value="NEWEST_FIRST">Newest first</option>
            <option value="OLDEST_FIRST">Oldest first</option>
          </select>
        </label>
      </div>

      <CommentForm onSubmit={(t) => create(t)} disabled={saving} placeholder="Write a comment…" />
      {signIn}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {comments === null ? (
        <div aria-busy="true" className="space-y-3">
          <div className="h-4 w-1/3 animate-pulse rounded bg-secondary" />
          <div className="h-12 animate-pulse rounded bg-secondary" />
        </div>
      ) : comments.length === 0 ? (
        !error && <p className="text-sm text-muted-foreground">Be the first to comment.</p>
      ) : (
        <ul className="space-y-6">
          {comments.map((c) => {
            const thread = replies[c.id];
            const loaded = thread?.comments ?? [];
            const remaining = Math.max(0, c.replyCount - loaded.length);
            return (
              <li key={c.id} className="space-y-3">
                <CommentHeader comment={c} />
                <CommentBody comment={c} />
                <div className="flex gap-3 text-xs">
                  {c.status !== "DELETED" && (
                    <button type="button" onClick={() => setReplyTo({ parentId: c.id, topLevelId: c.id })} className="text-muted-foreground hover:text-foreground">
                      Reply
                    </button>
                  )}
                  {c.isOwn && (
                    <button type="button" onClick={() => remove(c.id)} disabled={saving} className="text-muted-foreground hover:text-destructive disabled:opacity-50">
                      Delete
                    </button>
                  )}
                </div>
                {(loaded.length > 0 || replyTo?.topLevelId === c.id) && (
                  <ul className="ml-6 space-y-4 border-l border-border pl-4">
                    {loaded.map((r) => (
                      <li key={r.id} className="space-y-2">
                        <CommentHeader comment={r} />
                        <CommentBody comment={r} />
                        <div className="flex gap-3 text-xs">
                          {r.status !== "DELETED" && (
                            <button type="button" onClick={() => setReplyTo({ parentId: r.id, topLevelId: c.id })} className="text-muted-foreground hover:text-foreground">
                              Reply
                            </button>
                          )}
                          {r.isOwn && (
                            <button type="button" onClick={() => remove(r.id)} disabled={saving} className="text-muted-foreground hover:text-destructive disabled:opacity-50">
                              Delete
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                    {replyTo?.topLevelId === c.id && (
                      <li>
                        <CommentForm
                          onSubmit={async (t) => {
                            const created = await create(t, { parentId: replyTo.parentId, topLevelId: c.id });
                            if (created) setReplyTo(null);
                            return created;
                          }}
                          disabled={saving}
                          placeholder="Write a reply…"
                          submitLabel="Reply"
                          onCancel={() => setReplyTo(null)}
                        />
                      </li>
                    )}
                  </ul>
                )}
                {(remaining > 0 || thread?.nextCursor) && (
                  <button type="button" onClick={() => loadReplies(c.id)} disabled={thread?.loading} className="ml-6 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
                    {thread?.loading ? "Loading…" : remaining > 0 ? `Show ${remaining} ${remaining === 1 ? "reply" : "replies"}` : "Show more replies"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="text-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="rounded-lg border border-border px-6 py-2.5 text-sm font-medium hover:bg-secondary disabled:opacity-50">
            {loadingMore ? "Loading…" : "Load more comments"}
          </button>
        </div>
      )}
    </section>
  );
}
