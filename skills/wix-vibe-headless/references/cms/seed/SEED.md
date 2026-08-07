# CMS — seeding

Seed Wix CMS (Wix Data v2) collections by **calling `seed-cms.js`** — don't hand-write the REST
calls. It's a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every
Wix Data seed operation. `require` it and call the functions with plain data.

> **NOT yet live-verified — transcribed from `setup-cms.md`.**

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const seed = require("/app/.agents/skills/wix-vibe-headless/references/cms/seed/seed-cms.js");
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

await seed.installCmsApp(ctx);                          // if a data call returns WDE0110 (app not installed)

// STEP 1 — create each collection BEFORE inserting its items. Public-read is the default (a headless
// visitor reads but can't elevate). Which collections/fields/counts come from the request, not this module.
const col = await seed.createCollection(ctx, {
  id: "team-members", displayName: "Team Members",
  fields: [
    { key: "name", displayName: "Name", type: "TEXT" },
    { key: "bio",  displayName: "Bio",  type: "RICH_TEXT" },
    { key: "order", displayName: "Order", type: "NUMBER" },
  ],
  // permissions defaults to PERMISSIONS.publicRead; override for the other shapes:
  //   PERMISSIONS.collaborative        (visitor-writable shared board — anonymous, unscoped)
  //   PERMISSIONS.memberPrivate        (per-user-private "my …" rows; seed EMPTY, members populate)
  //   PERMISSIONS.memberSharedReadOnly (gated: any member reads, only seed/admin writes)
});

// STEP 2 — bulk-insert with plain fields only (MULTI_REFERENCE is silently dropped at insert)
const items = await seed.bulkInsertItems(ctx, "team-members", [
  { name: "Ada Lovelace", role: "Founder",  bio: "<p>Builds the things.</p>", order: 1 },
  { name: "Alan Turing",  role: "Engineer", bio: "<p>Breaks the things.</p>", order: 2 },
]);

// STEP 3 — verify persisted (a POST without an error does NOT prove content persisted)
const rows = await seed.queryItems(ctx, "team-members");

// STEP 4 — wire multi-references only if collections relate (target field needs referencedCollectionId from STEP 1)
await seed.insertReferences(ctx, "recipes", [
  { referringItemFieldName: "categories", referringItemId: recipeId, referencedItemId: categoryId },
]);

// imagery ON only: generate per IMAGE_GENERATION.md, then read-merge-PUT the url onto the item's IMAGE field
await seed.attachItemImage(ctx, "team-members", { itemId: items[0].id, imageFieldKey: "photo", url: fileUrl });
```

## Functions
| fn | does |
|---|---|
| `installCmsApp(ctx)` | install the Wix Data (CMS) app on the site |
| `createCollection(ctx, {id, displayName, fields, permissions?})` | STEP 1 — create one collection → the created collection (default `PERMISSIONS.publicRead`) |
| `bulkInsertItems(ctx, collectionId, items)` | STEP 2 — one bulk insert of plain-field items → `[{id,data}]` |
| `insertItem(ctx, collectionId, data)` | STEP 2 (single) — insert one item → `{id,data}` |
| `queryItems(ctx, collectionId)` | STEP 3 — query for verification → `[{id,data}]` |
| `insertReferences(ctx, collectionId, [{referringItemFieldName, referringItemId, referencedItemId}])` | STEP 4 — wire multi-references |
| `attachItemImage(ctx, collectionId, {itemId, imageFieldKey, url})` | imagery ON only — read-merge-PUT the image url onto an item |
| `PERMISSIONS` | preset blocks: `publicRead`, `collaborative`, `memberPrivate`, `memberSharedReadOnly` |

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-cms.md`.
