# Phase 4 Pages — Gift Cards

Launched in **Step 7** alongside other verticals' `pages` scopes. Writes the `/gift-cards` route and patches `Navigation.astro` + `index.astro` at their declared markers. The Components scope's outputs (`src/utils/gift-cards.ts`, `src/components/GiftCardPurchase.tsx`, `src/styles/components-gift-cards.css`) must already exist before this scope runs.

## Scope

Files this agent OWNS (writes fresh):

- `src/pages/gift-cards.astro` — landing page; redirects to `/` when probe returns null

Files this agent PATCHES (insert at marker, preserve everything else):

- `src/pages/index.astro` — insert home teaser at `<!-- home:gift-cards -->`

Navigation contribution (returned as `data.navContributions`, NOT a direct write):

- The probe-gated "Gift Cards" link is now returned as JSON. The orchestrator collects every Phase 4 agent's `data.navContributions` and invokes `scripts/merge-navigation.mjs` once. See "Section 2 — Navigation contribution" below.

Files this agent MUST NOT touch:
- `src/utils/gift-cards.ts`, `src/components/GiftCardPurchase.tsx`, `src/styles/components-gift-cards.css` — Components scope.
- **`src/components/Navigation.astro`** — direct writes are forbidden. The orchestrator owns this file via the merge script. Stores also contributes at the same `<!-- nav:links -->` marker — the merge script orders contributions deterministically.
- Any other vertical's home contributions.
- `Layout.astro`, `global.css`, or any product/cart/checkout page.

## Critical rules

1. **Marker-based patching.** For `index.astro` only: read the shell file, locate the marker comment (`<!-- home:gift-cards -->`), insert your snippet immediately AFTER the marker line, preserve the marker. For `Navigation.astro`, do NOT patch — return `data.navContributions` instead (Section 2 below).
2. **Inject the import + frontmatter call when patching.** For the `index.astro` home teaser, add `import { getGiftCardProduct } from "../utils/gift-cards";` and `const giftCardProduct = await getGiftCardProduct();` to the frontmatter. For the Navigation contribution, declare the imports + frontmatter lines in `data.navContributions.imports[]` and `data.navContributions.frontmatter[]` — the merge script dedupes them against the designer's existing content.
3. **SSR error guards.** Wrap `getGiftCardProduct()` calls in try/catch with safe fallback (`giftCardsEnabled = false` / `giftCardProduct = null`). See `references/shared/IMPLEMENTER.md` § "SSR error guards". Although the helper itself never throws, the guard cost is zero and protects against future regressions.
4. **Redirect rather than render** when the page-level probe returns null. `if (!product) return Astro.redirect("/", 302);` — same pattern as private/disabled-feature routes elsewhere.
5. **Memoization is per-request.** Navigation, home, and the page may all call `getGiftCardProduct()` on the same request — the helper coalesces them into one fetch. You do not need to thread the result through Astro context.
6. **No HTML comments in `.astro` frontmatter** — frontmatter is TypeScript; use `//` or `/* */`.
7. **Image rendering uses `resolveWixImageUrl`** — the gift-card product's `image` field is a Wix media object identical in shape to product/blog images. Import from `../utils/wix-image`.

## Template files

Snippets to insert at markers live as standalone template fragments. Read each, substitute any contract-class adaptations, paste at the marker.

- `templates/gift-cards.astro` — full landing page
- `templates/_nav-snippet.astro` — single line for `Navigation.astro` (the `{giftCardsEnabled && <a>...</a>}` expression)
- `templates/_home-teaser-snippet.astro` — multi-line block for `index.astro` (the `{giftCardProduct && <section>...</section>}` block)

## Implementation

### 1. `src/pages/gift-cards.astro`

Use template `templates/gift-cards.astro`.

Frontmatter:
```astro
---
import Layout from "../layouts/Layout.astro";
import GiftCardPurchase from "../components/GiftCardPurchase.tsx";
import { getGiftCardProduct } from "../utils/gift-cards";
import { resolveWixImageUrl } from "../utils/wix-image";

const product = await getGiftCardProduct();
if (!product) return Astro.redirect("/", 302);

const heroImage = resolveWixImageUrl(product.image, 800, 800);
---
```

Body: hero image + name + description + `<GiftCardPurchase client:load product={product} />` + fineprint paragraph. All page-level CSS is already shipped via `components-gift-cards.css` (Components scope) — do not duplicate styles inside the `.astro` file's `<style>` block.

### 2. Navigation contribution (returned as `data.navContributions`)

> **Do NOT write `Navigation.astro` from this scope.** Return the contribution as JSON; the orchestrator splices it via `scripts/merge-navigation.mjs` after all Phase 4 agents return. Background subagents writing the same file concurrently produced a real race (this scope + stores both target `<!-- nav:links -->`).

Build the contribution as part of your return JSON:

```json
{
  "data": {
    "navContributions": {
      "imports": [
        "import { getGiftCardProduct } from '../utils/gift-cards';"
      ],
      "frontmatter": [
        "const giftCardsEnabled = (await getGiftCardProduct().catch(() => null)) !== null;"
      ],
      "byMarker": {
        "nav:links": "{giftCardsEnabled && <li class=\"site-nav-item\"><a href=\"/gift-cards\">Gift Cards</a></li>}"
      }
    }
  }
}
```

The merge script:
- Dedupes `imports[]` and `frontmatter[]` against existing content (so if stores already declared a similar guard, only new lines get added).
- Inserts the `byMarker["nav:links"]` snippet immediately after the marker line, in input order (the orchestrator controls render order — typically stores' Shop link first, then gift-cards' link).
- Preserves the marker comment for any future contributions.

### 3. Patch `src/pages/index.astro`

1. Read the file.
2. Add to frontmatter:
   ```astro
   import { getGiftCardProduct } from "../utils/gift-cards";
   import { resolveWixImageUrl } from "../utils/wix-image";

   const giftCardProduct = await getGiftCardProduct();
   const giftCardImage = giftCardProduct
     ? resolveWixImageUrl(giftCardProduct.image, 800, 600)
     : null;
   ```
   (`resolveWixImageUrl` import may already be present from the stores patcher — if so, do not re-import.)
3. Locate the line containing `<!-- home:gift-cards -->`. Insert the teaser snippet immediately after it (see `templates/_home-teaser-snippet.astro`).

## Verification

After writing/patching, grep the project to confirm:
- `Navigation.astro` contains both the marker and the new link expression.
- `index.astro` contains both the marker and the new `<section class="gift-card-teaser">` block.
- `/gift-cards.astro` exists and references `GiftCardPurchase` (Components scope's island).

## Return format

```json
{
  "status": "complete",
  "phase": "gift-cards-pages",
  "scope": "pages",
  "summary": "Wrote /gift-cards page; patched Navigation + home with conditional gift-card surfaces",
  "data": {
    "pageWritten": true,
    "homePatched": true,
    "markersFound": ["<!-- home:gift-cards -->"],
    "navContributions": {
      "imports": ["import { getGiftCardProduct } from '../utils/gift-cards';"],
      "frontmatter": ["const giftCardsEnabled = (await getGiftCardProduct().catch(() => null)) !== null;"],
      "byMarker": {
        "nav:links": "{giftCardsEnabled && <li class=\"site-nav-item\"><a href=\"/gift-cards\">Gift Cards</a></li>}"
      }
    }
  },
  "files": [
    "src/pages/gift-cards.astro",
    "src/pages/index.astro"
  ],
  "errors": []
}
```

If the `<!-- home:gift-cards -->` marker is missing, return `status: "partial"` with `errors: [{ code: "MARKER_NOT_FOUND", file: "src/pages/index.astro", marker: "home:gift-cards" }]`. Do NOT invent your own insertion point — that signals the designer foundation didn't scaffold the shell correctly and should be fixed upstream. For the Navigation contribution, an unknown marker is surfaced by the orchestrator-side merge script (in its `skipped[]` list), not the agent.

## Anti-patterns

| WRONG | CORRECT |
|-------|---------|
| Render the page when probe returns null | `Astro.redirect("/", 302)` |
| Skip the import-injection step (assume another vertical added `getGiftCardProduct`) | Always inject the import + the `await` call when patching, scoped to the file you're touching |
| Replace the marker comment with the inserted snippet | Insert AFTER the marker; preserve the marker line |
| Move CSS into `<style>` blocks inside `.astro` files | Page/teaser CSS lives in `components-gift-cards.css` (Components scope) |
| Hardcode `<title>"Gift Cards"</title>` | Use `title={\`${product.name}\`}` so the dashboard owner controls naming |
| Conditionally re-render the page when the app is enabled later | The Astro page is server-rendered each request — the probe runs every time, so dashboard changes are picked up without rebuild |
