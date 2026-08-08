# Portfolio — seeding

Seed a Wix Portfolio by **calling `seed-portfolio.js`** — don't hand-write the REST calls. It's
a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix
Portfolio seed operation. `require` it and call the functions with plain data.

**Collections before projects.** A project is assigned to collections by a `collectionIds` array
that Wix does **not** validate — a wrong id silently orphans the project. Create the collections
first, then thread their real ids into each project.

**Seeding is additive — never delete or overwrite existing content.** Don't clean up, don't remove
"sample" data, don't reset. Just add.

**DEFAULT — one call.** `setupPortfolio(ctx, plan)` runs the whole flow in the right order
(collections → projects → items → covers), threading ids in memory. Pass covers/items only when you have them. Drop to the individual functions below only for step-by-step control.

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const fs = require("fs");
// exec_tool's require can return EMPTY exports for these build-time modules — load the file itself:
const seed = (() => { const m = { exports: {} };
  new Function("module", "exports", "require", fs.readFileSync("/app/.agents/skills/wix-vibe-headless/references/portfolio/seed/seed-portfolio.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

const summary = await seed.setupPortfolio(ctx, {
  collections: [
    { title: "Brand Identity", description: "Logo systems and visual identities." },
  ],
  projects: [
    { title: "Northwind Rebrand", description: "Full identity refresh for a logistics firm.",
      collection: "Brand Identity",                    // resolved to that collection's id
      details: [{ label: "Year", text: "2025" }],
      // cover/items are optional and attached IN this one call. Pass plain urls — the module imports
      // them to Wix Media for you (portfolio binds by file id). Use the FINAL https://media.base44.com/...
      // url from the COMPLETED generate_image (it runs in the background while you build — wait for it),
      // never a still-generating /__generating__/<id>.png placeholder.
      coverImageUrl: "https://media.base44.com/…",
      items: [{ sortOrder: 1, title: "Hero", imageUrl: "https://media.base44.com/…" }] },
  ],
});
// summary => { collections:[{id,slug,revision}], projects:[{id,slug,revision}], itemsCreated, coversAttached }
```

## Escape hatch — individual functions
Reach for the functions below only when the one-call `setupPortfolio` doesn't fit (step-by-step
control, partial re-seed). `setupPortfolio` is built from them, in this order:

```js
const collections = await seed.createCollections(ctx, [                                 // STEP 1
  { title: "Brand Identity", description: "Logo systems and visual identities." },
]);
const projects = await seed.createProjects(ctx, [                                       // STEP 2
  { title: "Northwind Rebrand", description: "Full identity refresh for a logistics firm.",
    collectionIds: [collections[0].id], details: [{ label: "Year", text: "2025" }] },
]);

// optional — import each url to Wix Media first (portfolio binds by file id), then attach
const files = await Promise.all(imageUrls.map((u) => seed.importImage(ctx, u)));   // → [{ id, url }]
await seed.attachProjectCovers(ctx, projects.map((p, i) => ({ id: p.id, revision: p.revision, imageId: files[i].id, height: 1024, width: 1024 })));
await seed.attachCollectionCovers(ctx, collections.map((c, i) => ({ id: c.id, revision: c.revision, imageId: files[i].id, height: 1024, width: 1024 })));
await seed.createProjectItems(ctx, [{ projectId: projects[0].id, sortOrder: 1, title: "Hero", imageId: files[0].id, height: 1024, width: 1024 }]);
```

## Functions
| fn | does |
|---|---|
| `setupPortfolio(ctx, plan)` | **DEFAULT** — one call: collections → projects → items → covers; returns `{collections,projects,itemsCreated,coversAttached}` |
| `createCollections(ctx, collections)` | STEP 1 — `[{title,description?,hidden?}]` → `[{id,slug,revision}]` |
| `createProjects(ctx, projects)` | STEP 2 — `[{title,description?,collectionIds,details?,hidden?}]` → `[{id,slug,revision}]` |
| `importImage(ctx, url)` | import an external url into Wix Media → `{id,url}` (file id + wixstatic url); covers + items bind by this file id |
| `attachProjectCovers(ctx, [{id,revision,imageId,height,width}])` | PATCH each project's cover (optional); `imageId` = a Wix Media file id from `importImage` |
| `attachCollectionCovers(ctx, [{id,revision,imageId,height,width}])` | PATCH each collection's cover (optional) |
| `createProjectItems(ctx, [{projectId,sortOrder,title,imageId,height,width}])` | one POST per gallery image (optional) |

`hidden` defaults to `false` (shown) — omit it for visible entities; send `hidden: true` only to
hide. `setupPortfolio` **installs the Wix Portfolio app first** (`installPortfolioApp`, idempotent), so seeding works even if the site doesn't have it yet.

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-portfolio.md`.

**Transcribed from the recipe — NOT yet live-verified.** The endpoints/fields mirror
`setup-portfolio.md`; confirm against a real run or the Wix docs before trusting edge shapes.
