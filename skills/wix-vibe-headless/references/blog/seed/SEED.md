# Blog — seeding

Seed a Wix Blog (Blog V3) by **calling `seed-blog.js`** — don't hand-write the REST calls. It's
a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix Blog
seed operation. `require` it and call the functions with plain data.

> **NOT yet live-verified — transcribed from `setup-blog.md`.** Endpoints/fields mirror the recipe
> exactly; if a call returns an unexpected shape, use the **`wix-docs`** skill (never guess).

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const seed = require("/app/.agents/skills/wix-vibe-headless/references/blog/seed/seed-blog.js");
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

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

// imagery ON only: import images per IMAGE_GENERATION.md, then attach covers (PATCH + re-publish)
await seed.attachPostCovers(ctx, posts.map((p, i) => ({ postId: p.id, fileId: fileIds[i] })));
```

## Functions
| fn | does |
|---|---|
| `getAuthorMemberId(ctx)` | STEP 1 — fetch a real member id for author attribution (throws if none) |
| `createPosts(ctx, posts, { memberId })` | STEP 2 — auto single-vs-bulk create, published → `[{id,index,success}]` |
| `createCategories(ctx, names)` | STEP 3 — sequential creates → `[{id,name}]` (feed into `post.categoryIds`) |
| `createTags(ctx, names)` | STEP 3 — sequential creates → `[{id,name}]` (feed into `post.tagIds`) |
| `attachPostCovers(ctx, [{postId,fileId}])` | imagery-on: PATCH cover (`displayed+custom+wixMedia.image.id`) + re-publish |

`content` blocks: `{type:"heading",text,level?}` · `{type:"paragraph",text}` · `{type:"quote",text}` ·
`{type:"bulleted"|"ordered",items:[…]}`. For node types the recipe doesn't cover (code, images),
pass a pre-built Ricos `richContent` on the post instead. No Blog-app install helper — the recipe
assumes Blog is already installed on the site.

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix Blog API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-blog.md`.
