# Phase 4 Pages — Gift Cards

Launched in **Step 7** alongside other verticals' `pages` scopes. Writes the `/gift-cards` route and patches `Navigation.astro` + `index.astro` at their declared markers. The Components scope's outputs (`src/utils/gift-cards.ts`, `src/components/GiftCardPurchase.tsx`, `src/styles/components-gift-cards.css`) must already exist before this scope runs.

## Scope

Files this agent OWNS (writes fresh):

- `src/pages/gift-cards.astro` — landing page; redirects to `/` when probe returns null

Navigation + home contributions (returned as JSON, NOT direct writes):

- The "Gift Cards" link is returned as `data.navContributions` (spliced into `Navigation.astro` by `scripts/merge-navigation.mjs`).
- The home teaser is returned as `data.homeContributions` (spliced into `src/pages/index.astro` by `scripts/merge-home.mjs`).

Files this agent MUST NOT touch:
- `src/utils/gift-cards.ts`, `src/components/GiftCardPurchase.tsx`, `src/styles/components-gift-cards.css` — Components scope.
- Any other vertical's nav/home contributions.
- `Layout.astro`, `global.css`, or any product/cart/checkout page.

## Critical rules

1. **Marker-based patching.** Read the shell file, locate the exact marker comment string (`<!-- nav:links -->` or `<!-- home:gift-cards -->`), insert your snippet immediately AFTER the marker line, preserve the marker line itself. See `references/shared/IMPLEMENTER.md` § "Contributing to shared files via markers".
2. **Inject the import + frontmatter call when patching.** When inserting at `<!-- nav:links -->` in `Navigation.astro`, also add `import { getGiftCardProduct } from "../utils/gift-cards";` and `const giftCardsEnabled = (await getGiftCardProduct()) !== null;` to the file's frontmatter (top of the file). Same for `index.astro`'s home teaser. Do NOT assume another vertical added them.
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

### 2. Patch `src/components/Navigation.astro`

1. Read the file.
2. Add to frontmatter (above the `---` close): `import { getGiftCardProduct } from "../utils/gift-cards"; const giftCardsEnabled = (await getGiftCardProduct()) !== null;` (split across two lines as needed).
3. Locate the line containing `<!-- nav:links -->`. Insert immediately after it:
   ```astro
   {giftCardsEnabled && <a href="/gift-cards">Gift Cards</a>}
   ```
4. If other verticals (stores, blog, forms) already inserted at the same marker, preserve every existing line — your snippet appends.

### 3. Home teaser contribution (returned as `data.homeContributions`)

> **Do NOT write `src/pages/index.astro` from this scope.** Return the contribution as JSON; the orchestrator splices it via `scripts/merge-home.mjs` after all Phase 4 agents return. If the `<!-- home:gift-cards -->` marker is absent from the designer's emission (this is `disabled: true` pack — the designer may have skipped it), the merge script reports it in `skipped[]` with reason `MARKER_NOT_FOUND` — non-fatal, observable.

Build the contribution as part of your return JSON:

```json
{
  "data": {
    "homeContributions": {
      "imports": [
        "import { getGiftCardProduct } from '../utils/gift-cards';",
        "import { resolveWixImageUrl } from '../utils/wix-image';"
      ],
      "frontmatter": [
        "const giftCardProduct = await getGiftCardProduct().catch(() => null);",
        "const giftCardImage = giftCardProduct ? resolveWixImageUrl(giftCardProduct.image, 800, 600) : null;"
      ],
      "byMarker": {
        "home:gift-cards": "{giftCardProduct && (<section class=\"gift-card-teaser\">…teaser snippet from templates/_home-teaser-snippet.astro…</section>)}"
      }
    }
  }
}
```

The merge script dedupes the `resolveWixImageUrl` import against the existing frontmatter (it may already be imported by another pack's contribution). Imports + frontmatter additions are dedupe-safe.

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
    "navigationPatched": true,
    "homePatched": true,
    "markersFound": ["<!-- nav:links -->", "<!-- home:gift-cards -->"],
    "homeContributions": {
      "imports": [
        "import { getGiftCardProduct } from '../utils/gift-cards';",
        "import { resolveWixImageUrl } from '../utils/wix-image';"
      ],
      "frontmatter": [
        "const giftCardProduct = await getGiftCardProduct().catch(() => null);",
        "const giftCardImage = giftCardProduct ? resolveWixImageUrl(giftCardProduct.image, 800, 600) : null;"
      ],
      "byMarker": {
        "home:gift-cards": "{giftCardProduct && (<section class=\"gift-card-teaser\">…</section>)}"
      }
    }
  },
  "files": [
    "src/pages/gift-cards.astro",
    "src/components/Navigation.astro"
  ],
  "errors": []
}
```

> `src/pages/index.astro` is removed from `files[]` — the orchestrator owns home-page writes via `scripts/merge-home.mjs`. The Navigation.astro line predates the navContributions migration (sibling PR).

If the home marker is absent (e.g. the designer skipped `<!-- home:gift-cards -->` because the pack is `disabled`), the merge script reports it in `skipped[]`; the agent should NOT manually patch index.astro to compensate. Surfacing the omission keeps the designer's emission contract honest.

## Anti-patterns

| WRONG | CORRECT |
|-------|---------|
| Render the page when probe returns null | `Astro.redirect("/", 302)` |
| Skip the import-injection step (assume another vertical added `getGiftCardProduct`) | Always inject the import + the `await` call when patching, scoped to the file you're touching |
| Replace the marker comment with the inserted snippet | Insert AFTER the marker; preserve the marker line |
| Move CSS into `<style>` blocks inside `.astro` files | Page/teaser CSS lives in `components-gift-cards.css` (Components scope) |
| Hardcode `<title>"Gift Cards"</title>` | Use `title={\`${product.name}\`}` so the dashboard owner controls naming |
| Conditionally re-render the page when the app is enabled later | The Astro page is server-rendered each request — the probe runs every time, so dashboard changes are picked up without rebuild |
