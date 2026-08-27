# Portfolio — playbook

The portfolio machinery ships as files — collections, projects, the per-project media gallery
(image AND video items), typed end-to-end. Portfolio is **read-only**: no cart, no checkout,
no `@wix/ecom`. **The presentation is yours**: you design and implement the collection card,
the project card + grid, the project-detail gallery, and the home page on the shipped
hooks/DTOs, plus the brand. You never write read logic; you never skip designing.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source only on a real fallback (runtime error / uncovered field),
or to read a reference component's pattern.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/portfolio/types.ts` | the DTOs (`CollectionSummary`, `ProjectSummary`, `ProjectDetail`, `ProjectDetailRow`, `GalleryItem`) — contracts below |
| `wix/portfolio/portfolio.ts` | `fetchCollections`, `fetchCollectionBySlug`, `fetchProjects`, `fetchProjectBySlug`, `fetchProjectGallery` |
| `hooks/portfolio/useCollections.ts` | collections gallery — contract below |
| `hooks/portfolio/useCollectionProjects.ts` | one collection + its projects, by slug — contract below |
| `hooks/portfolio/useProjectDetail.ts` | one project + its media gallery, by slug — contract below |
| `components/portfolio/CollectionsView.tsx` (+ `CollectionCard`) · `CollectionProjectsView.tsx` (+ `ProjectCard`) · `ProjectDetailView.tsx` (+ `GalleryMedia`) | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If another vertical is also deployed, its layout won — add a Portfolio nav link there |
| `pages/portfolio.astro` | SSR collections gallery — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/portfolio/[slug].astro` | SSR collection page (header + projects) — **keep the frontmatter**, swap the island import |
| `pages/projects/[slug].astro` | SSR project detail + gallery — **keep the frontmatter**, swap the island import. Portfolio has no documented Wix SEO item type, so these pages carry plain `<title>`/`<meta>` from the DTO (no `wixMetadata`/`<SEO.Tags>`) |

## What you build — the design job

1. **The collection card + gallery surface** — your tile (cover, title, description) and
   rhythm, with skeletons while loading and an honest empty state — on `useCollections`.
2. **The project card + collection page** — the collection header and your project grid — on
   `useCollectionProjects` (route a not-found state off `notFound`, never off a transient
   null).
3. **The project-detail surface** — title/description, the `details` rows (text or link, as
   given), and the media gallery: `kind: "image"` → `<img>`; `kind: "video"` → `<video>` with
   `videoUrl` + `imageUrl` as poster; wrap in a link when `linkUrl` is set; empty gallery →
   the project cover when it exists, else an honest empty note — on `useProjectDetail`.
4. **The home page** — hero, featured collections or projects (fetch in frontmatter → your
   components), brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens.

### The contracts your components consume

```ts
// CollectionSummary (tiles): { id, slug, title, description, imageUrl /* "" when none */ }
// ProjectSummary (tiles): { id, slug, title, description, imageUrl /* cover or video poster */,
//   collectionIds: string[] }
// ProjectDetail adds: details: [{ label, text, url|null, target|null /* url set → link row */ }]
// GalleryItem: { id, kind: "image"|"video", title, description,
//   imageUrl /* image, or the video's poster; may be "" */,
//   videoUrl /* video only, else null */, linkUrl|null, linkTarget|null }

// useCollections({ initialCollections? }) →
// { collections: CollectionSummary[]|null /* null = loading → skeletons */, error }

// useCollectionProjects(slug, { initialCollection?, initialProjects? }) →
// { collection: CollectionSummary|null,       // null while loading AND when notFound
//   notFound,                                 // the real 404 signal
//   projects: ProjectSummary[]|null,          // null = loading → skeletons
//   error }

// useProjectDetail(slug, { initialProject?, initialItems? }) →
// { project: ProjectDetail|null, notFound,
//   items: GalleryItem[]|null,                // dashboard order; null = loading
//   error }
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   existing layout instead if another vertical is deployed).
2. Write your components under `src/components/portfolio/` (new names — don't overwrite the
   references), swap the island imports in `pages/portfolio.astro`,
   `pages/portfolio/[slug].astro`, and `pages/projects/[slug].astro`. Islands are
   `client:load` with the SSR props. **Author your surfaces in as few messages as possible** —
   batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/portfolio` → your gallery; `/portfolio/:slug` →
your collection page on `useCollectionProjects(slug)`; `/projects/:slug` → your detail
surface on `useProjectDetail(slug)`.

## Hard rules

- **Reads only through the shipped exports** — they filter `hidden`, sort collections by the
  owner's `sortOrder` (projects have none — list order), and resolve every `wix:image://` /
  `wix:video://` value. Never hand-build a `wixstatic.com` URL, never render a raw media
  string into `src`.
- **This vertical sells nothing** — no cart, no checkout, no `@wix/ecom`/`@wix/redirects`
  imports. A "contact about this project" CTA is a link, not a purchase flow.
- **Route not-found off `notFound`**, and surface `error` — a transient `null` is loading,
  not a 404.
- **Render `details` rows as given** (text or link per row); don't invent metadata.
- **Gallery items branch on `kind`** — an image never gets a `<video>` tag and vice versa;
  nothing renderable → skip the item, never a broken tag.
- Theme via the `@theme` tokens; no parallel theme files, no hardcoded palettes.
- Live data or an honest empty state — never mock collections, projects, or media.

## Point the user to their dashboard

Give the owner the dashboard link — the deploy step's JSON printed `dashboardUrl`; append
`/wix-portfolio/projects` for Portfolio management (Projects and Collections are tabs on that
one page: Projects adds projects and their media galleries; Collections groups them).

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-portfolio.mjs` from the project root.
Seed collections + projects that exercise the UI (covers on everything, 2–3 gallery images
per project, `details` rows on a couple of projects). A fresh install ships sample content —
seeding never deletes it; ask the owner before any cleanup.

## Verify (before declaring done)

- [ ] `/portfolio` renders live collections SSR (view-source shows titles) through YOUR
      components; empty portfolio shows your honest empty state.
- [ ] A collection page lists its projects (and only its); an unknown slug 404s.
- [ ] A project page renders the gallery in order, the `details` rows, and — if any project
      has a video item — a playing `<video>` with poster.
- [ ] Card/grid/detail/home are YOUR designs on the tokens; data-layer/hook files unedited.
- [ ] No `@wix/ecom` import anywhere; no mocked content.
- [ ] Dashboard link handed to the owner.
