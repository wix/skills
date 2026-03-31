# Recipe: Seed Initial Blog Posts via MCP

Create 3 on-brand blog posts so the blog has real content on first preview.

> **Required in the discover flow.** When arriving from discover → cli → design → features, MCP tools and discovery context are guaranteed available. Always execute this section — do not skip. A blog with zero posts on first preview is a build failure.
>
> **Skip only for standalone invocations** where the Blog skill is invoked directly AND `mcp__wix-mcp-remote__CallWixSiteAPI` is genuinely unavailable. In that case, the user can create posts manually in the Wix dashboard.

## Step 0: Ensure Blog App Is Installed

Before querying blog data, verify the Blog app is installed:

1. **Probe** — `CallWixSiteAPI: POST /blog/v3/posts/query` with body `{ "query": { "paging": { "limit": 1 } } }`
2. **If the API returns a "REQUIRED_APP_NOT_INSTALLED" error** → install the Wix Blog app:
   ```
   CallWixSiteAPI: POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install
   body: {
     "tenant": { "tenantType": "SITE", "id": "<siteId>" },
     "appInstance": { "appDefId": "14bcded7-0066-7c35-14d7-466cb3f09103", "enabled": true }
   }
   ```
   Then retry the probe query to confirm installation succeeded.
3. **If the probe succeeds** → proceed to Step 1.

---

## Step 1: Get Member ID

Blog posts require a `memberId` (the post author). Fetch the first site member:

```
CallWixSiteAPI: GET /members/v1/members
```

Extract the first member's `_id` from the response. This will be used as the author for all posts.

## Step 2: Design 3 On-Brand Blog Posts

No API call — use discovery context (business type, brand name, tone, industry) to plan 3 posts:

- Titles, summaries, and rich content appropriate for the business
- Content should demonstrate different Ricos node types (paragraphs, headings, code blocks, lists, blockquotes)
- Posts should feel like real content a reader would engage with, not placeholder text

**Post design guidelines by business type:**

| Business Type | Post 1 | Post 2 | Post 3 |
|--------------|--------|--------|--------|
| AI / tech blog | Architecture deep-dive | Practical comparison (X vs Y) | Lessons learned / field report |
| Skincare / beauty | Ingredient science spotlight | Routine guide (morning/evening) | Myth-busting or FAQ |
| Food / restaurant | Behind the recipe | Seasonal menu spotlight | Sourcing / farm-to-table story |
| Fitness / wellness | Training methodology breakdown | Nutrition or recovery guide | Client transformation story |
| Fashion / retail | Trend analysis | Styling guide | Behind the brand / process |
| General business | Industry insight | How-to guide | Company news / milestone |

Adapt titles, tone, and content to match the brand's voice and style.

## Step 2b: Generate Cover Images (Optional)

Follow `../shared/IMAGE_GENERATION.md` (Steps 1–3) to get the API key, generate each image, and import to Wix Media. Save the `file.fileUrl` (file ID, e.g., `9a9cdf_abc123~mv2.png`) — this is needed for the blog post `media` field.

If the user declines to provide a key, skip. Posts will be created without covers.

**Prompt template — blog cover images:**

"Editorial [PHOTOGRAPHY/ILLUSTRATION] for a blog post titled
'[POST TITLE]' about [topic summary]. [BRAND NAME]'s
[BRAND AESTHETIC] visual identity. Color tones drawing from
[BRAND PALETTE COLORS]. [MOOD from brand personality].
Wide format 16:9 composition, no text overlays, no watermarks"

**Attach to post** — include the `media` field in the draft post creation body (Step 3). Use the file ID, not the full URL:

```json
"media": {
  "wixMedia": {
    "image": { "id": "<file-id>" }
  },
  "displayed": true,
  "custom": true
}
```

## Step 3: Create Posts

For each post, call `POST /blog/v3/draft-posts` with `publish: true` to create and immediately publish.

> Include the `media` field only if a cover image was generated in Step 2b. Omit it entirely otherwise.
> The `image.id` value is the file ID from the media import response (e.g., `9a9cdf_abc123~mv2.png`), **not** the full `https://static.wixstatic.com/...` URL.

```
CallWixSiteAPI: POST /blog/v3/draft-posts
body: {
  "draftPost": {
    "title": "<Post Title>",
    "memberId": "<member-id-from-step-1>",
    "media": {
      "wixMedia": {
        "image": { "id": "<file-id-from-step-2b>" }
      },
      "displayed": true,
      "custom": true
    },
    "richContent": {
      "nodes": [
        {
          "type": "HEADING",
          "id": "<unique-id>",
          "nodes": [
            { "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "Section Heading", "decorations": [] } }
          ],
          "headingData": { "level": 2 }
        },
        {
          "type": "PARAGRAPH",
          "id": "<unique-id>",
          "nodes": [
            { "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "Paragraph content here.", "decorations": [] } }
          ],
          "paragraphData": {}
        }
      ]
    }
  },
  "publish": true
}
```

### Ricos JSON Node Reference

Use these node types to build rich, varied content:

| Node Type | Structure | Use For |
|-----------|-----------|---------|
| `PARAGRAPH` | `{ type: "PARAGRAPH", id, nodes: [TEXT], paragraphData: {} }` | Body text |
| `HEADING` | `{ type: "HEADING", id, nodes: [TEXT], headingData: { level: 2 } }` | Section headers (level 2–4) |
| `CODE_BLOCK` | `{ type: "CODE_BLOCK", id, nodes: [TEXT], codeBlockData: { language: "javascript" } }` | Code snippets |
| `BULLETED_LIST` | `{ type: "BULLETED_LIST", id, nodes: [LIST_ITEM] }` | Unordered lists |
| `LIST_ITEM` | `{ type: "LIST_ITEM", id, nodes: [PARAGRAPH] }` | Items inside BULLETED_LIST |
| `BLOCKQUOTE` | `{ type: "BLOCKQUOTE", id, nodes: [PARAGRAPH] }` | Pull quotes, callouts |
| `TEXT` | `{ type: "TEXT", id: "", nodes: [], textData: { text: "...", decorations: [] } }` | Inline text (leaf node inside paragraphs, headings, etc.) |

**Tips:**
- Container nodes (PARAGRAPH, HEADING, etc.) need a unique `id` (use any string, e.g., `"n1"`, `"n2"`). TEXT nodes can use an empty string `""` for `id`.
- TEXT nodes are always leaf nodes inside PARAGRAPH, HEADING, CODE_BLOCK, etc.
- LIST_ITEM nodes contain PARAGRAPH nodes (not TEXT directly)
- Mix at least 3 different node types per post for visual variety
- Create all 3 posts in sequence (one `CallWixSiteAPI` call per post)
- **Best practice:** include all fields (title, content, media) in the initial creation call to avoid needing a re-publish

> **Re-publish after PATCH:** If you update a published post (e.g., adding a cover image via PATCH after creation), it becomes `hasUnpublishedChanges: true`. You must call `POST /blog/v3/draft-posts/{draftPostId}/publish` to re-publish. To avoid this, include media in the initial creation call.

## Step 4: Verify

Query published posts to confirm all 3 exist:

```
CallWixSiteAPI: POST /blog/v3/posts/query
body: {
  "query": {
    "paging": { "limit": 10 }
  }
}
```

Confirm 3 posts are returned. Report post titles to the user.

### Step 5: Log Results

Write to `.wix/features.log.md` (see `../shared/FEATURES_LOG.md` for format):

```markdown
## blog
- Status: complete
- Content: {n} posts published ({post titles})
- Images: {generated (n/n attached) | skipped (user declined) | not attempted}
```
