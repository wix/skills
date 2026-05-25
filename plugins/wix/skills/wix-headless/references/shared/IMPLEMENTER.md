# Shared Implementer — Common Behavior for Every Vertical Subagent

This file is **extended by every per-vertical `INSTRUCTIONS.md`** (stores, ecom, cms, blog, forms, gift-cards). Per-vertical instruction files are thin — they declare scopes and reference paths. Everything else lives here.

## Self-loading

Read **only** the files your scope needs. The reading set varies by scope:

| Your scope | Mandatory | Conditional |
|---|---|---|
| `seed` | this file, `RETURN_CONTRACT.md`, `MCP_PREFIX.md` | — |
| `components`, `components-css`, `pages`, `pages-*` | this file, `RETURN_CONTRACT.md`, `STYLING.md` | — |
| Image scopes | (read `references/images/INSTRUCTIONS.md` § Self-Loading) | — |

Then read the specific reference(s) for your declared scope (see your vertical's `INSTRUCTIONS.md` scope table). Do NOT read references for scopes other than the one named in your prompt — wastes context and blurs ownership.

## Phase routing

Your prompt includes a line `Scope: <name>`. Map to exactly one reference set per your vertical's `INSTRUCTIONS.md` scope table. If the `Scope:` line is missing, stop and ask the parent — do not guess.

Standard scope names (see architecture-proposal §3):
- `seed` — Seed phase (MCP data setup, no frontend code)
- `components` — Components phase (reusable React/Astro islands, SDK wiring)
- `pages` — Pages phase (route files with visual design + data queries, single scope per vertical)
- `pages-<name>` — Pages phase sub-scope (only when a vertical has multiple pages groups, e.g. stores has `pages-products`, `pages-home-and-nav`)

## MCP tool prefix

Your prompt includes `MCP tool prefix: <prefix>`. Substitute it for `mcp__wix-mcp-remote__` wherever it appears in your reference files. See `references/shared/MCP_PREFIX.md` for discovery rules.

If your scope is `components` or `pages`, you should NOT make MCP calls — those scopes are frontend-only. If you find yourself needing MCP, it's a scope violation — return `status: "partial"` with an error note, do not proceed.

## Reading `.wix/site.json`

Every agent reads `.wix/site.json` at the start of its run. The file is the single source of truth for per-project data:

```jsonc
{
  "brand":        { "name": "...", "description": "..." },
  "seeded":       { "stores": { "products": [...] }, "cms": { "collections": {...} }, ... },
  "designTokens": { "colors": {...}, "fonts": {...}, "radii": {...}, "spacing": {...} },
  "verticals":    ["stores", "ecom", "cms"]
}
```

**Phase-specific reads:**

| Scope | What to read from site.json |
|---|---|
| `seed` | `brand` (for copy generation — product descriptions, FAQ answers). Do NOT read `seeded.<self>` — you're writing it. |
| `components` | `brand`, `designTokens` (via `var(--color-*)` in CSS). |
| `pages` / `pages-*` | `brand`, `seeded.<vertical>` (products, posts, collections), `designTokens`. Page data comes from `seeded`, NOT from re-querying MCP. |

If a required key is missing (e.g. `seeded.stores.products` absent when you're dispatched as `pages-products`), fail fast — return `status: "failed"` with `errors: [{ code: "SITE_JSON_INCOMPLETE", missing: "seeded.stores.products" }]`. Do NOT re-query MCP — the data gap means a seeder didn't complete, and re-querying would mask the real bug.

## Seeders write their data for the orchestrator to aggregate

Agents with `Scope: seed` return their seeded entities in the `data` block of the standard return (see `RETURN_CONTRACT.md`). The parent skill merges your return into `.wix/site.json.seeded.<vertical>` after your run completes. You do NOT write `site.json` yourself — return the data and let the orchestrator aggregate.

## Writing page files

Pages-phase agents write route files (`.astro`) with:

1. **Visual design via design tokens and Tailwind.** Reference tokens as `var(--color-primary)` in `<style>` blocks or `bg-[--color-primary]` as Tailwind arbitrary values. Use canonical component templates (`agents/<vertical>/templates/*.astro`) as starting points — adapt, don't invent.
2. **Data queries against seeded data.** Read the seeded entities from `.wix/site.json.seeded.<vertical>` at build time (Astro frontmatter `import { site } from "../../.wix/site"`) or at request time via the SDK if the page is server-rendered.
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
- **No inline styles beyond design-token CSS variables.** `style={{ color: "red" }}` is forbidden; `style={{ color: "var(--color-primary)" }}` is fine.
- **Tailwind utilities are local to the component.** Don't invent cross-cutting class names. If you need section padding, write `<section class="py-4xl">` — not `<section class="hero-section">`. If you need a flex column with gap, write `class="flex flex-col gap-md"` — not `class="product-card-body"`. If two components need the same look, extract a shared primitive component, not a shared class name. The retained list of legitimate global semantic classes is short and lives in designer `INSTRUCTIONS.md` § "Always-required global semantic classes" — anything outside that list does not belong in `global.css`.
- **Tailwind v4 `@reference` is mandatory in any scoped CSS that uses `@apply`.** Tailwind v4 isolates `@apply` per file — utilities defined in the main entry CSS (where `@theme` lives) are NOT visible to `components-*.css` unless that file prepends `@reference "./global.css";` on line 1. Without it, `wix cli build` fails with `Cannot apply unknown utility class 'gap-sm' …`. **`tsc` and `astro check` both pass clean** — only the bundler catches the regression. If your scope writes a `components-<vertical>.css` that uses `@apply` with theme tokens (e.g., `@apply gap-sm font-display text-sm`), the file MUST start with:
  ```css
  @reference "./global.css";
  ```
  Without it, the build breaks at release time even though `tsc` and `astro check` pass clean — only the bundler catches it.
- **Fail loud, never silently.** If data is missing, a required field is absent, or an MCP call returns an unexpected shape, return `status: "failed"` with details. Do not invent placeholders or swallow errors.

## Return contract

Every agent ends its message with a fenced JSON block per `RETURN_CONTRACT.md`. The JSON MUST be the last content in the message — no trailing prose. Timing fields are NOT included (the orchestrator captures timing via runtime `duration_ms`).

## Common failure modes

| Wrong | Right |
|---|---|
| Reading references for scopes other than the declared `Scope:` | Read only your scope's references |
| Querying MCP from a `components` or `pages` scope | Components/Pages are frontend-only; use `seeded` data from `site.json` |
| Re-querying when `site.json.seeded.<vertical>` is missing | Fail fast with `SITE_JSON_INCOMPLETE` — the seeder didn't complete |
| Writing `.wix/site.json` from a seeder | Seeders return data; orchestrator writes site.json |
| Inventing class names for layout/spacing/typography (`.productCard`, `.heroSection`) | Tailwind utilities derived from `@theme` tokens (`class="flex flex-col gap-md"`, `class="py-4xl"`). For one-off page decoration, co-located `<style>` block. |
| Removing a marker after inserting at it | Marker stays; other verticals may contribute after you |
| Trailing narrative prose after the return JSON | JSON block must be the last content |
| Fabricated timestamps in the return JSON | Do not include timing fields — orchestrator captures them |
| Inline `style="color: red"` | Use design tokens: `style="color: var(--color-primary)"` |
| Creating a new cross-cutting class name | Extract a shared primitive component instead |
