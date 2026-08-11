# Blog — seeding

Seed a Wix Blog (Blog V3) by **calling `seed-blog.js`** — don't hand-write the REST calls. It's
a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix Blog
seed operation. `require` it and call the functions with plain data.

> **NOT yet live-verified — transcribed from `setup-blog.md`.** Endpoints/fields mirror the recipe
> exactly; if a call returns an unexpected shape, use the **`wix-docs`** skill (never guess).

**DEFAULT — one call.** `setupBlog(ctx, plan)` runs the whole flow (memberId → categories/tags →
posts → covers), keeping every id in memory. Pass category/tag **names** and it resolves them to
ids internally; a post's `coverImageUrl` is a plain image url that the module imports into Wix Media
for you (Blog binds the cover by the Wix Media file id, not a url).

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const fs = require("fs");
// exec_tool's require can return EMPTY exports for these build-time modules — load the file itself:
const seed = (() => { const m = { exports: {} };
  new Function("module", "exports", "require", fs.readFileSync("/app/.agents/skills/wix-vibe-headless/references/blog/seed/seed-blog.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

const result = await seed.setupBlog(ctx, {
  categories: ["Recipes", "Brewing"],   // optional — names, resolved to ids internally
  posts: [
    { title: "How We Roast Our Beans", category: "Recipes", tags: ["coffee"],
      content: [
        { type: "heading", text: "From farm to cup", level: 2 },
        { type: "paragraph", text: "Every batch starts with beans from a single estate." },
        { type: "quote", text: "Great coffee is grown, not made." },
      ],
      // cover is optional and attached IN this one call. Pass a plain url — the module imports it to
      // Wix Media for you (Blog binds the cover by file id). Use the FINAL https://media.base44.com/...
      // url from the COMPLETED generate_image (it runs in the background while you build — wait for
      // it), never a still-generating /__generating__/<id>.png placeholder.
      coverImageUrl: "https://media.base44.com/…",
    },
  ],
});
// → { posts:[{id,index,success}], categories:[{id,name}], tags:[{id,name}], coversAttached }
// check each posts[].success (bulk returns 200 even on partial failure).
```

**Seeding is additive — never delete or overwrite existing content.** Don't clean up, don't remove
"sample" data, don't reset. Just add.

## Escape hatch — individual functions
Reach for the functions below only when the one-call `setupBlog` doesn't fit (custom ordering,
reusing existing ids). `setupBlog` is built from them, in this order:

```js
const memberId = await seed.getAuthorMemberId(ctx);   // STEP 1 — required for every post create

// STEP 3 (optional): only if the request groups posts (e.g. "Recipes and Brewing sections")
const cats = await seed.createCategories(ctx, ["Recipes", "Brewing"]);

// STEP 2: bulk for postCount >= 2, single endpoint for 1 — handled inside. content = plain blocks.
const posts = await seed.createPosts(ctx, [
  { title: "How We Roast Our Beans", categoryIds: [cats[0].id], content: [
    { type: "heading", text: "From farm to cup", level: 2 },
    { type: "paragraph", text: "Every batch starts with beans from a single estate." },
    { type: "quote", text: "Great coffee is grown, not made." },
  ] },
]);   // → [{ id, index, success }] — check each .success (bulk returns 200 even on partial failure)

// optional — import each url to Wix Media (blog binds by file id), then attach covers (PATCH + re-publish)
const files = await Promise.all(imageUrls.map((u) => seed.importImage(ctx, u)));   // → [{ id, url }]
await seed.attachPostCovers(ctx, posts.map((p, i) => ({ postId: p.id, fileId: files[i].id })));
```

## Functions
| fn | does |
|---|---|
| `setupBlog(ctx, plan)` | **DEFAULT** — one call: memberId → categories/tags → posts → covers; names resolved to ids internally → `{posts,categories,tags,coversAttached}` |
| `getAuthorMemberId(ctx)` | STEP 1 — fetch a real member id for author attribution (throws if none) |
| `createPosts(ctx, posts, { memberId })` | STEP 2 — auto single-vs-bulk create, published → `[{id,index,success}]` |
| `createCategories(ctx, names)` | STEP 3 — sequential creates → `[{id,name}]` (feed into `post.categoryIds`) |
| `createTags(ctx, names)` | STEP 3 — sequential creates → `[{id,name}]` (feed into `post.tagIds`) |
| `importImage(ctx, url)` | import an external url into Wix Media → `{id,url}` (file id + wixstatic url); blog binds the cover by this file id |
| `attachPostCovers(ctx, [{postId,fileId}])` | optional — PATCH cover (`displayed+custom+wixMedia.image.id`) + re-publish; `fileId` MUST be a Wix Media file id from `importImage` |

`content` blocks: `{type:"heading",text,level?}` · `{type:"paragraph",text}` · `{type:"quote",text}` ·
`{type:"bulleted"|"ordered",items:[…]}`. For node types the recipe doesn't cover (code, images),
pass a pre-built Ricos `richContent` on the post instead. `setupBlog` **installs the Wix Blog app
first** (`installBlogApp`, idempotent), so seeding works even if the site doesn't have it yet.

## Reference
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix Blog API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-blog.md`.

Read a method's page before writing its call: it carries the exact body shape, the required
permission scope, and the response envelope.
- Install a Wix app onto the site: https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/install-app.md
- Import an image into Wix Media: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file.md
- Bulk Create Draft Posts: https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/bulk-create-draft-posts.md
- Create Draft Post: https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/create-draft-post.md
- Publish Draft Post: https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/publish-draft-post.md
- Create Category: https://dev.wix.com/docs/api-reference/business-solutions/blog/category/create-category.md
- Create Tag: https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/create-tag.md
- Create Member (post authors): https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/create-member.md
