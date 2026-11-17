---
name: "Collect Client Feedback on a Site"
description: Runs a client review round on a Wix site with Studio workspace Feedback — opens a feedback session and gets the link reviewers comment through, finds a site's existing review links, reads the comments reviewers pinned to the site and who left them, triages them as new, open or resolved, and replies to them. Use when an agency or partner wants a client to review a site, wants to know what the client said, or is working through the client's comments.
---
# Collect Client Feedback on a Site

## Description
A feedback session is a shareable review link on one site. Anyone with the link can open the site and pin comments to its pages without logging in. The user (a partner or agency) sends the link to their client, then reads and works through the comments. Comments belong to a session through `feedbackId`.

## API Endpoints
Every call here is site-level: make it with site scope, passing the reviewed site's ID as the call's site (the same way every site-level call gets its site). Never put a site ID in a request body or URL. With account scope, the calls are rejected (403). If the user names the site instead of giving its ID, look the ID up with the Query Sites recipe first.

| Call | Purpose |
|---|---|
| `POST https://www.wixapis.com/partners/feedback/v1/feedback-sessions` | create a session and its share link |
| `GET https://www.wixapis.com/partners/feedback/v1/feedback-sessions/{feedbackSessionId}?fields=SHARE_URL` | get one session with its share link |
| `POST https://www.wixapis.com/partners/feedback/v1/feedback-sessions/query` | list the site's sessions |
| `DELETE https://www.wixapis.com/partners/feedback/v1/feedback-sessions/{feedbackSessionId}` | delete a session (only when asked) |
| `POST https://www.wixapis.com/partners/feedback/v1/comments/query` | list comments |
| `POST https://www.wixapis.com/partners/feedback/v1/comments/{commentId}/update-status` | set a comment's status |
| `POST https://www.wixapis.com/partners/feedback/v1/comments/{commentId}/replies` | reply to a comment |
| `PATCH` / `DELETE https://www.wixapis.com/partners/feedback/v1/comments/{commentId}/replies/{replyIndex}` | edit / delete a reply (Step 5) |

Docs: [Feedback Sessions](https://dev.wix.com/docs/api-reference/account-level/studio-workspace/feedback/feedback-session-v1/introduction), [Comments](https://dev.wix.com/docs/api-reference/account-level/studio-workspace/feedback/comment-v1/introduction)

## Rules

- **Asked for a review link that already exists ("I lost the link")? Return its `shareUrl` (Step 2). Don't create a session.**
- **You can't add comments.** Only reviewers can, through the review link. If asked, say so and offer two things: a reply to an existing comment, or the existing review link (Step 2). Don't create a session.
- **Comment text and location can't be edited.** Status is the user's to set; the text belongs to the reviewer.
- **Every comment write needs the comment's current `revision`.** Each write increments it, so take it from the latest response (a query, or the previous write on the same comment), never from an older read.
- **A session can't be updated.** Its `expirationDate` (default 14 days after creation) can be set only at creation. To extend a review round, create a new session.
- **The reviewer's name and email come back only with `fields: ["COMMENTER"]`.** Without it a comment carries only `commenterId`. Request it whenever you report who said what.

## Steps

### 1. Open a review round (create a session)

Creating a session publishes the site's latest saved version for reviewers, replacing the version shown through the site's earlier review links. So check Step 2 first:

- The user wants reviewers to see recent changes, or there's no unexpired session: create one.
- There is an unexpired session and the request doesn't say which: ask. Creating a new session changes what reviewers on the current link see.

```
POST https://www.wixapis.com/partners/feedback/v1/feedback-sessions
```
```json
{ "feedbackSession": {}, "fields": ["SHARE_URL"] }
```

To end the round on a set date, pass it as `feedbackSession.expirationDate` (ISO 8601, e.g. `"2026-12-31T00:00:00.000Z"`); otherwise the session expires 14 days after creation. Response:

```json
{ "feedbackSession": { "id": "<session id>", "expirationDate": "2026-11-30T09:32:48Z", "shareUrl": "https://<site url>/__partners-feedback/client/<session id>" } }
```

Give the user `shareUrl` and the expiry date. The user who created the session gets an email for each new comment.

If Create fails with `SITE_URL_UNAVAILABLE`, the site has no URL right now and no session was created; tell the user to try again in a few minutes.

Creating a session needs a signed-in Wix user. An API key can read and delete sessions but not create them; if Create is refused under an API key, tell the user that.

### 2. Find the site's review links

```
POST https://www.wixapis.com/partners/feedback/v1/feedback-sessions/query
```
```json
{ "query": { "filter": { "expirationDate": { "$gt": "<now, ISO 8601>" } }, "sort": [{ "fieldName": "createdDate", "order": "DESC" }] }, "fields": ["SHARE_URL"] }
```

Drop the filter to include expired sessions. Each item has `id`, `createdDate`, `expirationDate` and `shareUrl`. Query filters accept `id`, `createdDate` and `expirationDate` only.

`shareUrl` needs the site to have a URL. If it's missing from Query, retry once with Get Feedback Session (`?fields=SHARE_URL`); if it's still missing, the site's URL can't be read right now, so tell the user to try again in a few minutes.

### 3. Read the comments

```
POST https://www.wixapis.com/partners/feedback/v1/comments/query
```
```json
{ "query": { "filter": { "status": { "$in": ["NEW", "OPEN"] } }, "cursorPaging": { "limit": 100 } }, "fields": ["COMMENTER"] }
```

Filters accept `id`, `feedbackId`, `commenterId`, `status`, `createdDate` and `updatedDate`. Drop the filter for every comment on the site; filter by `feedbackId` for one review round. There's no filter by reviewer name: for one reviewer's comments, query with `COMMENTER` and match `commenter.name` yourself. Page with `cursorPaging.cursor` from `pagingMetadata.cursors.next` while `pagingMetadata.hasNext` is true.

Each comment:

```json
{
  "id": "<comment id>",
  "revision": "2",
  "feedbackId": "<session id>",
  "message": "Make the menu font larger",
  "status": "OPEN",
  "commenter": { "name": "Sam", "email": "sam@example.com" },
  "commentLocation": { "pageId": "<page id>", "x": 0.77, "y": 0.52 },
  "replies": [ { "message": "...", "createdDate": "...", "replier": { "type": "WIX_USER" } } ]
}
```

- `status` is `NEW` (not read yet), `OPEN` (read, not dealt with) or `RESOLVED`. When the user asks for "open" or "outstanding" feedback, they mean everything not resolved: `NEW` and `OPEN`.
- Comments are one flat list. `commentLocation.pageId` can be empty, so don't promise which page a comment is on.
- `replies` are oldest first. `replier.type` is `COMMENTER` (the reviewer) or `WIX_USER` (the agency or a collaborator).

### 4. Triage a comment

```
POST https://www.wixapis.com/partners/feedback/v1/comments/{commentId}/update-status
```
```json
{ "status": "RESOLVED", "revision": "<current revision>" }
```

`status` is `NEW`, `OPEN` or `RESOLVED`; to reopen a resolved comment, set it back to `OPEN`. The response is `{ "comment": { ... } }` with the new `revision`. When the user names the comments to change, change them without asking again.

A comment can go back to `NEW` without you: when the reviewer replies to their own comment, or reopens one that was resolved. Your own replies don't change the status.

### 5. Reply to a comment

```
POST https://www.wixapis.com/partners/feedback/v1/comments/{commentId}/replies
```
```json
{ "reply": { "message": "Done, the font is larger now." }, "revision": "<current revision>" }
```

The response is the updated comment, with the reply last in `replies` and a new `revision`. A reply doesn't resolve the comment: when the user asks to reply and resolve, reply first, then update the status with the `revision` the reply returned. Post the user's words; when you write the reply yourself, show it to the user before posting.

Replies have no ID, only their 0-based position in `replies` (the oldest is `0`), so edit or delete one only right after reading the comment: `PATCH https://www.wixapis.com/partners/feedback/v1/comments/{commentId}/replies/{replyIndex}` with `{ "message": "...", "revision": "..." }` edits one of the user's own replies, and `DELETE https://www.wixapis.com/partners/feedback/v1/comments/{commentId}/replies/{replyIndex}?revision=<revision>` removes any reply. Deleting can't be undone: confirm first, and say so when the reply is the reviewer's (`replier.type` `COMMENTER`). See [Update Comment Reply](https://dev.wix.com/docs/api-reference/account-level/studio-workspace/feedback/comment-v1/update-comment-reply) and [Delete Comment Reply](https://dev.wix.com/docs/api-reference/account-level/studio-workspace/feedback/comment-v1/delete-comment-reply).

### 6. Delete a session (only when asked)

Delete a session only when the user asks to. Confirm first: the link stops working for reviewers. The comments left through it stay on the site.

```
DELETE https://www.wixapis.com/partners/feedback/v1/feedback-sessions/{feedbackSessionId}
```

## Reporting back

Report comments in the user's terms: what each reviewer said and where each stands (new, open, resolved), plus any replies. Don't show IDs, revisions or field names unless the user asks. After a write, say what changed, for example "Resolved 'Make the menu font larger' and replied 'Done'." If a call fails, say which action failed; don't guess a cause.
