---
name: "How to Create Blog Posts"
description: Creates and publishes blog posts using Blog Posts API. Covers Ricos rich content format, image upload via Media Manager, category/tag assignment, and bulk post creation.
---

**Article: Create and Publish Blog Posts with Rich Content and Images**

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

---

## Description

This article demonstrates how to create and immediately publish blog posts using Wix Blog REST API, including handling external images, rich content formatting, and proper media management workflow.

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
         "richContent": {
           "nodes": [
             {
               "type": "PARAGRAPH",
               "nodes": [{
                 "type": "TEXT",
                 "textData": {
                   "text": "This is a paragraph with some content.",
                   "decorations": []
                 }
               }],
               "paragraphData": {}
             }
           ]
         },
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

2. Structure rich content using Ricos JSON format. Reference [Ricos documentation](https://dev.wix.com/docs/api-reference/assets/rich-content/ricos-documents/introduction) for complete node structure. Common node types:
   - `PARAGRAPH` for text content
   - `HEADING` for section headers (level 1–6)
   - `IMAGE` for embedded images (requires Wix Media ID)
   - `ORDERED_LIST` and `BULLETED_LIST` for lists
   - `LIST_ITEM` for individual list items
   - `BLOCKQUOTE` for quoted text
   - `DIVIDER` for horizontal rules between sections
   - `TABLE` for structured/tabular data
   - `CODE_BLOCK` for preformatted code

   **Universal rules for every node:**
   - **`type` is always a bare string** — `"type": "PARAGRAPH"`, never an object like `"type": { "type": "PARAGRAPH" }`.
   - Every node carries a `type`, an optional `id`, and (for container nodes) a `nodes` array of children. Node `id`s are optional in create requests — the API generates them; the examples below omit `id` for brevity.
   - **All TEXT nodes MUST be wrapped in a PARAGRAPH (or HEADING) node** — never placed directly inside `BLOCKQUOTE`, `LIST_ITEM`, `TABLE_CELL`, or the root `nodes` array. See the [Nesting rules](#nesting-rules-quick-reference) table below.

   **Correct Ricos structure example:**

   ```json
   {
     "nodes": [
       {
         "type": "PARAGRAPH",
         "nodes": [
           {
             "type": "TEXT",
             "textData": {
               "text": "This is a paragraph with some content.",
               "decorations": []
             }
           }
         ],
         "paragraphData": {}
       }
     ]
   }
   ```

   **Correct BLOCKQUOTE structure:**

   ```json
   {
     "type": "BLOCKQUOTE",
     "nodes": [
       {
         "type": "PARAGRAPH",
         "nodes": [
           {
             "type": "TEXT",
             "textData": { "text": "Quote text here", "decorations": [] }
           }
         ],
         "paragraphData": {}
       }
     ],
     "blockquoteData": { "indentation": 1 }
   }
   ```

   **Correct LIST_ITEM structure:**

   ```json
   {
     "type": "LIST_ITEM",
     "nodes": [
       {
         "type": "PARAGRAPH",
         "nodes": [
           {
             "type": "TEXT",
             "textData": { "text": "List item text", "decorations": [] }
           }
         ],
         "paragraphData": {}
       }
     ]
   }
   ```

   **PARAGRAPH** (the base text container). An empty paragraph — `{ "type": "PARAGRAPH" }` — acts as a vertical spacer. `paragraphData.textStyle.textAlignment` accepts `AUTO`·`LEFT`·`CENTER`·`RIGHT`·`JUSTIFY`:

   ```json
   {
     "type": "PARAGRAPH",
     "nodes": [
       { "type": "TEXT", "textData": { "text": "Body copy.", "decorations": [] } }
     ],
     "paragraphData": { "textStyle": { "textAlignment": "AUTO" } }
   }
   ```

   **HEADING** — same TEXT-in-container shape as PARAGRAPH, with the level (1–6) in `headingData`:

   ```json
   {
     "type": "HEADING",
     "nodes": [
       { "type": "TEXT", "textData": { "text": "Section Title", "decorations": [] } }
     ],
     "headingData": { "level": 2, "textStyle": { "textAlignment": "AUTO" } }
   }
   ```

   **BULLETED_LIST / ORDERED_LIST** — nesting is `LIST → LIST_ITEM → PARAGRAPH → TEXT`. Ordered lists use `orderedListData` in place of `bulletedListData`:

   ```json
   {
     "type": "BULLETED_LIST",
     "nodes": [
       {
         "type": "LIST_ITEM",
         "nodes": [
           {
             "type": "PARAGRAPH",
             "nodes": [
               { "type": "TEXT", "textData": { "text": "First item", "decorations": [] } }
             ]
           }
         ]
       }
     ],
     "bulletedListData": { "indentation": 0 }
   }
   ```

   **DIVIDER** — a standalone horizontal rule (no children). `lineStyle`: `SINGLE`·`DOUBLE`·`DASHED`·`DOTTED`; `width`: `LARGE`·`MEDIUM`·`SMALL`:

   ```json
   {
     "type": "DIVIDER",
     "dividerData": { "lineStyle": "SINGLE", "width": "LARGE", "alignment": "CENTER" }
   }
   ```

   **TABLE** — nesting is `TABLE → TABLE_ROW → TABLE_CELL → PARAGRAPH → TEXT`. `tableData.dimensions.colsWidthRatio` sets relative column widths. Fill a header row or zebra-stripe body rows with `tableCellData.cellStyle.backgroundColor` (a hex string):

   ```json
   {
     "type": "TABLE",
     "nodes": [
       {
         "type": "TABLE_ROW",
         "nodes": [
           {
             "type": "TABLE_CELL",
             "tableCellData": { "cellStyle": { "verticalAlignment": "MIDDLE", "backgroundColor": "#116DFF" }, "borderColors": {} },
             "nodes": [
               { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Header A", "decorations": [] } } ] }
             ]
           },
           {
             "type": "TABLE_CELL",
             "tableCellData": { "cellStyle": { "verticalAlignment": "MIDDLE", "backgroundColor": "#116DFF" }, "borderColors": {} },
             "nodes": [
               { "type": "PARAGRAPH", "nodes": [ { "type": "TEXT", "textData": { "text": "Header B", "decorations": [] } } ] }
             ]
           }
         ]
       }
     ],
     "tableData": { "dimensions": { "colsWidthRatio": [50, 50], "colsMinWidth": [120, 120], "rowsHeight": [47] } }
   }
   ```

   **CODE_BLOCK** — children are TEXT nodes (one per line, or `\n`-joined): `{ "type": "CODE_BLOCK", "nodes": [ ... ], "codeBlockData": { "textStyle": { "textAlignment": "AUTO" } } }`.

3. For embedded images in rich content, use IMAGE nodes with Wix Media IDs:

   ```json
   {
     "type": "IMAGE",
     "nodes": [],
     "imageData": {
       "containerData": {
         "width": { "size": "CONTENT" },
         "alignment": "CENTER"
       },
       "image": {
         "src": { "id": "mediaId" },
         "width": 900,
         "height": 600
       },
       "altText": "Descriptive alt text"
     }
   }
   ```

   An IMAGE may also carry an optional `CAPTION` child: `"nodes": [ { "type": "CAPTION", "nodes": [ { "type": "TEXT", "textData": { "text": "Figure 1", "decorations": [] } } ] } ]`.

4. Apply inline text formatting with the `decorations` array on a TEXT node. Each decoration is an object with a `type` and (for some types) a data field:

   ```json
   {
     "type": "TEXT",
     "textData": {
       "text": "Bold, colored, and linked",
       "decorations": [
         { "type": "BOLD", "fontWeightValue": 700 },
         { "type": "COLOR", "colorData": { "foreground": "#116DFF" } },
         { "type": "LINK", "linkData": { "link": { "url": "https://example.com", "target": "BLANK" } } }
       ]
     }
   }
   ```

   | Decoration | Data field |
   | ------------------------------------------ | ---------------------------------------------------------- |
   | `BOLD`                                     | `fontWeightValue: 700`                                     |
   | `ITALIC`                                   | `italicData: true`                                         |
   | `UNDERLINE`                                | _(none)_                                                   |
   | `STRIKETHROUGH`                            | `strikethroughData: true`                                  |
   | `COLOR`                                    | `colorData: { foreground: "#hex" }` (add `background` for highlight) |
   | `LINK`                                     | `linkData: { link: { url, target: "BLANK" } }`             |
   | `FONT_SIZE`                                | `fontSizeData: { unit: "PX", value: 24 }`                  |

   **Mixed formatting in one paragraph → split into multiple TEXT nodes** (one per style run) inside the same PARAGRAPH. A single TEXT node carries one consistent set of decorations. Use a plain hex string in `foreground` for colors.

5. Set `publish: true` to immediately publish the post rather than saving as draft.

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
- Use appropriate Ricos node types (PARAGRAPH, HEADING, LIST, etc.) for semantic content structure
- Consider batching image imports when creating multiple posts with many images

### CRITICAL RICOS JSON STRUCTURE RULES:

- **NEVER place TEXT nodes directly in BLOCKQUOTE, LIST_ITEM, TABLE_CELL, or other container nodes**
- **ALL TEXT nodes MUST be wrapped in PARAGRAPH nodes within their parent containers**
- **BLOCKQUOTE nodes must contain PARAGRAPH nodes, which contain TEXT nodes**
- **LIST_ITEM nodes must contain PARAGRAPH nodes, which contain TEXT nodes**
- **Failure to follow proper nesting will result in parsing errors: "Expected a paragraph node but found TEXT"**
- **Always validate Ricos structure before sending to ensure TEXT nodes are properly nested**

#### Nesting rules (quick reference)

| Parent | Valid children |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Root `nodes`                         | PARAGRAPH, HEADING, BULLETED_LIST, ORDERED_LIST, BLOCKQUOTE, DIVIDER, IMAGE, TABLE, CODE_BLOCK         |
| PARAGRAPH / HEADING / CODE_BLOCK     | TEXT                                                                                                  |
| BULLETED_LIST / ORDERED_LIST         | LIST_ITEM                                                                                             |
| LIST_ITEM / BLOCKQUOTE               | PARAGRAPH (which then contains TEXT)                                                                  |
| TABLE → TABLE_ROW → TABLE_CELL       | cell contains PARAGRAPH / HEADING / IMAGE                                                              |
| IMAGE                                | CAPTION (optional)                                                                                    |

- TEXT is a **leaf** node — it only ever lives inside PARAGRAPH, HEADING, or CODE_BLOCK; never in the root array or a structural container directly.

### Troubleshooting

| Error                                      | Cause                       | Solution                                                            |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------- |
| "Missing post owner information"           | `memberId` not provided     | Add `draftPost.memberId` - see Part 0 for how to get one            |
| "memberIds ... do not exist"               | Invalid member ID           | Query members first using List Members API to get valid IDs         |
| "Expected a paragraph node but found TEXT" | Invalid Ricos structure     | Wrap TEXT nodes in PARAGRAPH nodes (see structure rules above)      |
| Image not displaying                       | Using external URL directly | Import image via Media Manager first, then use the returned file ID |
