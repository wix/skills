---
name: "Setup Blog"
description: Initializes a Wix Blog with Blog V3 — fetches an author memberId, then bulk-creates published posts with Ricos rich content (text-only), and optionally creates + assigns categories/tags. Specifies the *how* (calls + format); how many posts, their topics, and which categories come from the request being fulfilled.
---
**RECIPE**: Business Recipe – Initial Setup for a Wix Blog (Blog V3)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for populating any new Wix site that has the Blog app installed with Blog V3.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial blog content setup.

> **This recipe is the *how*, not the *what*.** What to seed — how many posts, which topics, whether to group them into categories/tags — is determined by the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide quantities or topics.

> **API surfaces:** posts use Blog V3 (`https://www.wixapis.com/blog/v3/...`). The author lookup is the exception — it lives on the Members API (`https://www.wixapis.com/members/v1/members`). Don't mix in any pre-V3 blog endpoints.

---

## Article: Steps for Setting Up a Wix Blog
**YOU MUST** complete all the following steps **in the given order** (1-3), then **Attach images** when `imagery` is on, without skipping any and **without requiring additional user input**.

**⚠️ CRITICAL ORDER REQUIREMENT: Fetch the author `memberId` FIRST — every post create needs it. Create the posts. Categories/tags are optional and only created if the request names them. Covers are added in the **Attach images** step, only when `imagery` is on.**

### STEP 1: Get an author `memberId` (required for 3rd-party callers)

When calling the Blog API as a 3rd-party app (headless, not the site owner in the dashboard), every post create needs `memberId` — the post's author. Omitting it fails with `"Missing post owner information"`.

**⚠️ `memberId` is *author attribution*, not the caller.** Two identities are in play and they are NOT the same: the **caller** is the **APP** (your admin/CLI token — `CreateDraftPost` is an admin-only method, `applicableIdentities: [APP]`), while `memberId` is a **body field** meaning *"the draft post owner's member ID"* — whom to credit as author. The dashboard supplies the author implicitly (the logged-in human); a headless APP token isn't a person, so it must **name** one — that's the whole reason for this lookup. Consequence: this does **not** mean a logged-in member can author posts from their own session — every draft-post write/query method is APP-only. (Member-native blog features are **likes** and **comments**; see `how-to-code-a-blog.md`.)

List the first site member and keep its id:

```bash
curl -sS -X GET "https://www.wixapis.com/members/v1/members?fieldsets=PUBLIC&paging.limit=1" \
  -H "Authorization: <AUTH>"
```

Read `members[0].id` (a.k.a. `_id`) from the response — that's the `memberId` you pass to every post in Step 2.

**⚠️ CRITICAL: the `memberId` must belong to a real site member/collaborator** — never fabricate one (a made-up id fails the create with `"memberIds ... do not exist"`). A provisioned site normally has the owner as a member, so this GET returns at least one id. **If the list comes back empty**, the documented fallback is to **create a member first** (find the Members API create method via `DOC_DISCOVERY.md` — don't guess its URL/body) and use that id, or use the site owner's member id. Only if neither is possible, **fail loudly** with the empty-members response.

### STEP 2: Bulk-create the posts (published, with Ricos content)

Create the posts in a **single bulk request** to `POST https://www.wixapis.com/blog/v3/bulk/draft-posts/create` with `"publish": true` so they go live immediately. **How many posts and their topics are set by the request you're fulfilling — this step only gives the call and the required format.** Each post is **text-only** (no cover image — imagery is attached later in the dedicated images step only when `imagery` is on; `SEED.md` § "Entity images").

> **Use the bulk endpoint whenever `postCount ≥ 2`** — one call replaces N single-post calls, each of which costs ~25–30 s of latency. For exactly one post, use the single-post endpoint shown at the end of this step.

**⚠️ CRITICAL: the correct URL is `/blog/v3/bulk/draft-posts/create`** — `bulk` is a path segment **between** `v3` and `draft-posts`, not a suffix. Both `/blog/v3/draft-posts/bulk` and `/blog/v3/draft-posts/bulk-create` return **404**.

**⚠️ CRITICAL: each item in `draftPosts` is a FLAT post object — do NOT wrap it in a `draftPost` field.** The single-post endpoint uses the `{ "draftPost": {…} }` envelope because the request *is* one post; the bulk endpoint flattens that envelope away because the array itself is the envelope. Wrapping each item in `draftPost` returns `400 "draftPosts[i].title must not be empty"` (the API looks for `draftPosts[i].title` directly and finds it nested). Put `title` / `memberId` / `richContent` **directly** inside each array element.

**Request body shape** (one representative post shown — repeat post objects inside the `draftPosts` array):

```json
{
  "draftPosts": [
    {
      "title": "How We Roast Our Single-Origin Beans",
      "memberId": "<memberId-from-step-1>",
      "richContent": {
        "nodes": [
          {
            "type": "HEADING",
            "id": "n1",
            "nodes": [
              { "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "From farm to cup", "decorations": [] } }
            ],
            "headingData": { "level": 2 }
          },
          {
            "type": "PARAGRAPH",
            "id": "n2",
            "nodes": [
              { "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "Every batch starts with beans sourced from a single estate.", "decorations": [] } }
            ],
            "paragraphData": {}
          },
          {
            "type": "BLOCKQUOTE",
            "id": "n3",
            "nodes": [
              {
                "type": "PARAGRAPH",
                "id": "n4",
                "nodes": [
                  { "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "Great coffee is grown, not made.", "decorations": [] } }
                ],
                "paragraphData": {}
              }
            ],
            "blockquoteData": { "indentation": 1 }
          }
        ]
      }
    }
  ],
  "publish": true
}
```

**⚠️ CRITICAL RICOS NESTING — `richContent` is Ricos JSON, not a string or HTML.** A plain string or an HTML blob is rejected. Build a `{ "nodes": [...] }` tree following these rules, or you get `"Expected a paragraph node but found TEXT"`:
- **`TEXT` is always a leaf** inside a container — never a direct child of `BLOCKQUOTE`, `LIST_ITEM`, `CODE_BLOCK`, or the root.
- **`BLOCKQUOTE` and `LIST_ITEM` contain `PARAGRAPH` nodes**, which then contain the `TEXT`.
- **`BULLETED_LIST` / `ORDERED_LIST` contain `LIST_ITEM` nodes**, which contain `PARAGRAPH` → `TEXT`.
- **Container nodes (`PARAGRAPH`, `HEADING`, `BLOCKQUOTE`, …) need a unique `id`** (any string, e.g. `"n1"`, `"n2"`); `TEXT` leaves may use `"id": ""`.
- Common node types: `PARAGRAPH` (body), `HEADING` (`headingData.level` 2–4), `CODE_BLOCK` (`codeBlockData.language`), `BULLETED_LIST`/`ORDERED_LIST` + `LIST_ITEM`, `BLOCKQUOTE`. Mix at least a few per post for visual variety.

**⚠️ CRITICAL: omit `media` — seed text-only.** Cover/inline images are attached in the dedicated **Attach images** step **only when `imagery` is on** (`SEED.md` § "Entity images"). Do not pass external image URLs into `media` or `richContent` `IMAGE` nodes here — external URLs don't work directly (they must first be imported to Wix Media), and imagery is opt-in.

**⚠️ Reading the response — bulk results carry only ids, not slugs.** A successful bulk create returns `200` with:

```json
{ "results": [
  { "itemMetadata": { "id": "<postId>", "originalIndex": 0, "success": true } }
] }
```

The bulk call returns `200` **even if some items fail** — check each `results[i].itemMetadata.success` individually; it does **not** throw on partial failure. If part of the batch fails, retry **only the failed items** **once** with the exact same format; do not loop. (You need only confirm each post was created — the frontend links posts by **slug read from a live `queryPosts` result / the URL**, so there's no need to collect slugs at seed time.)

**⚠️ CRITICAL: a transient `401 "No identity found"` on draft-post creation is a known server-side async-identity defect, NOT a body error.** It is not caused by your token or payload (categories/members/CMS calls succeed with the same token). If you hit it, **retry the create once**; do not rewrite the body and do not retry-spiral — a spiralling retry is a wasted headless run.

#### Single-post endpoint (only when `postCount = 1`)

`POST https://www.wixapis.com/blog/v3/draft-posts` with the **nested** envelope and `publish: true`:

```json
{
  "draftPost": {
    "title": "How We Roast Our Single-Origin Beans",
    "memberId": "<memberId-from-step-1>",
    "richContent": { "nodes": [ /* same Ricos tree as above */ ] }
  },
  "publish": true
}
```

### STEP 3: Group posts into categories / tags (optional — only if the request names them)

Only create categories or tags **if the request explicitly groups the posts** (e.g. "a blog with Recipes and Brewing-Tips sections"). If it doesn't, **create none** — skip this step entirely (skill policy; overrides any docs default).

- **Categories:** `POST https://www.wixapis.com/blog/v3/categories` per category; keep each returned category `id`.
- **Tags:** `POST https://www.wixapis.com/blog/v3/tags` per tag; keep each returned tag `id`.
- **Assign:** include the resolved ids in each post's `categoryIds` / `tagIds` array — set them **in the Step-2 create body** when you already know the grouping, or PATCH the post afterward via **`PATCH https://www.wixapis.com/blog/v3/draft-posts/{draftPostId}`** (body wrapped in `draftPost`). **⚠️ NOT `POST …/draft-posts/{id}/update`** — that path 404s for a single post; `/update` exists only as the bulk method.

**⚠️ CRITICAL: re-publish after any PATCH.** Updating an already-published post sets `hasUnpublishedChanges: true` — the live site keeps showing the old version until you call `POST https://www.wixapis.com/blog/v3/draft-posts/{draftPostId}/publish` again. (Seeding categoryIds/tagIds directly in the Step-2 create body avoids this round-trip.)

> **Comments (a Required site feature, conditional).** If the request's blog needs reader comments, comments are typically available once the Blog app is installed — record it as **available** so the Handoff tells the host to surface the comment UI (the coding recipe wires read-public / write-authenticated). Only if comments are off by default for this site, enable the feature — find the check/enable method via `DOC_DISCOVERY.md` — before relying on it. Don't seed comment *content*.

### Attach images (imagery ON only)

**Runs only when `imagery` is on** (`SEED.md` § "Entity images"). If imagery is off, **skip this step entirely** — the posts were seeded text-only in the bulk-create step and stay that way. This is the pass-2 "attach the image" step for blog posts (the create is pass-1, text-first).

For each post that should get a cover:

1. **Generate + import** per `references/IMAGE_GENERATION.md` (§1 Generate, §2 Import). From the imported `file` object keep **`file.id`** — the WixMedia file id (e.g. `<hash>~mv2.jpg`). Blog binds the cover **by this id** (not by `file.url`).
2. **Attach the cover** via **`PATCH https://www.wixapis.com/blog/v3/draft-posts/{draftPostId}`** (body wrapped in a `draftPost` object), writing the cover under `media`:

   ```json
   { "draftPost": { "media": { "displayed": true, "custom": true, "wixMedia": { "image": { "id": "<file.id>" } } } } }
   ```

   **⚠️ CRITICAL: the endpoint is `PATCH …/draft-posts/{draftPostId}` — NOT `POST …/draft-posts/{draftPostId}/update`.** The `/update` path **404s** for a single post (it exists only as the *bulk* update method); use the bare `PATCH` on the id.
   **⚠️ CRITICAL: `media.wixMedia.image.id` ALONE is a silent no-op.** The PATCH returns `200` but the response comes back `media: { "displayed": false, "custom": false }` with no `wixMedia`, and **no cover attaches**. You MUST also set **`media.displayed: true`** and **`media.custom: true`** for the cover to persist. A `200` is therefore **not** proof — re-query the post's `media` and confirm `wixMedia.image` populated.
3. **⚠️ Re-publish after the PATCH.** Updating an already-published post sets `hasUnpublishedChanges: true` / unpublishes it, so the live site keeps showing the old cover-less version until you call `POST https://www.wixapis.com/blog/v3/draft-posts/{draftPostId}/publish` again. (Same re-publish rule as the categories/tags step — don't let the two drift.)

**Never block the run on image failure** — on a generation/import/attach failure, skip that cover and leave the post text-only (`IMAGE_GENERATION.md` § "Never block the run on image failure").

---

## Conclusion
Following these steps **in order** populates a new Blog V3 site:
- Every post is authored by a **real `memberId`** (fetched first) and created **`publish: true`**, so it appears live immediately.
- Posts carry valid **Ricos `richContent`** (correct `TEXT`-in-`PARAGRAPH` nesting), in the count and on the topics called for by the request.
- The **bulk** endpoint is used for `postCount ≥ 2` (flat per-item shape), the single endpoint for one post.
- Posts are seeded **text-only**; covers are attached by the **Attach images** step, only when `imagery` is on (`PATCH …/draft-posts/{id}` with `media.wixMedia.image.id = file.id` **plus `media.displayed:true` + `media.custom:true`**, then re-publish), otherwise they stay text-only.
- Categories/tags exist **only if** the request named them, with posts assigned and re-published after any PATCH.
- Posts are then discovered **live** by the frontend (`queryPosts`, `[...slug]` routes) — no per-post ids/slugs need to be carried into the coding handoff.
