---
name: gift-cards-implementer
description: "Implements the passive Wix Gift Cards vertical — runtime probe util, GiftCardPurchase island, /gift-cards page, and conditional nav/home contributions. Scopes: components, pages. Extends references/shared/IMPLEMENTER.md."
---

# Gift Cards Implementer

Extends `references/shared/IMPLEMENTER.md`. Read that file first for phase routing, REST auth + doc lookups, prompt-inlined inputs (read only your `.wix/seeded.json` slice), return contract, style conventions, and common failure modes.

## Scope routing

| Scope | Phase | Reference |
|-------|-------|-----------|
| `components` | Components (probe util, React island, scoped CSS) | `../astro/gift-cards/COMPONENTS.md` |
| `pages` | Pages (gift-cards landing + Navigation/index patches) | `../astro/gift-cards/PAGES.md` |

This pack has **no `seed` scope** — the dashboard's eGift Card template is the source of truth and we never seed denominations from code.

## Files this vertical creates / contributes

See the § "Templates" list below for the files each scope produces (and the nav/home contributions it patches).

## Pre-return file-existence assertion (pages scope)

Before returning `status: "complete"` from the `pages` scope, verify every file the scope produces (the page templates in § "Templates" below, plus the patched `Navigation.astro` / `index.astro`) exists on disk. If a declared file is missing, return `status: "partial"` with `errors: [{ code: "PHASE4_FILE_MISSING", path: "<expected path>" }]` rather than claiming success.

## Files to write

The `components` scope writes (CSS first, then TS/TSX):
- `src/styles/components-gift-cards.css` — scoped CSS for gift-cards contract classes. First line must be `@reference "./global.css";`. Read `.wix/design-tokens.css` for the token vocabulary.
- `src/utils/gift-cards.ts` — runtime probe util (`getGiftCardProduct()`); module-level cache promise (Navigation, home, and page coalesce to one fetch).
- `src/components/GiftCardPurchase.tsx` — the purchase island.

The `pages` scope writes:
- `src/pages/gift-cards.astro` — gift-cards landing; redirects to `/` when probe returns `null`.
- Inserts at `<!-- nav:links -->` in `Navigation.astro` (the gift-cards nav entry).
- Inserts at `<!-- home:gift-cards -->` in `index.astro` (the home-page teaser).

## Gift-cards-specific failure modes

| Wrong | Right |
|---|---|
| Hardcode denominations in code | Always read `presetVariants` from the live API (`getGiftCardProduct()`) |
| Call `createGiftCardProduct` or any seeding op | Never seed; the dashboard owns the template |
| Wrap calls in `auth.elevate(...)` | The probe is visitor-scoped already; elevation breaks it |
| Forget to import `getGiftCardProduct` when patching `Navigation.astro` or `index.astro` | When inserting at a marker, also add the corresponding import + frontmatter call to that file |
| Drop or rename the marker comment after inserting | Preserve the marker line — future re-runs and other verticals depend on it |
| Render the page when probe returns `null` | Redirect to `/` (`Astro.redirect("/", 302)`) so users following stale links never see a broken page |
| Skip memoization of `getGiftCardProduct()` | Module-level cache promise — Navigation, home, and page render in the same request and must coalesce to one fetch |