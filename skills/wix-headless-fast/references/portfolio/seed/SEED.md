# Portfolio — seeding

Seed by **running `seed-portfolio.mjs` with a plan file** — don't hand-write the REST calls.
The script mints its own site token via the Wix CLI (logged-in session + `wix.config.json`
required), installs the Portfolio app if needed, and creates everything in the right order:
collections first (a project's `collectionIds` are NOT validated — a wrong id silently
orphans the project), then projects, gallery items, and covers.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/references/portfolio/seed/seed-portfolio.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 2 collections × 2 projects
each** (the seed shows the shape; the owner adds the rest in the dashboard) and make them
exercise the UI: every collection and project gets a cover, every project gets 2–3 gallery
`items` (a portfolio without images looks broken), and a couple of projects get `details`
rows (Role, Year, Client…).

```json
{
  "collections": [
    { "title": "Brand Identity", "description": "Logo systems and visual identities.",
      "coverImageUrl": "https://…" },
    { "title": "Editorial", "description": "Print and digital editorial design.",
      "coverImageUrl": "https://…" }
  ],
  "projects": [
    { "title": "Northwind Rebrand", "description": "Full identity refresh for a logistics firm.",
      "collection": "Brand Identity",
      "details": [ { "label": "Role", "text": "Brand & Art Direction" }, { "label": "Year", "text": "2025" } ],
      "coverImageUrl": "https://…",
      "items": [
        { "sortOrder": 1, "title": "Logo system", "imageUrl": "https://…" },
        { "sortOrder": 2, "title": "Stationery", "imageUrl": "https://…" }
      ] },
    { "title": "Harbor Coffee", "description": "Packaging and label suite.",
      "collection": "Brand Identity", "coverImageUrl": "https://…",
      "items": [ { "sortOrder": 1, "title": "Label set", "imageUrl": "https://…" } ] },
    { "title": "Field Notes Quarterly", "description": "Magazine layout and typography.",
      "collection": "Editorial", "coverImageUrl": "https://…",
      "items": [ { "sortOrder": 1, "title": "Spread", "imageUrl": "https://…" } ] },
    { "title": "City Guides", "description": "Travel series covers.",
      "collection": "Editorial", "coverImageUrl": "https://…",
      "items": [ { "sortOrder": 1, "title": "Covers", "imageUrl": "https://…" } ] }
  ]
}
```

- `collection` — a collection **title from this plan**; resolved to its created id. A project
  without one belongs to no collection (reachable only from an all-projects list).
- `details` — optional `[{ label, text }]` rows; render on the project page. Omit for none.
- Every image field takes either a url (`coverImageUrl` / `items[].imageUrl` — a real https
  URL, verified with `curl -sI` → 200 before seeding; imported into Wix Media — Portfolio
  binds by file id, a raw url renders nothing) or a prompt (`coverImagePrompt` /
  `items[].imagePrompt` — AI-generated, **1 Wix AI credit per image**, account-billed):
  brand-contextual — subject, aesthetic/mood, palette, lighting — always ending "no text, no
  watermarks". All images — covers and gallery items alike — resolve in one parallel wave and
  never block the seed; a failed image skips just that item/cover. The **cover** is the
  listing thumbnail; **items** are the detail-page gallery — separate entities, both wanted.
  If a project has only a cover, reuse its url as item 1 so the gallery isn't empty.
- `sortOrder` (1, 2, 3…) sets the gallery render order.
- `hidden` defaults to shown — omit it; send `hidden: true` only to hide an entity.
- Gallery items seed as images only; the owner adds videos in the dashboard.
- A fresh Portfolio install ships sample content ("My Portfolio" + sample projects). **Seeding
  is additive — never delete or overwrite existing content**; if removing the samples seems
  wanted, ask the owner first.

## Escape hatch — individual functions
`setupPortfolio` composes exported steps — `installPortfolioApp`, `createCollections`,
`createProjects`, `importImage`, `attachProjectCovers`, `attachCollectionCovers`,
`createProjectItems`, `listCollections`, `listProjects`, plus `makeCtx()` — import them only
for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; the
authoritative source recipe is `wix-headless/references/inline-recipes/setup-portfolio.md`.
