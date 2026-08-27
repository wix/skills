# CMS — seeding

Seed by **running `seed-cms.mjs` with a plan file** — don't hand-write the REST calls.
The script mints its own site token via the Wix CLI (logged-in session + `wix.config.json`
required), installs the Wix Data (CMS) app if needed, resolves every IMAGE value into Wix
Media in one parallel wave, and creates everything in order: per collection — create
(schema + permissions) → bulk-insert items → wire multi-references → verify persistence.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/references/cms/seed/seed-cms.mjs plan.json
```

`plan.json` is plain data — **it IS the site's content model**: the collections, their field
schemas, and the items the pages will render. Write it from the brief. Default to **one or
two content collections with ~3–6 items each** (the seed shows the shape; the owner adds the
rest in the dashboard). Give any collection that gets a detail page a `slug` TEXT field, and
every content item an image on an IMAGE field (a content site without images looks broken).

```json
{
  "collections": [
    {
      "id": "categories", "displayName": "Categories",
      "fields": [{ "key": "name", "type": "TEXT" }],
      "items": [{ "name": "Cakes" }, { "name": "Breads" }]
    },
    {
      "id": "recipes", "displayName": "Recipes",
      "fields": [
        { "key": "title", "type": "TEXT" },
        { "key": "slug", "type": "TEXT" },
        { "key": "summary", "type": "TEXT" },
        { "key": "body", "type": "RICH_TEXT" },
        { "key": "photo", "type": "IMAGE" },
        { "key": "publishDate", "type": "DATE" },
        { "key": "categories", "type": "MULTI_REFERENCE", "referencedCollectionId": "categories" }
      ],
      "items": [
        { "title": "Chocolate Layer Cake", "slug": "chocolate-layer-cake",
          "summary": "Three layers, one ganache.", "body": "<p>Cream the butter…</p>",
          "photo": "https://…", "publishDate": "2026-08-01", "categories": [0] },
        { "title": "Country Sourdough", "slug": "country-sourdough",
          "summary": "A 24-hour loaf.", "body": "<p>Feed the starter…</p>",
          "photo": "https://…", "publishDate": "2026-08-10", "categories": [1] },
        { "title": "Pavlova", "slug": "pavlova",
          "summary": "Crisp shell, soft heart.", "body": "<p>Whip the whites…</p>",
          "photo": "https://…", "publishDate": "2026-08-20", "categories": [0] }
      ]
    }
  ]
}
```

- `id` — the collection id the frontend binds to, verbatim (no namespace; Wix doesn't rename
  it). Item keys must match the field `key`s exactly — the script fails loud on a key the
  schema doesn't have (the API would silently drop it).
- Field `type` — `TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, `DATETIME`, `URL`, `EMAIL`, `IMAGE`,
  `RICH_TEXT` (an HTML string, stored verbatim), `REFERENCE`, `MULTI_REFERENCE`.
- `IMAGE` values — the default is `{ "prompt": "..." }` (AI-generated, ~1 Wix AI credit per
  image, account-billed): brand-contextual — subject, aesthetic/mood, palette, lighting —
  always ending "no text, no watermarks". For an asset the user actually supplied use
  `{ "path": "..." }` (a file on this machine — uploaded to Wix Media) or an https URL string
  (their own hosted URL; verify it with `curl -sI` → 200) — never a stock-photo or guessed URL. Images
  resolve in parallel and never block the seed; a failed image leaves that field unset (the
  item stays text-only).
- `DATE`/`DATETIME` values are ISO strings — the script wraps them as `{ "$date": iso }`.
- References: **order collections so targets come first.** A `REFERENCE` value is the target
  item's index in its collection's `items` array; `MULTI_REFERENCE` is an array of indices
  (set at insert it would be silently dropped — the script wires these via
  `POST /wix-data/v2/bulk/items/insert-references`).
- `permissions` — omit for the **public-read** default
  (`read: ANYONE`, writes `ADMIN`). Other shapes (per action: `ANYONE` › `SITE_MEMBER` ›
  `SITE_MEMBER_AUTHOR` › `ADMIN`):

  | preset | `read` / `insert` / `update` / `remove` | use |
  |---|---|---|
  | public-read (default) | `ANYONE` / `ADMIN` / `ADMIN` / `ADMIN` | admin content, anyone reads |
  | collaborative | `ANYONE` / `ANYONE` / `ANYONE` / `ANYONE` | visitor-written shared board (anonymous, unscoped) |
  | member-private | `SITE_MEMBER_AUTHOR` / `SITE_MEMBER` / `SITE_MEMBER_AUTHOR` / `SITE_MEMBER_AUTHOR` | per-user "my…" rows — **seed it EMPTY** (rows seeded here would be owned by the admin, invisible to members) |
  | member-shared-read-only | `SITE_MEMBER` / `ADMIN` / `ADMIN` / `ADMIN` | gated: any member reads, seed/admin writes |
  | public-wall | `ANYONE` / `SITE_MEMBER` / `SITE_MEMBER_AUTHOR` / `SITE_MEMBER_AUTHOR` | members post, everyone reads |

  `read` is the privacy decision — a public collection's `read` MUST be `ANYONE` or the
  visitor frontend reads **zero items with no error**.

**Seeding is additive — never delete or overwrite existing content** (an existing collection
is left as-is; its items are appended); ask first if a cleanup seems needed.

## Escape hatch — individual functions
`setupCms` composes exported steps — `installDataApp`, `createCollection`, `importImage`,
`bulkInsertItems`, `insertReferences`, `verifyItems`, plus `makeCtx()` — import them only
for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; the
authoritative source recipe is `wix-headless/references/inline-recipes/setup-cms.md`.
Endpoints used: `POST /wix-data/v2/collections` (Create Data Collection),
`POST /wix-data/v2/bulk/items/insert` (Bulk Insert Data Items),
`POST /wix-data/v2/bulk/items/insert-references` (Bulk Insert Data Item References),
`POST /wix-data/v2/items/query` (Query Data Items — the verify step),
`POST /site-media/v1/files/import` (Import File),
`POST /apps-installer-service/v1/app-instance/install` (Install App).
