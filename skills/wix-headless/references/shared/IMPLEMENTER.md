# Shared Implementer — Common Behavior for Every Vertical Subagent

This file is **extended by every per-vertical `INSTRUCTIONS.md`** (stores, ecom, cms, blog, forms, gift-cards, bookings). Per-vertical instruction files are thin — they declare scopes and reference paths. Everything else lives here.

## Self-loading

Read **only** the files your scope needs. The reading set varies by scope:

| Your scope | Mandatory | Conditional |
|---|---|---|
| `seed` | this file, `RETURN_CONTRACT.md`, `DOCS_SEARCH.md` | — |
| `components`, `components-css`, `pages`, `pages-*` | this file, `RETURN_CONTRACT.md`, `STYLING.md` | — |
| Image scopes | (read `references/images/INSTRUCTIONS.md` § Self-Loading) | — |

Then read the specific reference(s) for your declared scope(s) (see your vertical's `INSTRUCTIONS.md` scope table). Do NOT read references for scopes **not** named in your prompt — wastes context and blurs ownership.

## Phase routing

Your prompt includes a line naming your scope(s). Map **each** scope to its reference set per your vertical's `INSTRUCTIONS.md` scope table. If the scope line is missing, stop and ask the parent — do not guess.

**Merged dispatch (the common case — one agent owns components + pages for a vertical).** Your prompt may list **several** scopes — e.g. `Scopes (write in this order): components, pages-products, pages-categories`. This is a single "build" agent for one vertical: read the **union** of those scopes' references and write them in the order given — **islands/components FIRST, then the pages/routes that mount them.** Writing the page before its island leaves a dangling import; the within-agent order is exactly why these were merged into one dispatch (it removes the cross-agent Components→Pages barrier). You still own only the files those scopes declare; do not touch another vertical's files or a shared shell unless your scope list explicitly includes a shell-patching `pages` scope.

Standard scope names:
- `seed` — Seed phase (REST data setup, no frontend code)
- `components` — Components phase (reusable React/Astro islands, SDK wiring)
- `pages` — Pages phase (route files with visual design + data queries, single scope per vertical)
- `pages-<name>` — Pages phase sub-scope (only when a vertical has multiple pages groups, e.g. stores has `pages-products`, `pages-home-and-nav`)

## REST auth

Scopes that call Wix APIs (`seed`, image phases) receive `siteId` in the prompt. Mint once: `TOKEN=$(npx @wix/cli@latest token --site "$SITE_ID")`. Every `curl` uses the headers in `references/shared/AUTHENTICATION.md`. Doc lookups use the public REST endpoints listed in `references/shared/DOCS_SEARCH.md`.

If your scope is `components` or `pages`, you should NOT make REST calls — those scopes are frontend-only. If you find yourself needing a site API call, it's a scope violation — return `status: "partial"` with an error note, do not proceed.

## Don't depend on mutable shared state (one scoped exception: `.wix/seeded.json`)

Every input you need is either inlined in your prompt or — for seeded entity IDs — in **`.wix/seeded.json`**, the one shared file you are allowed to read. The orchestrator holds run state in scratch, not on disk — it is **not** a coordination channel you can read. `.wix/seeded.json` is the one exception: a producer→consumer handoff written **once** at the seed gate, read-only thereafter. Read **only your own `<vertical>` slice**; never write it.

**Phase-specific inputs:**

| Scope | Where its inputs come from |
|---|---|
| `seed` | All **inlined**: `brand`, `intent.<pack>`, `siteId`, recipe path(s). Do NOT re-derive these. |
| `components` | **Inlined**: `brand`. **Read from disk**: the design tokens (the DESIGN.md vocabulary — `colors`/`typography`/`rounded`/`containers`; spacing is Tailwind's numeric scale, not a token) from `.wix/design-tokens.css` (gate-verified present; also the CSS variables the build consumes). Components do not need seeded IDs. |
| `pages` / `pages-*` | **Inlined:** `brand`. **Read from disk:** the design tokens (`.wix/design-tokens.css`, DESIGN.md vocabulary); your `seeded.<vertical>` slice from `.wix/seeded.json` (products, posts, collections IDs). Page data wiring uses live SDK queries; the `seeded` data is for path resolution + demo content authoring. |

If a required **inlined** input is missing from your prompt, or your **`.wix/seeded.json` slice** is absent (e.g. you are dispatched as `pages-products` but `.wix/seeded.json` has no `seeded.stores`), fail fast — return `status: "failed"` with `errors: [{ code: "SEEDED_JSON_SLICE_MISSING", missing: "seeded.stores.products" }]` (or `PROMPT_INCOMPLETE` for an inlined gap). Do NOT re-fetch via curl — the gap means an upstream phase didn't complete, and re-querying would mask the real bug.

## Seeders return data; orchestrator aggregates → `.wix/seeded.json`

Agents with `Scope: seed` return their seeded entities in the `data` block of the standard return (see `RETURN_CONTRACT.md`). The orchestrator collects every seeder return into its session scratch and writes the aggregated map **once** to `.wix/seeded.json` at the seed gate; per-vertical Page / wiring agents then read their own slice from that file (no inlined slice). (The single Image Phase 2 dispatch keeps its slice inlined.) You do NOT write `.wix/seeded.json` (the orchestrator is its sole writer), and you do NOT write `.wix/seed-returns/<pack>.json` — your JSON return is the contract.

## Writing page files

Pages-phase agents write route files (`.astro`) with:

1. **Visual design via design tokens and Tailwind.** Reference tokens as `var(--color-accent)` in `<style>` blocks or `bg-[--color-accent]` as Tailwind arbitrary values. Use canonical component templates (`agents/<vertical>/templates/*.astro`) as starting points — adapt, don't invent.
2. **Data queries against seeded data.** Read the seeded entity IDs / slugs from your `seeded.<vertical>` slice in `.wix/seeded.json` (with the `Read` tool — not by `import`). Pages query the Wix SDK at request time (`await productsV3.queryProducts(...)`) — that's the production-correct pattern. Use the `seeded` data for path generation (e.g. `getStaticPaths` slugs) and for authoring demo content where needed; do NOT `import` `.wix/seeded.json` from page files — it sits outside the bundler root and reading it at author-time (not bundling it) keeps it out of `dist/`.
3. **Imports from shared components.** Pages import components your Components-phase agent wrote (`src/components/*.tsx`, `.astro`).
4. **Imports from skill shared utilities.** `from "../utils/wix-image"` and `from "../utils/analytics"` — these are skill-shipped (copied into the project by `seed-utilities.sh` during Setup); do NOT import them from anywhere else.

## Contributing to shared files via markers

When your vertical's pack frontmatter declares `contributes:` entries, you insert at named markers in files created by the Design System phase or another vertical. Example: `Navigation.astro` has `<!-- nav:links -->` and `<!-- nav:actions -->` markers; each vertical inserts at its declared marker.

**How to insert at a marker:**

1. Read the shell file to see current content.
2. Locate your marker comment (exact string match from your `contributes[].marker`).
3. Insert your snippet immediately AFTER the marker line. Do NOT remove the marker — other verticals or future runs may still use it.
4. Preserve the file's other content exactly.

If your marker is missing from the file, fail fast — it means the shell wasn't scaffolded correctly. Do not invent your own insertion point.

### Marker discipline — strict rules

Multiple Phase 4 agents patch the same files concurrently (`Navigation.astro` is touched by stores, ecom, and gift-cards; `index.astro` by stores and gift-cards). To keep their edits compatible:

- **Never delete the marker comment** — even if your insert makes it look redundant, leave the comment in place. Other verticals running in parallel rely on `Edit` finding it.
- **Edit only between/at YOUR marker.** Do not reorder, deduplicate, or "tidy up" content inserted by another agent — even if it looks duplicated. If you observe a duplicate, return `status: "partial"` with `errors: [{code: "MARKER_CONFLICT", marker: "<name>", detail: "..."}]` rather than self-deciding which copy to keep. Concurrent agents have no shared truth on insert order.
- **Insert AFTER the marker, never replace it.** Use `Edit` with `old_string` = the marker line and `new_string` = the marker line + a newline + your snippet. Never `Edit` with `old_string` containing both the marker and surrounding content unless you also re-emit the marker verbatim in `new_string`.
- **If your marker has prior content (designer placed a placeholder), append rather than replace** unless your scope reference explicitly says to clear-and-replace. The designer is instructed not to speculatively populate pack-owned slots, but mistakes happen — appending degrades to a duplicate that the user can clean up; replacing destroys hand-tuned content.

## Shared implementation rules

Three rules recur across verticals and live here as the single source of truth. Per-vertical references cross-link rather than restating.

### SSR error guards (`.astro` frontmatter)

**Every Wix SDK `await` in `.astro` frontmatter MUST be wrapped in try/catch with a safe fallback.** An uncaught throw during render aborts Astro's response stream mid-body — the browser sees HTML up to the failing await and no further (a home page rendering nav + blank body is the typical symptom).

```astro
---
let productList: any[] = [];
try {
  const result = await productsV3.queryProducts({ fields: ["CURRENCY"] }).limit(50).find();
  productList = result.items ?? [];
} catch (err) {
  console.error("[products] listing query failed:", err);
}
---
```

Safe fallbacks: an empty array, `Astro.redirect("/404")`, or a graceful placeholder. Never let an SDK error crash the page.

### Fire-and-forget analytics

**`trackEvent` calls MUST NOT throw up the call stack and MUST NOT block user-facing flow.** Analytics failures (blocked by adblock, network error, invalid payload) are acceptable; a broken cart add or product click handler is not. Import `trackEvent` from `../utils/analytics` and call it directly — the shared util swallows its own errors. Do not `await` it and do not wrap it in `try/await` expecting it to retry. If a component wraps analytics alongside a business-critical call, put the business call first:

```ts
await currentCart.addToCurrentCart({ … });
trackEvent("AddToCart", { … }); // fires after; can't break the cart if it fails
```

### Styling

The full styling contract (tokens-as-utilities default, when global semantic classes are appropriate, co-located styles for one-offs, the always-required class list) lives in `STYLING.md`. Read it before any `components` / `pages` work — it's the canonical source. Do not reinvent class names; do not duplicate rules across files.

## Style conventions

- **camelCase for identifiers, kebab-case for filenames, PascalCase for components.** Example: `ProductCard.astro`, `queryBlogPosts` function, `cart-updated` event.
- **No inline styles beyond design-token CSS variables.** `style={{ color: "red" }}` is forbidden; `style={{ color: "var(--color-accent)" }}` is fine.
- **Tailwind v4 `@reference` is mandatory in any scoped CSS that uses `@apply`.** Tailwind v4 isolates `@apply` per file — utilities defined in the main entry CSS (where `@theme` lives) are NOT visible to `components-*.css` unless that file prepends `@reference "./global.css";` on line 1. If your scope writes a `components-<vertical>.css` that uses `@apply` with theme tokens (e.g., `@apply gap-3 font-display text-sm`), the file MUST start with:
  ```css
  @reference "./global.css";
  ```
  Without it, the build breaks at release time with `Cannot apply unknown utility class 'gap-3' …` even though `tsc` and `astro check` pass clean — only the bundler catches it.
- **Fail loud, never silently.** If data is missing, a required field is absent, or an REST call returns an unexpected shape, return `status: "failed"` with details. Do not invent placeholders or swallow errors.

## Return contract

Every agent ends its message with a fenced JSON block per `RETURN_CONTRACT.md` (the universal envelope: skeleton, status semantics, no-trailing-prose rule). The JSON MUST be the last content in the message — no trailing prose. Timing fields are NOT included (the orchestrator captures timing via runtime `duration_ms`).

The `data` shapes for the scopes this file owns — `components` and `pages`/`pages-*` — are below. (Seed `data` shapes live in your per-vertical `INSTRUCTIONS.md` § Seed return.)

**`components` scope** (`phase: "<pack>-components"`):

```json
{
  "status": "complete",
  "phase": "stores-components",
  "scope": "components",
  "summary": "Wrote React islands + utils; wired analytics; contract classes referenced: 7",
  "data": {
    "islands": ["ProductPurchase.tsx", "CartView.tsx", "AddToCartButton.tsx", "CartBadge.tsx"],
    "utils": ["wix-image.ts", "analytics.ts"],
    "astroComponents": ["SeoTags.astro"]
  },
  "files": [
    "src/utils/wix-image.ts",
    "src/utils/analytics.ts",
    "src/components/SeoTags.astro",
    "src/components/AddToCartButton.tsx",
    "src/components/CartBadge.tsx",
    "src/components/ProductPurchase.tsx",
    "src/components/CartView.tsx"
  ]
}
```

**`pages` / `pages-*` scope** (`phase: "<pack>-pages[-<group>]"`):

```json
{
  "status": "complete",
  "phase": "stores-pages-products",
  "scope": "pages-products",
  "data": {
    "pagesWired": 2,
    "wixMetadataExported": true,
    "seoTagsMounted": true,
    "analyticsEvents": ["AddProductImpression", "ClickProduct", "ViewContent"]
  },
  "files": [
    "src/pages/products/index.astro",
    "src/pages/products/[slug].astro",
    "src/components/ProductCard.astro"
  ]
}
```

## Common failure modes

| Wrong | Right |
|---|---|
| Reading references for scopes **not** listed in your prompt | Read only the references for your declared scope(s) — the union when it's a merged build dispatch |
| Writing a page/route before the island it mounts (merged dispatch) | Write islands/components FIRST, then the pages — in the prompt's scope order |
| Issuing REST calls from a `components` or `pages` scope | Components/Pages are frontend-only; read `seeded` data from your `.wix/seeded.json` slice (pages only) — never curl |
| Re-querying when your `seeded.<vertical>` slice is missing from `.wix/seeded.json` | Fail fast with `SEEDED_JSON_SLICE_MISSING` — an upstream phase didn't complete (do NOT re-query) |
| Depending on mutable shared state the orchestrator holds in scratch | Every input is inlined; the one shared file you may read is your `.wix/seeded.json` slice (read-only) |
| Inventing class names for layout/spacing/typography (`.productCard`, `.heroSection`) | Tailwind utilities derived from `@theme` tokens (`class="flex flex-col gap-4"`, `class="py-24"`). For one-off page decoration, co-located `<style>` block. |
| Removing a marker after inserting at it | Marker stays; other verticals may contribute after you |
| Trailing narrative prose after the return JSON | JSON block must be the last content |
| Fabricated timestamps in the return JSON | Do not include timing fields — orchestrator captures them |
| Inline `style="color: red"` | Use design tokens: `style="color: var(--color-accent)"` |
| Creating a new cross-cutting class name | Extract a shared primitive component instead |

### Astro/React build-blockers — check before returning `complete`

| Failure | How to detect | Fix |
|---------|---------------|-----|
| HTML-style comments in `.astro` frontmatter | `grep '<!--' *.astro` frontmatter | Use `//` or `/* */` — frontmatter is TypeScript. Surfaces at build as `Legacy HTML single-line comments`. |
| Missing `wixMetadata` on `/products/[slug]` | Check exports | Add the metadata export — required for Wix platform indexing |
| `import { products }` instead of `productsV3` | `grep 'from "@wix/stores"'` import line | V1 silently returns 0 on V3 catalogs |
| Missing `variantId` in cart operations | Check `catalogReference.options` | Always include — single-variant products have one |
| React island using default Tailwind color class | `grep 'bg-blue-\|bg-green-\|text-red-\|bg-gray-' *.tsx` | Use brand `@theme` utilities (`bg-bark`, `text-cream`) or contract class names |