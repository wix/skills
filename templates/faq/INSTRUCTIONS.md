# FAQ — playbook

The FAQ machinery ships as files — category and question reads over the Wix FAQ app (owner order,
the Ricos answer rendered to sanitized HTML), one shared state machine for the page (category
filter, search, the accordion, the URL), its React binding, and reference components, typed
end-to-end. **The presentation is yours to design** on the shipped hook/DTOs: the accordion's look,
the category nav, the search box, the FAQ page, the home page's "top questions" strip, and the brand.
You never write FAQ data logic; you never skip designing. The vertical is **read-only** — visitors
read; authoring stays in the dashboard.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the hooks
and components don't deploy at all; the store behind them does, and each wiring section below says
how to bind it. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the shipped page's
template. Files you **create**: your accordion island (skeleton below) and your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | shared helpers; an answer's inline images are already resolved https URLs inside `answerHtml` |
| `wix/faq/types.ts` | the DTOs (`FaqCategory`, `FaqQuestion`, `FaqSection`, `FaqData`, `FaqQuestionPage`) — contracts below |
| `wix/faq/faq.ts` | `fetchFaq` (everything the page needs), `fetchCategories`, `fetchQuestions` (one cursor page, optionally one category), `fetchQuestionById` — the transport; the rules and DTO mappers are in `faq-core.ts` beside it (shared with the REST layer) |
| `wix/faq/faq-core.ts` | the rules: owner ordering, grouping into sections, client-side search, the deep-link spelling (`anchorId`, `faqDeepLink`, `parseDeepLink`), `faqJsonLd` (schema.org FAQPage), the Ricos-to-HTML subset, the wire spelling of a query |
| `wix/faq/faq-store.ts` | the page's state machine, framework-free and **module-scoped** (one store per page, not per surface — the nav, the search, and the accordion share it across islands): `seedFaq`, `getFaqState`/`subscribeFaq` + actions; the hook binds it to React, every other stack uses it directly |
| `hooks/faq/useFaq.ts` | React binding of `faq-store.ts` — contract below |
| `components/faq/FaqAccordion.tsx` · `FaqCategoryNav.tsx` · `FaqSearch.tsx` | **reference implementations** — correct, plain, accessible; build your own instead of shipping them |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (shared across verticals). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If another vertical is also deployed, its layout won — add an FAQ nav link there |
| `pages/faq.astro` | SSR FAQ page — **keep the frontmatter** (the fetch, the `?category=` pre-selection, the FAQPage JSON-LD in the `seo-tags` slot); swap the island imports to YOUR components. Not a Wix item page: there is no owner-editable SEO type for FAQ, so `<title>`/description come from the layout props |

## What you build — the design job

1. **The accordion** — your question row (the question as the button, your open/closed affordance)
   and answer panel (the HTML body, the per-question link) on `useFaq`, grouped under category
   headings in owner order; skeletons while `data === null`, an honest empty state, a "no results"
   state with a clear control while searching, an error line with retry.
2. **The category nav + search** — pills for the categories that have questions (only when more
   than one), "All" first; a labelled search input debounced into `setQuery`, the results count
   announced. Three islands or one — the store is shared either way.
3. **The FAQ page** — restyle `pages/faq.astro`'s template around your islands (heading, intro copy
   from the brief, the islands). Keep the frontmatter.
4. **The home page** — what the business is, and a "top questions" strip: the first few questions
   of the first category (`fetchFaq()` in the frontmatter → your markup), each linking to
   `faqDeepLink(q)`.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass). Style
everything with Tailwind utilities on the tokens; the answer's HTML is plain tags (`p`, `h4`,
`ul`/`ol`/`li`, `blockquote`, `pre`/`code`, `a`, `img`, `hr`, `strong`/`em`/`u`/`s`) — style them
through descendant variants on your wrapper (`[&_p]:my-2 [&_ul]:list-disc …`), as the reference does.

### What a complete FAQ shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins where it differs. Look at the
seeded content before designing (how many categories, how long the answers run, whether they carry
lists or images) and design for this content, not for a stereotype of an FAQ.

- **FAQ page:** the heading and one line of intro in the first screen, then the category nav (only
  when more than one category has questions), the search, and the first questions — at 390px too;
  the questions collapsed by default, one open at a time; a copied link reopens the same question.
- **Search:** results as you type (debounced); the count announced; "No results for '…'" with a
  clear control, never an empty page.
- **Home:** the business first, then real questions under a truthful heading, each a link to
  `/faq#q-<slug>`; not a copy of the FAQ page.
- **Copy:** nothing the owner didn't write — no invented questions, view counts, or "popular" labels;
  no Wix IDs or technical words in visible text.

### The contracts your components consume

Tested and working as they are; read the source when something is off or the brief wants more.

```ts
// FaqCategory: { id, title, sortOrder /* number | null */, questionCount /* hide empty categories with it */ }
// FaqQuestion: { id, slug /* "" when absent */, question,
//   answerHtml /* sanitized HTML — render via set:html / dangerouslySetInnerHTML on a wrapper */,
//   answerText /* plain text — snippets, search, JSON-LD */,
//   categoryId, sortOrder, shareLink /* Wix's own widget URL, "" unless asked */, labels /* not for visitors */ }
// FaqSection: { category, questions }          // one category's questions in owner order
// FaqData:    { categories, questions, truncated /* true → more than MAX_QUESTIONS (500) exist */ }

// fetchFaq() → FaqData                          // categories (counted) + every question, owner order
// fetchQuestions({ categoryId?, limit? /* ≤100 */, cursor? }) → { questions, nextCursor }
// fetchCategories() → FaqCategory[]             // questionCount is 0 here; fetchFaq fills it
// fetchQuestionById(id) → FaqQuestion | null

// useFaq({ initialData?, initialCategoryId?, expandOnlyOne? /* true */, openFirst? /* false */, syncUrl? /* true */ }) →
// { data: FaqData|null /* null = loading → skeletons */,
//   sections: FaqSection[]        /* the VISIBLE questions grouped by category — render these */,
//   visible: FaqQuestion[], activeCategoryId, selectCategory(id|null),
//   query, setQuery(q), resultsCount /* visible.length while a query is typed */,
//   expandedIds, isExpanded(id), toggleQuestion(id), expandQuestion(id), collapseAll(),
//   loading, error, retry() }
// One store per page: every island that calls useFaq sees the same state. Pass the page's SSR props
// to EVERY island (the first to render seeds; the rest are no-ops) so server HTML and first paint agree.

// anchorId(q) → "q-<slug || id>"                 // put it as the id of every question's wrapper
// faqDeepLink(q, base = "/faq", categoryId?) → "/faq?category=…#q-<slug>"
// faqJsonLd(questions, pageUrl?) → the FAQPage object (the page already emits it)
```

### The island you create — skeleton

The Astro page ships; its frontmatter is machinery (SSR fetch → DTO props → islands; the JSON-LD; the
category pre-selection) and stays as shipped. What you create is the accordion island `faq.astro`
mounts (and your nav and search, or one island holding all three). Hooks first, branches after (an
early return above a hook changes hook order and React throws). Islands render on the server too,
after the 200 is sent — nothing in a render path may throw.

```tsx
// src/components/faq/<YourAccordion>.tsx — YOU build it; faq.astro mounts it (swap the import there).
import { useFaq } from "../../hooks/faq/useFaq";
import { anchorId, faqDeepLink } from "../../wix/faq/faq-core";
import type { FaqData } from "../../wix/faq/types";

export default function YourAccordion(props: {
  initialData?: FaqData;              // SSR props from faq.astro — pass straight to useFaq;
  initialCategoryId?: string | null;  // omitted in a SPA (client fetch)
}) {
  const { data, sections, query, setQuery, isExpanded, toggleQuestion, error, retry } = useFaq(props);
  // …you implement the render:
  //   • data === null → skeleton rows; data.questions.length === 0 → your honest empty state
  //   • error → a short inline message with a retry control
  //   • query set and sections empty → "No results for '…'" with a clear control (setQuery(""))
  //   • else per section: the category title (an <h2>) and per question a wrapper
  //     <div id={anchorId(q)}> holding an <h3><button aria-expanded={isExpanded(q.id)}
  //     aria-controls={panelId} onClick={() => toggleQuestion(q.id)}>{q.question}</button></h3>
  //     and a <div id={panelId} role="region" hidden={!isExpanded(q.id)}> with the answer:
  //     <div dangerouslySetInnerHTML={{ __html: q.answerHtml }} /> — the ONLY HTML render — and a
  //     link to faqDeepLink(q) (plus a "copy link" control if you like)
  //   • data.truncated → one honest line ("Showing the first N questions")
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state machine
behind the hook does arrive — `wix/faq/faq-store.ts` — so you never rewrite it: `seedFaq(options)`
once, `subscribeFaq`, render from `getFaqState()`, call its actions. Its `FaqState` interface is the
render contract; read it. What you write is the rendering — the accordion, the nav, the search — and
for that read these first; they are tested code for exactly that behaviour:

1. `components/faq/FaqAccordion.tsx` — the button-in-heading + region pattern with `aria-expanded`,
   `aria-controls` and `hidden`; the states in order (skeleton → error → empty → no results →
   sections); the copy-link control; the truncation line.
2. `components/faq/FaqCategoryNav.tsx` — "All" first, only categories with questions, `aria-pressed`
   on the active pill, the `asLinks` no-JS variant.
3. `components/faq/FaqSearch.tsx` — the 250 ms debounce with immediate flush on Enter and on clear,
   the `aria-live` results count.

All under `templates/faq/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the other
   vertical's layout instead if both are deployed).
2. Write your island(s) under `src/components/faq/` (new names — don't overwrite the references) and
   swap the island imports in `pages/faq.astro`; restyle its template (keep the frontmatter).
   **Author your surfaces in as few messages as possible** — batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs faq --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts` (the
visitor client, configured with the public client id), `media.ts`, `money.ts`, and `wix/faq/` —
`faq.ts`, `types.ts`, `faq-core.ts`, and the store `faq-store.ts`. None of it is React. The hook and
components don't ship on this stack; the store replaces the hook, and you write the components in
your framework to the contracts on this page:

- bind the store with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribeFaq`; Svelte: `readable(getFaqState(), (set) => subscribeFaq(() => set(getFaqState())))`;
  Solid: a signal set in `subscribeFaq`). `seedFaq({ initialData? })` once when the page's data is
  known (a SPA passes nothing and the first subscription fetches); `groupByCategory(state.data.categories,
  state.visible)` from `faq-core` gives the sections. State in, actions out — exactly the hook's
  contract above.

Route `/faq` (`?category=` and `#q-…` are read and written by the store); dev server on 4321; a
static build goes through `npx @wix/cli@latest release` with `site.outputDirectory` pointing at the
build folder, an SSR build is hosted by you. Page tags from the first questions.

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs faq --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM, the
`.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` — pages,
styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project root
(config, plan, seed output) is never the upload. Same function names and DTOs as the table above,
so the contracts on this page hold unchanged: `fetchFaq`, `fetchQuestions`, `fetchCategories`,
`fetchQuestionById` from `./js/wix/faq.js`; `anchorId`, `faqDeepLink`, `groupByCategory` from
`./js/wix/faq-core.js`. The state machine ships too: `seedFaq`, `subscribeFaq`, `getFaqState` and
the actions from `./js/wix/faq-store.js` (the first `subscribeFaq` in a browser fetches when nothing
was seeded). No components ship — you write the rendering in plain JS: one render function per
surface that reads `getFaqState()`, called from `subscribeFaq`, with the controls calling the store's
actions; the answer goes in through `innerHTML` (it is the core's sanitized HTML). The page is
`faq.html` (Wix static hosting serves files, not directories — name the file and link to it).
Structured data built in the browser is not read by search engines — an FAQ that needs the FAQPage
markup indexed stays on Astro; say so in the closing message. Set `document.title` from the first
questions once they load. The visitor token persists in `localStorage` on its own; never mint per
page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs faq --stack static` in the project folder anyway: `js/wix/` is both the browser-side
code and the readable spec. Reads render on the server: port `js/wix/faq.ts` and `faq-core.ts` to
your language — the same four functions returning the same DTO shapes as dicts, one anonymous
visitor token per process for these public reads (mint and refresh per `client.ts`) — the
Ricos-to-HTML subset ports with the core (escape text, allow only http(s) links, the node table in
`faq-core.ts`), and the FAQPage JSON-LD is server-rendered from the same DTOs, so questions and
answers are in the HTML. Nothing in this vertical runs on the visitor's behalf, so the browser side
is optional: the category filter, the search, and the accordion can run client-side on
`./js/wix/faq-store.js` exactly as the static wiring above, or as plain server routes
(`/faq?category=<id>`, answers rendered open when there is no script). Route stays `/faq`.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for the
reads, run at build time with one anonymous token — walk `fetchQuestions` by `nextCursor` until it
is null (or call the ported `fetchFaq`). Run `deploy.mjs faq --stack static --out <build dir>` so
`js/wix/` is inside the output the page imports from, point `site.outputDirectory` at that folder,
`wix release`. Give the templates one base path to `js/wix/` (root-relative `/js/wix/…`), never a
relative `./js/wix/`. The frozen page is the first paint; filter, search, and the accordion still run
client-side on `./js/wix/faq-store.js`. Close with the live URL, the rebuild + release command, and
one line for the owner: questions edited in the dashboard reach the site when that command runs.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite plugins —
deploy added the dep). Route `/faq` → your islands on `useFaq()` (no `initialData` — the store
fetches on mount and reads `?category=`/`#q-…` from the address bar). Deploy wrote the public client
id into `wix/config.ts`; nothing else to configure.

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded directly — hash routes, or one HTML file per route, decided before the first route is written; any URL handed to Wix as a return target must be one the host serves (SKILL.md step 1).

## Hard rules

- **Data only through the shipped exports** — never import `@wix/faq` in a component, never
  re-derive a request shape; extend by adding a function in `wix/faq/` (API contracts: the
  `wix-docs` skill).
- **`answerHtml` is HTML, `answerText` is copy** — render the body with `set:html` /
  `dangerouslySetInnerHTML` on a wrapper you control, and only that field; never interpolate it as
  text, never innerHTML anything else (question, titles, labels are text).
- **Search and category filtering are client-side over the loaded set — by design.** The API filters
  `question` by prefix only and has no full-text search, so the whole FAQ is loaded once (capped at
  `MAX_QUESTIONS`, 500) and filtered in the store; this is the one vertical where "page at the source"
  does not apply. Never re-implement search against the API, never raise the cap; render
  `data.truncated` honestly.
- **Question and category order is the owner's** (`sortOrder`, already applied) — never sort
  alphabetically or by length unless the brief says so.
- **Deep links are `/faq#q-<slug>`** — every question's wrapper carries `id={anchorId(q)}`; links to a
  question go through `faqDeepLink(q)`; never hand-build them from ids. `shareLink` is Wix's widget
  URL, not this site's — don't surface it as the share target.
- **The accordion is accessible by construction**: the question is a `<button aria-expanded
  aria-controls>` inside a heading, the answer a `role="region"` panel it labels, collapsed with
  `hidden` (still in the DOM — that is what makes the FAQPage markup honest). Never collapse by
  unmounting the answer.
- **Pass the page's SSR props to every island** that calls `useFaq` (the store seeds once) — an island
  without them renders skeletons on the server and flashes on hydration.
- Where the shipped components deploy: theme via the `@theme` tokens, your markup in Tailwind utilities
  on the same tokens; no parallel theme files, no hardcoded palettes. Where they don't (`lib`,
  `static`, a port): style with what your stack does well, on one token set of your own.
- Live data or an honest empty state — never mock questions, counts, or "helpful" votes; the DTOs don't
  carry them.
- **Call every hook before any conditional return.** Hooks first, branches after.

## Point the user to their dashboard

Hand the owner this link — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it as
`dashboardUrl`).

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| FAQ (categories and questions) | `app/14c92d28-031e-7910-c9a8-a670011e062d` — the app-id form, which redirects to the FAQ app's own dashboard page |

Every category and question in the dashboard appears on the site; the API exposes no draft state.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-faq.mjs` from the project root. Seed
questions that exercise the UI (2–4 categories, 2–4 questions each, at least one answer with a list
or several paragraphs). A fresh FAQ install carries Wix's sample categories and questions ("General",
"Setting up FAQs"), and the page shows them. Never delete them, or anything else on the site: the
result's `preexisting[]` names what is on the page, and the closing message says so with the
dashboard link so the owner removes them there — never release a site that shows "Setting up FAQs"
without telling the owner.

## Verification caveats

The FAQ API's reference exists (`https://dev.wix.com/docs/rest/business-management/faq-app/…`) and the
shipped calls follow it: `POST /faq/v2/categories/query`, `POST /faq/v2/question-entries/query`, the
`RICH_CONTENT` content format and the `SHARE_LINKS` field set. Not confirmed on a live site, and
guarded in the code:

- **Anonymous visitor reads.** Both endpoints carry the app's READ scope; the reference's SDK example
  is elevated. If `fetchFaq` answers 403 for a visitor (the SSR fetch is guarded — the page then
  renders the empty state), the read belongs behind a narrow server endpoint per
  `templates/shared/CUSTOM_OPERATIONS.md`; on managed Astro the SSR call already runs server-side.
- **Answer format.** A question stored as plain text may come back as `plainText` even when
  `RICH_CONTENT` is requested; the core renders `richContent`, then `plainText`, then a minimal
  Draft.js read (paragraphs, lists, headings — no inline styles), so every format shows something.
- **Cursor pages of a filtered query.** Page 2 of `fetchQuestions({ categoryId })` sends the cursor
  alone (the cursor carries the filter, as Blog's does); `fetchFaq` pages the unfiltered set, so the
  page never depends on it.
- **Default content on install** and a question **visibility control** (the reference's sample flow
  mentions a `status` the entity does not expose): the seed reads before writing and reports what it
  found; the read layer shows what the API returns.
- **The dashboard slug** is not confirmed; the app-id link above always redirects to it.
