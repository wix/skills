# Portfolio — playbook

The portfolio machinery ships as files — collections, projects, the per-project media gallery
(image AND video items), the state machines behind every surface, typed end-to-end. Portfolio is
**read-only**: no cart, no checkout, no `@wix/ecom`. **The presentation is yours**: you design and
implement the collection card, the project card + grid, the project-detail gallery, and the home
page on the shipped hooks/DTOs, plus the brand. You never write read logic; you never skip designing.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the three
pages' island imports. Files you **create**: your gallery, collection, and project-detail islands
(skeletons below), plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes, ratio?)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(c.imageUrl, "33vw", 0.75)} alt={c.title} />`; `imgSrc()` / `imgSrcSet()` underneath, already used by everything shipped |
| `wix/portfolio/types.ts` | the DTOs (`CollectionSummary`, `ProjectSummary`, `ProjectDetail`, `ProjectDetailRow`, `GalleryItem`) — contracts inlined below |
| `wix/portfolio/portfolio.ts` | `fetchCollections`, `fetchCollectionBySlug`, `fetchProjects`, `fetchProjectBySlug`, `fetchProjectGallery` — the transport; the rules and DTO mappers (hidden filter, dashboard order, cover fallback, media kinds, `mediaElement`) are in `portfolio-core.ts` beside it (shared with the REST layer) |
| `wix/portfolio/collections-store.ts` · `collection-projects-store.ts` · `project-detail-store.ts` | the gallery, collection-page, and project-page state machines, framework-free (`createCollectionsStore()`, `createCollectionProjectsStore(slug)`, `createProjectDetailStore(slug)` — `getState`/`subscribe`/`start`/`stop`, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/portfolio/useCollections.ts` | React binding of `collections-store.ts` — contract below |
| `hooks/portfolio/useCollectionProjects.ts` | React binding of `collection-projects-store.ts`: one collection + its projects, by slug — contract below |
| `hooks/portfolio/useProjectDetail.ts` | React binding of `project-detail-store.ts`: one project + its media gallery, by slug — contract below |
| `components/portfolio/GalleryMedia.tsx` | one gallery item as its one element — `<video>` with poster for a video item, `<img>` for an image item, nothing for an unrenderable one; `GalleryLink` wraps it in the owner's link when set — **wire as-is** in your project surface (`<GalleryLink item={i}><GalleryMedia item={i} /></GalleryLink>`) |
| `components/portfolio/CollectionsView.tsx` (+ `CollectionCard`) · `CollectionProjectsView.tsx` (+ `ProjectCard`) · `ProjectDetailView.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | the site chrome — **yours to brand**: header, footer, nav. Keep the `<slot name="seo-tags" />` and the global.css import. If another vertical is also deployed, its layout won — add a Portfolio nav link there |
| `pages/portfolio.astro` | SSR collections gallery — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/portfolio/[slug].astro` | SSR collection page (header + projects) — **keep the frontmatter**, swap the island import |
| `pages/projects/[slug].astro` | SSR project detail + gallery — **keep the frontmatter**, swap the island import. Portfolio has no Wix SEO item type, so these pages carry plain `<title>`/`<meta>` from the DTO (no `wixMetadata`/`<SEO.Tags>`) |

## What you build — the design job

1. **The collection card + gallery surface** — your tile (cover, title, description) and rhythm,
   with skeletons while loading and an honest empty state — on `useCollections`.
2. **The project card + collection page** — the collection header and your project grid — on
   `useCollectionProjects` (route a not-found state off `notFound`, never off a transient null).
3. **The project-detail surface** — title/description, the `details` rows (text or link, as
   given), and the media gallery through the shipped `GalleryMedia`; empty gallery → the project
   cover when it exists, else an honest empty note — on `useProjectDetail`.
4. **The home page** — hero, featured collections or projects (fetch in frontmatter → your
   components), brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).

### What a complete portfolio shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins where it differs. Look at the
content before designing (how many collections, covers, project count, media mix) and design for
this portfolio, not for a stereotype of its field. Then, by default:

- **Home:** what the work is and one path into it in the first screen; real collections or
  projects under truthful headings; a collection tile links to `/portfolio/<slug>` and shows that
  collection's own cover.
- **Gallery (`/portfolio`):** a real collection card — cover, title — in the first screen;
  loading, empty, and error states that look different.
- **Collection page:** the collection's title and description as the header, then only its
  projects; a slug that resolves to nothing shows the not-found state alone — no header or empty
  grid around it.
- **Project page:** title, description, and the `details` rows before the gallery; gallery items
  in dashboard order, each through `GalleryMedia`, captions from `item.title` when present; on a
  phone a gallery image is a bounded band, not a full-height hero.
- **Images:** every DTO image through `imgAttrs` (a `src`, a `srcSet`, and `sizes` in one spread;
  an empty `imageUrl` gives `{}` — render your placeholder then).
- **Copy:** nothing the owner didn't supply — no invented clients, awards, or dates; no Wix IDs or
  technical words in visible text.

### The contracts your components consume (tested and work as they are; read when something is off or the brief wants more)

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

// <GalleryMedia item={i} className? /> renders i as ONE element by kind (video+poster / img /
// nothing); <GalleryLink item={i}>…</GalleryLink> wraps in the owner's link when linkUrl is set.
```

### The pages and islands you create — skeletons

The class names here are the Astro/React spelling of layout rules that hold on every stack; on a
stack where the components don't deploy (`lib`, `static`, a port), keep the rule and write it in
your own CSS. The three pages ship with their frontmatter (fetch → DTO props → island, guarded
against an SSR throw, a real 404 on a missing slug) — keep it, and point the island import at
yours. Hooks first, branches after (an early return above a hook changes hook order between
renders and React throws). Render every state totally; nothing in a render path may throw.

```tsx
// src/components/portfolio/Gallery.tsx — YOU build it; pages/portfolio.astro mounts it.
import { useCollections } from "../../hooks/portfolio/useCollections";
import { imgAttrs } from "../../wix/media";
import type { CollectionSummary } from "../../wix/portfolio/types";

export default function Gallery(props: { initialCollections?: CollectionSummary[] }) {
  const { collections, error } = useCollections(props);
  // …you implement the render:
  //   • error → a short inline message
  //   • collections === null → skeleton tiles; [] → your honest empty state
  //   • else YOUR grid of YOUR tiles: <a href={`/portfolio/${c.slug}`}> around the cover
  //     (<img {...imgAttrs(c.imageUrl, "(min-width: 1024px) 33vw, 50vw", 0.75)} alt={c.title} />,
  //     your placeholder when imageUrl is ""), title, description; the title WRAPS (`min-w-0`,
  //     `break-words`), never `truncate`
}
```

```tsx
// src/components/portfolio/CollectionPage.tsx — YOU build it; pages/portfolio/[slug].astro mounts it.
import { useCollectionProjects } from "../../hooks/portfolio/useCollectionProjects";
import type { CollectionSummary, ProjectSummary } from "../../wix/portfolio/types";

export default function CollectionPage(props: { slug: string; initialCollection?: CollectionSummary; initialProjects?: ProjectSummary[] }) {
  const { collection, notFound, projects, error } = useCollectionProjects(props.slug, props);
  // …you implement the render. Handle in order:
  //   notFound → the not-found state ALONE (no header, no empty grid around it)
  //   header: collection.title and description (a skeleton line while collection is null)
  //   error → inline message; projects === null → skeleton tiles; [] → your empty state
  //   else YOUR grid of YOUR project tiles linking to `/projects/${p.slug}` (cover via imgAttrs)
}
```

```tsx
// src/components/portfolio/ProjectPage.tsx — YOU build it; pages/projects/[slug].astro mounts it.
import { useProjectDetail } from "../../hooks/portfolio/useProjectDetail";
import { GalleryLink, GalleryMedia } from "./GalleryMedia";
import { imgAttrs } from "../../wix/media";
import type { GalleryItem, ProjectDetail } from "../../wix/portfolio/types";

export default function ProjectPage(props: { slug: string; initialProject?: ProjectDetail; initialItems?: GalleryItem[] }) {
  const { project, notFound, items, error } = useProjectDetail(props.slug, props);
  // …you implement the render. Handle in order:
  //   notFound → "doesn't exist (anymore)"; !project → a loading placeholder
  //   else: title, description, then project.details as a definition list — a row with url is a
  //     link (target as given), else plain text; never invent a row
  //   items === null → a skeleton; [] → the cover (imgAttrs) when project.imageUrl, else an honest
  //     empty note; else each item as
  //     <figure><GalleryLink item={i}><GalleryMedia item={i} className="…" /></GalleryLink>
  //       {i.title && <figcaption>{i.title}</figcaption>}</figure> — never your own <img>/<video>
  //     branch (the shipped one owns kind, poster, and the unrenderable case)
  //   on a phone the media column is a bounded band (`max-h-[70vh]`, `object-contain`)
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state machines
behind the hooks do arrive — `wix/portfolio/collections-store.ts`, `collection-projects-store.ts`,
`project-detail-store.ts` — so you never rewrite them: create a store per surface, `subscribe`,
render from `getState()`. Their `*State` interfaces are the render contract; read those. The one
rendering rule worth reading before writing your gallery:

1. `components/portfolio/GalleryMedia.tsx` — the kind branch as working code, and the rule it
   renders, `mediaElement(item)` in `wix/portfolio/portfolio-core.ts`, which ships on every stack:
   it returns `{ tag: "video", attrs }`, `{ tag: "img", attrs }`, or null — create the element
   from it (`document.createElement(el.tag)` + `setAttribute` per entry) instead of branching on
   `kind` yourself.

All under `references/portfolio/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   existing layout instead if another vertical is deployed).
2. Write your islands under `src/components/portfolio/` (new names — don't overwrite the
   references) per the skeletons above; swap the island imports in `pages/portfolio.astro`,
   `pages/portfolio/[slug].astro`, and `pages/projects/[slug].astro`. Islands are `client:load`
   with the SSR props. Author your surfaces in as few messages as possible — batch multiple Writes
   per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs portfolio --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts`
(the visitor client, configured with the public client id), `media.ts`, `money.ts`, and
`wix/portfolio/` — `portfolio.ts`, `types.ts`, the `portfolio-core.ts` rules, and the three stores.
None of it is React. The hooks and components don't ship on this stack; the stores replace the
hooks, and you write the components in your framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createCollectionsStore(options)` per gallery,
  `createCollectionProjectsStore(slug, options)` per collection page,
  `createProjectDetailStore(slug, options)` per project page — `start()` when mounted, `stop()`
  when unmounted. State in, exactly the hooks' contracts above;
- gallery items through `mediaElement(item)` from `portfolio-core.ts`; images through
  `imgAttrs` from `media.ts`.

Routes `/portfolio`, `/portfolio/:slug` (`fetchCollectionBySlug`, null → your 404),
`/projects/:slug` (`fetchProjectBySlug`, null → your 404); dev server on 4321; a static build goes
through `npx @wix/cli@latest release` with `site.outputDirectory` pointing at the build folder, an
SSR build is hosted by you. Page titles and descriptions from the DTO (Portfolio has no SEO item type).

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs portfolio --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM,
the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` — pages,
styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project root
(config, plan, seed output) is never the upload. Same function names and DTOs as the table above,
so the contracts on this page hold unchanged: `fetchCollections`, `fetchCollectionBySlug`,
`fetchProjects`, `fetchProjectBySlug`, `fetchProjectGallery` from `./js/wix/portfolio.js`. The
state machines ship too: `createCollectionsStore` from `./js/wix/collections-store.js`,
`createCollectionProjectsStore` from `./js/wix/collection-projects-store.js`,
`createProjectDetailStore` from `./js/wix/project-detail-store.js` (`start()` once the page is up;
`notFound` is the 404 signal), `mediaElement` from `./js/wix/portfolio-core.js` (the gallery item
→ element rule), and `imgAttrs` from `./js/wix/media.js` (attribute names as HTML spells them —
`setAttribute` per entry). No components ship — you write the rendering in plain JS: one render
function per surface that reads `getState()`, called from `subscribe`. Wix static hosting serves
files, not directories: pages are `portfolio.html`, `collection.html?slug=…`,
`project.html?slug=…`; name the file and link to it. Set `document.title` and the meta description
from the DTO (`collection.title`/`description`, `project.title`/`description`) once the store
populates — Portfolio has no `seoData`. The visitor token persists in `localStorage` on its own;
never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs portfolio --stack static` in the project folder anyway: `js/wix/` is the readable
spec. This vertical is reads only, so everything renders on the server: port `js/wix/portfolio.ts`
and `portfolio-core.ts` to your language — the same five functions returning the same DTO shapes
as dicts, one anonymous visitor token per process (mint and refresh per `client.ts`) — and render
gallery, collection, and project pages in your templates to the contracts above, so titles are in
the HTML; `<title>`/`<meta>` from the DTO. Carry the URLs and bodies over as they are (the list
calls are `GET` with `paging.limit`; the slug lookups `POST …/query` with
`{ query: { filter: { slug }, cursorPaging: { limit: 1 } } }`). The gallery's kind rule is
`mediaElement` — port it, don't re-derive it. Nothing here runs in the browser unless you want
client-side loading; then the static wiring above applies. Routes stay `/portfolio`,
`/portfolio/<slug>`, `/projects/<slug>`.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the reads, run at build time with one anonymous token; the generator must emit a page for every
collection (`fetchCollections()`) and every project (`fetchProjects()`) — both return one page of
up to 100 in list order, the same as the SDK path; a portfolio larger than that walks
`pagingMetadataV2.cursors.next` on the list response (add it to your port when you hit it). Run
`deploy.mjs portfolio --stack static --out <build dir>` only if a page loads anything client-side;
point `site.outputDirectory` at the build folder, `wix release`. Pages sit at different depths
(`/`, `/portfolio/…`, `/projects/…`): give the templates one base path to any `js/wix/` import (a
template variable, or root-relative `/js/wix/…`), never a relative `./js/wix/` — it breaks one
level down. Close with the live URL, the rebuild + release command, and one line for the owner:
dashboard edits reach the site when that command runs.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite plugins —
deploy added the dep). Routes: `/portfolio` → your gallery on `useCollections()`; `/portfolio/:slug`
→ your collection page on `useCollectionProjects(slug)`; `/projects/:slug` → your detail surface on
`useProjectDetail(slug)` (the hooks fetch client-side when no `initial*` is passed; route the 404
view off `notFound`). Deploy wrote the public client id into `wix/config.ts`; nothing else to configure.

## Hard rules

- **Reads only through the shipped exports** — they filter `hidden`, sort collections by the
  owner's `sortOrder` (projects have none — list order), and resolve every `wix:image://` /
  `wix:video://` value. Never hand-build a `wixstatic.com` URL, never render a raw media string
  into `src`.
- **This vertical sells nothing** — no cart, no checkout, no `@wix/ecom`/`@wix/redirects`
  imports. A "contact about this project" CTA is a link, not a purchase flow.
- **Route not-found off `notFound`**, and surface `error` — a transient `null` is loading, not a 404.
- **Render `details` rows as given** (text or link per row); don't invent metadata.
- **Gallery items render through `GalleryMedia`** (or `mediaElement` where it doesn't deploy) —
  never your own branch on `kind`.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens — one design system across shipped and written
  code. No parallel theme files, no hardcoded palette values. Where they don't (`lib`, `static`, a
  port): style with whatever your stack does well, on one token set of your own.
- Live data or an honest empty state — never mock collections, projects, or media.
- **Call every hook before any conditional return.** Hooks first, branches after.

## Point the user to their dashboard

Give the owner the dashboard link — the deploy step's JSON printed `dashboardUrl`; append
`/wix-portfolio/projects` for Portfolio management (Projects and Collections are tabs on that one
page: Projects adds projects and their media galleries; Collections groups them).

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-portfolio.mjs` from the project root. Seed
collections + projects that exercise the UI (covers on everything, 2–3 gallery images per project,
`details` rows on a couple of projects). A fresh install ships sample content — seeding never
deletes it; ask the owner before any cleanup.
