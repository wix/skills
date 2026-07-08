---
name: "How to Create Blog Posts"
description: Creates and publishes blog posts using Blog Posts API. Covers Ricos rich content format, image upload via Media Manager, category/tag assignment, and bulk post creation.
---

**Article: Create and Publish Blog Posts with Rich Content and Images**

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

---

## Description

This article demonstrates how to create and immediately publish blog posts using Wix Blog REST API, including handling external images, rich content formatting, and proper media management workflow.

> **Rich content (Ricos) node shapes live in a shared recipe.** A blog post's `richContent` is a Ricos document. For the full node-shape reference — headings, lists, blockquotes, dividers, tables (with cell fills), code blocks, images, inline text decorations, and the nesting rules — see **[Author Ricos Rich Content](../rich-content/author-ricos-rich-content.md)**. This recipe covers the blog-specific flow (author/member id, image import, endpoints, publish); consult the Ricos recipe for *how to build the body*.

## The Authoring Loop — plan → compose → audit (before you POST)

Always in this order. **Never jump straight to emitting Ricos nodes.** A flat wall of identical paragraphs is what happens when you skip planning. A blog post **inherits the site's theme, fonts, and colors — you do not design the page.** Your craft is **editorial: the structure, the depth, and the right rich-content device for each idea.** Parts 0–3 below are the mechanical steps (auth, media, endpoints); this loop governs the *quality* of what goes into `richContent`.

### Phase 1 — Plan the post before any nodes

Decide, in your own words, *before* composing:

1. **The one takeaway.** What should the reader leave with? State it in a single sentence; every section serves it.
2. **Audience & angle.** Who is this for, and what is the specific angle — how-to, announcement, opinion, deep-dive, listicle? This sets the tone and the depth.
3. **Outline the sections.** List the H2 sections in order as a real arc — hook → body sections → takeaway/CTA — not a generic dump. If the user asked for a post "covering X, Y, and Z," the outline must contain a real section for **each**; never ship one section and a bullet mentioning the rest.
4. **One device per section — and vary them.** For each section, name the rich-content device that best carries it: intro `PARAGRAPH`, `BULLETED_LIST`/`ORDERED_LIST` for steps or criteria, a `TABLE` for comparisons, a `BLOCKQUOTE` for a key quote, an `IMAGE` + caption to break up long stretches, a `CODE_BLOCK` for snippets. **A post where every section is just heading + one paragraph is the generic failure.**
5. **Title & imagery.** Choose a specific, non-generic title (this becomes the post's `title` field). Decide whether a cover image and/or in-body images earn their place.

Write this outline down (section → device) and commit to it before building.

### Phase 2 — Compose with real substance

**Rich-content devices are not a substitute for content.** The recurring failure is beautiful structure wrapped around one-line paragraphs.

- Body paragraphs are **2–4 full sentences (~40–80 words)**. A section is a heading + intro + one or two real paragraphs (or a paragraph + a list) — never a single sentence as the entire section body. One-liners are fine only for captions, labels, or list items.
- Rough content budgets — match what the user asked for: short post ≈ **300–500 words**; standard how-to / listicle ≈ **600–1000 words** across 4+ H2 sections; deep-dive ≈ **1200+ words**.
- **Use 2–3 different devices across the post**, not the same heading+paragraph block repeated. If you catch yourself emitting an identical "heading + one paragraph" for every section, stop and apply the devices you committed to in Phase 1.
- Build the body's node tree per **[Author Ricos Rich Content](../rich-content/author-ricos-rich-content.md)**; the shape examples there use one-line placeholder text — copy their **structure**, never their content density.

### Phase 3 — Self-audit before you POST

Quick checks, all decidable from the JSON (the Ricos recipe's self-audit covers node validity; these are the blog-level ones):

1. **Heading hierarchy** — the post title lives in the `draftPost.title` field, **not** as a body H1; in-body section headers start at `level: 2` and nest logically.
2. **Images** use an **imported Wix Media `id`** (Part 1), never a raw external URL; `width`, `height`, and a meaningful `altText` are set.
3. **Content depth** — no stub sections; every section the brief named is present at the Phase-2 depth.
4. **Ricos validity** — run the node self-audit from the [Author Ricos Rich Content](../rich-content/author-ricos-rich-content.md) recipe (bare-string `type`, TEXT wrapped in PARAGRAPH/HEADING, complete list/table nesting, no `\n` inside `textData.text`).

Then execute Parts 0–3 below to create and publish.

### Part 0: Get an Author/Member ID (Required for 3rd-Party Apps)

**IMPORTANT**: When calling the Blog API as a 3rd-party app (not as the site owner), `draftPost.memberId` is **required**. The API will reject requests with "Missing post owner information" if omitted.

1. Query site members to get a valid member ID using [List Members](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/list-members):

   ```bash
   curl -X GET "https://www.wixapis.com/members/v1/members?fieldsets=PUBLIC&paging.limit=1" \
     -H "Authorization: <AUTH>"
   ```

2. Use the `id` field from the response as `draftPost.memberId` when creating the blog post. This member will be the post author.

   > **Note**: The member ID must belong to an existing site member or collaborator. If the members query returns no results, you may need to create a member first or use the site owner's member ID.

### Part 1: Import External Images to Wix Media Manager

1. Identify external image URLs from user input for cover images and embedded content images.

2. Import each external image using [Import File](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file). This converts external URLs to Wix Media IDs required for blog posts.

   ```bash
   curl -X POST "https://www.wixapis.com/site-media/v1/files/import" \
     -H "Authorization: <AUTH>" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://example.com/image.jpg",
       "mediaType": "IMAGE",
       "displayName": "Cover Image.jpg"
     }'
   ```

   The response will include a `file.id` field. Use this ID in blog post creation. Images with `operationStatus: "PENDING"` can be used immediately.

3. Store the returned file IDs for use in blog post creation.

### Part 2: Create Blog Post with Rich Content

You have two endpoints:
- **Single post:** [Create Draft Post](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/create-draft-post) — `POST https://www.wixapis.com/blog/v3/draft-posts`
- **Multiple posts (preferred for any N ≥ 2):** [Bulk Create Draft Posts](https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/bulk-create-draft-posts) — `POST https://www.wixapis.com/blog/v3/bulk/draft-posts/create`

**Use the bulk endpoint when seeding multiple posts** — one call replaces N single-post calls and avoids the per-call latency of ~25–30 s each.

#### Single-post endpoint

   ```bash
   curl -X POST "https://www.wixapis.com/blog/v3/draft-posts" \
     -H "Authorization: <AUTH>" \
     -H "Content-Type: application/json" \
     -d '{
       "draftPost": {
         "title": "My Blog Post",
         "memberId": "author-member-id",
         "richContent": { /* Ricos JSON — see Author Ricos Rich Content */ },
         "media": {
           "wixMedia": {
             "image": { "id": "mediaId" }
           },
           "displayed": true,
           "custom": true
         }
       },
       "publish": true
     }'
   ```

#### Bulk-create endpoint (preferred for multiple posts)

> **⚠️ Body shape — read this carefully. Each item in `draftPosts` is a FLAT post object: `{title, memberId, richContent, media?, ...}`. Do NOT wrap each item in a `draftPost` field.** Unlike the single-post endpoint (which uses `{draftPost: {...}}` because the request is one post), the bulk endpoint puts each post DIRECTLY inside the `draftPosts` array.

✅ **CORRECT body shape (verified against the live API — returns 200 with `results[].itemMetadata.success: true`):**

   ```json
   {
     "draftPosts": [
       { "title": "First Post",  "memberId": "...", "richContent": { /* … */ } },
       { "title": "Second Post", "memberId": "...", "richContent": { /* … */ } }
     ],
     "publish": true
   }
   ```

❌ **WRONG body shape (returns `400 Bad Request` with `draftPosts[i].title must not be empty` because the API is looking for `draftPosts[i].title` directly and finds it nested under a `draftPost` field):**

   ```json
   {
     "draftPosts": [
       { "draftPost": { "title": "First Post",  "memberId": "...", "richContent": { /* … */ } } },
       { "draftPost": { "title": "Second Post", "memberId": "...", "richContent": { /* … */ } } }
     ],
     "publish": true
   }
   ```

The natural intuition is "the bulk endpoint reuses the single-post `{draftPost: {...}}` envelope, just inside an array" — that's wrong. The bulk endpoint flattens the envelope away because the array IS the envelope. **Use the FLAT shape: `draftPosts[i]` IS the post.**

#### Full bulk-create curl example

   ```bash
   curl -X POST "https://www.wixapis.com/blog/v3/bulk/draft-posts/create" \
     -H "Authorization: <AUTH>" \
     -H "Content-Type: application/json" \
     -d '{
       "draftPosts": [
         {
           "title": "First Post",
           "memberId": "author-member-id",
           "richContent": { /* Ricos JSON — see below */ },
           "media": { "wixMedia": { "image": { "id": "mediaId" } }, "displayed": true, "custom": true }
         },
         {
           "title": "Second Post",
           "memberId": "author-member-id",
           "richContent": { /* Ricos JSON */ }
         }
       ],
       "publish": true
     }'
   ```

   The response body is `{results: [{itemMetadata: {id, originalIndex, success}}, ...]}`. Each result's `itemMetadata` carries the created post id and a `success: boolean` flag — the bulk call returns 200 even if some posts fail; check each `results[i].itemMetadata.success` individually.

   **Common URL-shape mistakes (do not use these — both return 404):**
   - `/blog/v3/draft-posts/bulk` ✗
   - `/blog/v3/draft-posts/bulk-create` ✗
   - The correct path is `/blog/v3/bulk/draft-posts/create` (note: `bulk` is a path segment between `v3` and `draft-posts`, not a suffix on `draft-posts`).

2. Build the `richContent` node tree per **[Author Ricos Rich Content](../rich-content/author-ricos-rich-content.md)** — that recipe is the authoritative reference for every node shape (paragraphs, headings, lists, blockquotes, dividers, tables, code blocks, images), inline text decorations, and the nesting rules. Do not reinvent node shapes here.

3. For embedded images, use an `IMAGE` node whose `image.src.id` is the **imported Wix Media `id`** from Part 1 (never a raw external URL); the full IMAGE node shape lives in the Ricos recipe.

4. Set `publish: true` to immediately publish the post rather than saving as draft.

### Part 3: Handle Categories and Tags (Optional)

1. Resolve category IDs using [List Categories](https://dev.wix.com/docs/api-reference/business-solutions/blog/category/list-categories) if user provides category names.

2. Resolve tag IDs using [Query Tags](https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/query-tags) if user provides tag labels.

3. Include resolved IDs in `categoryIds` and `tagIds` arrays in the draft post object.

### IMPORTANT NOTES:

- Never mock blog posts or media IDs - always use the APIs to import images and create posts
- Always read the full documentation of methods before implementation
- External images MUST be imported via Import File API before use in blog posts - direct external URLs will not work
- For 3rd-party app integrations, `memberId` is mandatory - use the [List Members](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/list-members) API if needed to get member ID
- Use ONLY the file ID (without `wix:image://v1/` prefix) for both cover images and embedded images
- Rich content IMAGE nodes require both `width` and `height` properties in the `image` object
- Images with `"operationStatus": "PENDING"` from import can be used immediately in blog posts
- Set `publish: true` in the request to publish immediately rather than save as draft
- For multiple posts, use Bulk Create Draft Posts API with `draftPosts` array
- Include `fieldsets: ['URL']` to get post URLs in the response
- Handle image import failures gracefully - continue without images if import fails
- Provide meaningful `displayName` values during image import for better organization
- Consider batching image imports when creating multiple posts with many images
- For Ricos node shapes, nesting rules, and the pre-send validation, follow [Author Ricos Rich Content](../rich-content/author-ricos-rich-content.md) — do not duplicate those rules here

### Troubleshooting

| Error                                      | Cause                       | Solution                                                            |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------- |
| "Missing post owner information"           | `memberId` not provided     | Add `draftPost.memberId` - see Part 0 for how to get one            |
| "memberIds ... do not exist"               | Invalid member ID           | Query members first using List Members API to get valid IDs         |
| "Expected a paragraph node but found TEXT" | Invalid Ricos structure     | Fix node nesting per [Author Ricos Rich Content](../rich-content/author-ricos-rich-content.md) |
| Image not displaying                       | Using external URL directly | Import image via Media Manager first, then use the returned file ID |
