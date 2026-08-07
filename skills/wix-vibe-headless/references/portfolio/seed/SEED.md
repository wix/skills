# Portfolio — seeding

Seed a Wix Portfolio by **calling `seed-portfolio.js`** — don't hand-write the REST calls. It's
a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix
Portfolio seed operation. `require` it and call the functions with plain data.

**Collections before projects.** A project is assigned to collections by a `collectionIds` array
that Wix does **not** validate — a wrong id silently orphans the project. Create the collections
first, then thread their real ids into each project.

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const seed = require("/app/.agents/skills/wix-vibe-headless/references/portfolio/seed/seed-portfolio.js");
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// Clean is a JUDGMENT call — never auto-delete. Only remove obvious install samples on a fresh
// install (the "My Portfolio" collection + its sample projects); projects BEFORE collections.
// If what's there could be the owner's real content, ask first (seeding is additive).
const projs = await seed.listProjects(ctx);
// await seed.deleteProjects(ctx, projs.filter(isObviousSample).map(p => p.id));
const cols = await seed.listCollections(ctx);
// await seed.deleteCollections(ctx, cols.filter(isObviousSample).map(c => c.id));

const collections = await seed.createCollections(ctx, [                                 // STEP 1
  { title: "Brand Identity", description: "Logo systems and visual identities." },
]);
const projects = await seed.createProjects(ctx, [                                       // STEP 2
  { title: "Northwind Rebrand", description: "Full identity refresh for a logistics firm.",
    collectionIds: [collections[0].id], details: [{ label: "Year", text: "2025" }] },
]);

// imagery ON only: generate + import images per IMAGE_GENERATION.md, then attach
await seed.attachProjectCovers(ctx, projects.map((p, i) => ({ id: p.id, revision: p.revision, imageId: ids[i], height: 2880, width: 1920 })));
await seed.attachCollectionCovers(ctx, collections.map((c, i) => ({ id: c.id, revision: c.revision, imageId: cids[i], height: 2880, width: 1920 })));
await seed.createProjectItems(ctx, [{ projectId: projects[0].id, sortOrder: 1, title: "Hero", imageId: ids[0], height: 896, width: 1200 }]);
```

## Functions
| fn | does |
|---|---|
| `listProjects(ctx)` | `[{id,title}]` — for the sample-cleanup judgment |
| `deleteProjects(ctx, ids)` | one DELETE per id (no bulk); run before collections |
| `listCollections(ctx)` | `[{id,title}]` |
| `deleteCollections(ctx, ids)` | one DELETE per id (no bulk); run after projects |
| `createCollections(ctx, collections)` | STEP 1 — `[{title,description?,hidden?}]` → `[{id,slug,revision}]` |
| `createProjects(ctx, projects)` | STEP 2 — `[{title,description?,collectionIds,details?,hidden?}]` → `[{id,slug,revision}]` |
| `attachProjectCovers(ctx, [{id,revision,imageId,height,width}])` | PATCH each project's cover (imagery on) |
| `attachCollectionCovers(ctx, [{id,revision,imageId,height,width}])` | PATCH each collection's cover (imagery on) |
| `createProjectItems(ctx, [{projectId,sortOrder,title,imageId,height,width}])` | one POST per gallery image (imagery on) |

`hidden` defaults to `false` (shown) — omit it for visible entities; send `hidden: true` only to
hide. On `428` / `APP_NOT_INSTALLED`, the Setup step was skipped — fail loudly, don't self-install.

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-portfolio.md`.

**Transcribed from the recipe — NOT yet live-verified.** The endpoints/fields mirror
`setup-portfolio.md`; confirm against a real run or the Wix docs before trusting edge shapes.
