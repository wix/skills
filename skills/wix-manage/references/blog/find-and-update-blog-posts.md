---
name: "Find and Update Blog Posts"
description: Finds a site's live blog posts and changes existing posts and drafts through the Wix Blog REST APIs. Covers looking up published posts by title, publish date, category or tag (including the newest and the first post ever), editing an existing post (adding or changing a sentence, paragraph or link in its text, its cover image, excerpt, categories and tags), publishing a draft, moving a live post back to drafts, and deleting or restoring posts. Use whenever the user names a post that already exists on the blog: to find it, change its content, publish, unpublish or delete it; writing a new post is How to Create Blog Posts.
---

# Find and Update Blog Posts

A blog post has two records with the **same id**:

- the **post**: the live version. [Query Posts](https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts) and [Get Post](https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/get-post) read it. The Posts API is read-only.
- the **draft post**: the editable copy. Every change, including to a live post, goes through the [Draft Posts API](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/introduction) with that id.

So: find the post, then write to `https://www.wixapis.com/blog/v3/draft-posts/{id}` with the `id` you found. All calls are site-level. Body-bearing requests send `Content-Type: application/json`.

## Step 1: Find the post

### Live posts: Query Posts

`POST https://www.wixapis.com/blog/v3/posts/query`

Find one post by its title. `$eq` on `title` matches the whole title and ignores case:

```json
{ "query": { "filter": { "title": "Moon Photography for Beginners" } } }
```

If that returns nothing (the user gave part of the title, or other words), search by words, then keep only the titles that contain every word the user said:

```json
{ "query": { "filter": { "title": { "$contains": "moon photography" } }, "paging": { "limit": 100 } } }
```

`$contains` and `$startsWith` on `title` are word searches, not substring matches: they ignore case and return every title that has a word starting with **any** of the words you send. `"moon photography"` also returns "Moon Festival Recipes" and "Photography Gear", and `"otograph"` returns nothing. Never act on the first result of a word search: keep only the titles that contain every word the user said, and if more than one post is left, list their titles and ask which one. If neither search finds the post, run the same two searches on [Query Draft Posts](#drafts-that-are-not-live-query-draft-posts) before you tell the user it does not exist: the post may be a draft.

Posts published in a period (the user's "last 4 months", "in 2025"): put each bound in its own condition under `$and`. One object with both `$gte` and `$lt` returns `400 Filter must contain single operator`. `firstPublishedDate` is the publish date; `createdDate` cannot be filtered (`400 not declared as filterable`).

```json
{
  "query": {
    "filter": {
      "$and": [
        { "firstPublishedDate": { "$gte": "2026-07-01T00:00:00Z" } },
        { "firstPublishedDate": { "$lt": "2026-11-01T00:00:00Z" } }
      ]
    },
    "sort": [{ "fieldName": "firstPublishedDate", "order": "DESC" }],
    "paging": { "limit": 100 }
  }
}
```

The first post ever: sort ascending and take one. Always send the sort: the default order puts pinned posts first.

```json
{ "query": { "sort": [{ "fieldName": "firstPublishedDate", "order": "ASC" }], "paging": { "limit": 1 } } }
```

The newest post: the same with `"order": "DESC"`. Posts in a category or with a tag: `{ "categoryIds": { "$hasSome": ["<categoryId>"] } }` or `{ "tagIds": { "$hasSome": ["<tagId>"] } }`. To get the ids, see [Categories and tags](#categories-and-tags).

Read from `posts[]`: `id`, `title`, `firstPublishedDate`, `lastPublishedDate`, `excerpt`, `slug`, `categoryIds`, `tagIds`, `media` (cover), `pinned`, `featured`, `hasUnpublishedChanges` (the draft has edits that are not live yet). To get more, add top-level `"fieldsets"` next to `query`: `"CONTENT_TEXT"` (the post's plain text in `contentText`, for example for an SEO check), `"RICH_CONTENT"`, `"SEO"` (`seoData`), `"METRICS"` (views, likes, comments), `"URL"`.

Paging: `paging.limit` is at most 100 (101 returns 400). `pagingMetadata.total` is the number of matches; for the next page, send the same filter and sort with `paging.offset` increased by the limit.

A post you publish appears in Query Posts after a few seconds. To check one post right after a write, read it by id: `GET https://www.wixapis.com/blog/v3/posts/{id}` returns `post`, or 404 when the post is not live. It takes the same fieldsets as query parameters: `?fieldsets=CONTENT_TEXT`.

### Drafts that are not live: Query Draft Posts

`POST https://www.wixapis.com/blog/v3/draft-posts/query` with the same `filter` forms for `title` (`$eq` ignores case; `$startsWith` / `$contains` are word searches as above). It returns `draftPosts[]` with `id`, `title`, `status`, `editedDate`, newest edit first.

```json
{ "query": { "filter": { "title": "Peace Education in Schools" } } }
```

It returns only drafts that are **not live**: drafts never published, and posts moved back to drafts. It does not return live posts, even with `"status": "PUBLISHED"`, which returns an empty list. To list every post and say which are live and which are drafts, run both queries: Query Posts for the live ones, Query Draft Posts for the drafts. Each post appears in only one of the two.

## Step 2: Change a post

Get the draft first: `GET https://www.wixapis.com/blog/v3/draft-posts/{id}?fieldsets=RICH_CONTENT` returns `draftPost` with `memberId` (the post's owner), `richContent.nodes`, `status`, `categoryIds`, `tagIds`, `media`.

Then send the change: [Update Draft Post](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/update-draft-post), `PATCH https://www.wixapis.com/blog/v3/draft-posts/{id}`.

```json
{
  "draftPost": {
    "id": "<post id>",
    "memberId": "<draftPost.memberId>",
    "excerpt": "A short guide to photographing the moon."
  },
  "action": "UPDATE_PUBLISH"
}
```

- **Send only the fields you change.** Fields you leave out keep their values.
- **A field you send replaces its old value as a whole.** `richContent` replaces all the content, so send all of `nodes`, changed. `categoryIds`, `tagIds` and `hashtags` replace the whole list, so send the old ids plus the new ones to add one.
- **`action` decides whether the live post changes.**
  - For a live post (it came from Query Posts, or `draftPost.status` is `PUBLISHED`), send `"action": "UPDATE_PUBLISH"`, and send `draftPost.memberId` with the value from Get Draft Post. Without `memberId`, a call made by an app or API key (not by a site member) returns `400 Missing post owner information` and the live post does not change. Without an `action`, the change is saved in the draft only: the live post stays as it was, and `hasUnpublishedChanges` becomes `true`. The response still reads `"hasUnpublishedChanges": true` right after `UPDATE_PUBLISH`; the live post has the change. Check it with Get Post.
  - If the post's `hasUnpublishedChanges` is `true` before your change, its draft holds edits the user has not published, and `UPDATE_PUBLISH` or Publish Draft Post makes those edits live too. Tell the user, and ask before you publish.
  - For a draft that is not live, leave `action` out. The draft stays a draft. Publish it only if the user asked.
- There is no `revision` field. The last write wins.
- If the user has this post open in the Blog editor now (they gave a link to the post's editor, or that is the page they have open), do not write it through the API: the editor autosaves its own copy and overwrites an API change. Tell them what to change in the editor instead.

### Add text at the end

Take `draftPost.richContent.nodes` and `draftPost.memberId` from Get Draft Post, add the new paragraph as the last element of `nodes`, and send the whole array with the `memberId`. Every element of `nodes` is a node object: the existing nodes go back exactly as you read them (a string or placeholder in the array returns `400 Expected an object`). For a post whose draft has two paragraphs, the body is:

```json
{
  "draftPost": {
    "id": "<post id>",
    "memberId": "<draftPost.memberId>",
    "richContent": {
      "nodes": [
        {
          "type": "PARAGRAPH",
          "id": "",
          "nodes": [{ "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "How to photograph the moon with a basic camera.", "decorations": [] } }],
          "paragraphData": {}
        },
        {
          "type": "PARAGRAPH",
          "id": "",
          "nodes": [{ "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "Use a tripod and a low ISO for sharp shots.", "decorations": [] } }],
          "paragraphData": {}
        },
        {
          "type": "PARAGRAPH",
          "paragraphData": {},
          "nodes": [{ "type": "TEXT", "textData": { "text": "The sentence to add.", "decorations": [] } }]
        }
      ]
    }
  },
  "action": "UPDATE_PUBLISH"
}
```

`action` is a top-level field next to `draftPost`, and it takes the enum names only (`UPDATE`, `UPDATE_PUBLISH`, `UPDATE_REVERT_TO_DRAFT`, ...): `"PUBLISH"` returns `400 action enum must be in [...]`. The update response leaves out `richContent` unless you add `"fieldsets": ["RICH_CONTENT"]` next to `action`; to check the result, read the live post once with `GET https://www.wixapis.com/blog/v3/posts/{id}?fieldsets=CONTENT_TEXT`. This body is complete and verified: send it as shown, with no schema lookup.

TEXT nodes always sit inside a PARAGRAPH (or HEADING) node. For other block types, see [Author Ricos Rich Content](../rich-content/author-ricos-rich-content.md).

### Add a link to existing words

Find the TEXT node whose `textData.text` contains the words. Split it into up to three TEXT nodes (the text before, the words, the text after), each keeping the node's old `decorations`. Add a LINK decoration to the middle one:

```json
{
  "type": "TEXT",
  "textData": {
    "text": "basic camera",
    "decorations": [{ "type": "LINK", "linkData": { "link": { "url": "https://example.com/cameras", "target": "BLANK" } } }]
  }
}
```

Then send all the nodes as in [Add text at the end](#add-text-at-the-end). `"target": "BLANK"` opens the link in a new tab; `"SELF"` opens it in the same tab.

### Cover image

The cover is `media`. The image `id` is a Media Manager file id (for example `abc123_def456~mv2.jpg`). Use an image the site already has, or import an external URL with [Import File](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file) (`POST https://www.wixapis.com/site-media/v1/files/import`, `{ "url": "...", "mediaType": "IMAGE", "displayName": "Cover.jpg" }`, read `file.id`; you can use it while it is still `PENDING`).

```json
{
  "draftPost": {
    "id": "<post id>",
    "memberId": "<draftPost.memberId>",
    "media": { "wixMedia": { "image": { "id": "<file id>" } }, "displayed": true, "custom": true }
  },
  "action": "UPDATE_PUBLISH"
}
```

### Categories and tags

- Categories: `GET https://www.wixapis.com/blog/v3/categories` returns `categories[]` with `id` and `label`. Match the user's name against `label` in your code, ignoring case: the query endpoint's `label` filter is case-sensitive. Create a category only when none matches: `POST https://www.wixapis.com/blog/v3/categories` with `{ "category": { "label": "Astronomy" } }`, read `category.id`. Create Category does not check for duplicates, and a second call with the same label makes a second category.
- Tags: `POST https://www.wixapis.com/blog/v3/tags` with `{ "label": "night sky" }` returns `tag.id`. It returns the existing tag when the label already exists, so you can use it for any tag name.
- Then send the full lists: `"categoryIds": [<old ids>, <new id>]`, `"tagIds": [<old ids>, <new id>]` (at most 10 categories and 30 tags per post).

## Step 3: Publish, unpublish, delete, restore

| The user wants to | Call | Result |
|---|---|---|
| Publish a draft | [Publish Draft Post](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/publish-draft-post): `POST https://www.wixapis.com/blog/v3/draft-posts/{id}/publish`, body `{}` | `postId`, the same id. Also publishes the pending changes of a live post. |
| Take a live post off the blog and keep it as a draft | `PATCH https://www.wixapis.com/blog/v3/draft-posts/{id}` with `{ "draftPost": { "id": "<id>" }, "action": "UPDATE_REVERT_TO_DRAFT" }` | `draftPost.status` is `UNPUBLISHED`; Get Post returns 404. `firstPublishedDate` is kept. |
| Delete a draft that is not live | [Delete Draft Post](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/delete-draft-post): `DELETE https://www.wixapis.com/blog/v3/draft-posts/{id}` | `{}`. The draft goes to the trash. |
| Delete a live post | First `UPDATE_REVERT_TO_DRAFT` (row 2), then `DELETE` (row 3) | The post leaves the blog and goes to the trash. |
| See or restore deleted posts | `GET https://www.wixapis.com/blog/v3/draft-posts/trash-bin` returns `draftPosts[]`; [Restore From Trash Bin](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/restore-from-trash-bin): `POST https://www.wixapis.com/blog/v3/draft-posts/trash-bin/{id}/restore`, body `{}` | The post comes back as an `UNPUBLISHED` draft. Publish it again if it was live. |

Do not send `DELETE` to a live post. The docs say it deletes the post, but it does not take the post off the blog: with no pending changes it returns `404 Entity not found`, and with pending changes it returns 200, but the post stays live. Always revert it to a draft first.

`?permanent=true` on `DELETE` skips the trash, and the post cannot be restored. Use it only when the user says to delete permanently.

## Confirm before you change

- A request that names the post and the change ("publish my draft about peace education", "delete the post Basic Obedience Classes", "add this sentence to the end of my moon post") is the user's confirmation. Act when exactly one post matches, then report what changed.
- Ask first when several posts match, when none matches, when the post has unpublished changes and your change would publish them, before changing more than one post, before replacing text the user has not seen, and before a permanent delete.
- After a write, check it by id, not with a new Query Posts call, which can lag a few seconds. A live post: Get Post (`GET https://www.wixapis.com/blog/v3/posts/{id}`). A draft, or a post you moved back to drafts: `GET https://www.wixapis.com/blog/v3/draft-posts/{id}` (Get Post returns 404 for these). A deleted post: it is in `GET https://www.wixapis.com/blog/v3/draft-posts/trash-bin`.
