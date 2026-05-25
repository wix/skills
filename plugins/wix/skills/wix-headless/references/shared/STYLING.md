# Styling — Three Categories, One Default

Every visual decision in a generated site falls into one of three categories. Each has a single owner and a single home. This file is the canonical reference; designer `INSTRUCTIONS.md` and `IMPLEMENTER.md` link here.

## The three categories

| Category | Lives in | Owned by | Use for |
|---|---|---|---|
| **Tokens (composed as utilities)** | `@theme` block in `src/styles/global.css`, mirrored to `.wix/site.json.designTokens`, `.wix/design-tokens.css`, `.wix/site.d.ts` | Designer (Phase 2) | All color, spacing, typography scale, radii, aspect ratios, shadows, transitions. Pages compose tokens at call sites as Tailwind utilities — `class="py-4xl bg-sand aspect-[16/5]"`. |
| **Global semantic classes** | `src/styles/global.css` (outside `@theme`) and `src/styles/components-<pack>.css` | Designer + Phase 3 component agents | Compound multi-element patterns, interactive states (`:hover`, `:focus`, `:disabled`), and JS/React DOM query targets. |
| **Co-located styles** | `<style>` block at the bottom of the same `.astro` file (or component CSS module for islands) | Page or component author | One-off page decoration: hero stamps, custom dividers, ornamental overlays that won't be reused elsewhere. |

## Default direction

**Tokens-as-utilities is the default.** When you're about to write a class for layout, spacing, typography, alignment, simple background/text color, or aspect ratio, write Tailwind utilities derived from `@theme` instead. The site's design tokens give you `py-4xl`, `gap-sm`, `bg-paper-warm`, `text-ink`, `font-display`, `aspect-[16/5]` etc. Compose them in markup; do not invent semantic classes for these concerns.

The token namespace is the contract. Read `.wix/site.json.designTokens` (or its typed mirror at `.wix/site.d.ts`) at the start of any pages or components scope to know which tokens this run published. If a token you need isn't there, that's a designer-side gap — flag it in your return JSON, don't paper over it with a custom class.

## Decision tree

When you find yourself reaching for a `class="..."` value, ask:

1. **Can this be expressed as 2–4 Tailwind utilities derived from `@theme`?** → Use utilities. Don't create a class.
2. **Is it a compound multi-element pattern** (e.g., a bordered card with header + body + foot rules), an **interactive state** (`:hover`/`:focus`/`:disabled`/`:hover .child`), or a **JS query target** the DOM is inspected for? → Global semantic class in `global.css` (designer-owned) or `components-<pack>.css` (Phase 3 components agent-owned).
3. **Is it a one-off page decoration** that won't be reused on any other route? → Co-located `<style>` block at the bottom of the same `.astro` file. Reference tokens via `var(--color-foo)` from `:root` (auto-loaded by `design-tokens.css`).

If none fit, you're probably trying to do something the tokens don't support yet — talk to the designer (for new runs, return a `MISSING_TOKEN` error; for existing projects, add the token to `@theme` and propagate to `.wix/site.json.designTokens`).

## What does NOT belong as a global semantic class

These are layout/spacing/typography concerns that should always be utilities, never standalone classes:

- Section padding / margins (`py-4xl`, `mt-3xl`, `mb-2xl`)
- Flex / grid layouts (`flex flex-col gap-md`, `grid grid-cols-3 gap-lg`)
- Aspect ratios (`aspect-[4/5]`, `aspect-square`)
- Plain typography choices (`text-display-lg font-display`, `text-mute uppercase tracking-wide`)
- Background / foreground color application without state (`bg-paper`, `text-ink-soft`)
- Container widths derived from tokens (`max-w-prose`, `w-full`)

If a designer's `global.css` contains rules like `.featured-section { padding-block: var(--spacing-4xl); }` or `.product-card-body { display: flex; flex-direction: column; gap: var(--spacing-xs); }`, those are misplaced — they belong in markup as utilities. Inventing such classes ships broken layouts: every consumer needs the designer to have pre-declared the class, and Tailwind v4 silently drops the references when the rule is missing.

## What DOES belong in `global.css` (designer-owned)

The designer's `global.css` is small — tokens plus a short list of truly cross-cutting patterns. Anything specific to a single vertical's component (a product card, a cart row, a discount callout) does NOT belong here. Those live with the component, in `components-<pack>.css` (Phase 3 components agent-owned) or in a co-located `<style>` block inside the component's `.astro` file.

The retained set:

- **Button family** — `btn`, `btn-primary`, `btn-secondary`, `btn-ghost`. Compound + `:hover`/`:disabled`. Used on every page across every vertical.
- **`[data-decorative-slot]`** — cross-cutting decorative pattern; the orchestrator injects images here regardless of vertical.
- **`editorial-rule`** — cross-cutting decorative pattern (gold-rule / accent dividers used by hero/section dividers across verticals).
- **Site shell shells** — `.site-nav`, `.site-footer`, `.nav-progress`. Sticky header, footer scaffold, top progress bar — universal site chrome with markers that verticals contribute into via `<!-- nav:links -->` etc.

That's it. The full list of always-required classes for a site lives in designer `INSTRUCTIONS.md`; this file states the principle.

## Component-specific CSS is owned by the component, not the designer

The boundary that previously caused leaks: the designer published partial rules for `.product-card`, `.product-grid`, `.product-card-media`, `.offer-callout`, `.cart-summary`, etc. — all classes used by exactly one vertical's component. The designer doesn't know how those components should be laid out for a particular brand, so the rules ship as stubs and templates quietly add the missing layout in scoped CSS. Result: the same class behaves differently on different pages (e.g. `/products` rendering with `.product-grid { transition: opacity }` and no `display: grid`, while `/category/<slug>` defines a separate scoped `.product-grid` with the actual grid).

The fix is structural: move component-specific CSS out of `global.css` entirely.

| What | Where it lives | Owner |
|---|---|---|
| `.product-card`, `.product-card-media`, `.product-card-ribbon`, `.product-card-index`, `.product-grid` | `src/styles/components-stores.css` | Stores Phase 3 components agent (or scoped `<style>` in the component's `.astro`) |
| `.offer-callout` family (`-item`, `-badge`, `-name`, `-detail`, `-foot`) | `src/styles/components-stores.css` | Stores Phase 3 components agent |
| `.cart-summary`, `.cart-total`, `.cart-empty`, `.checkout-btn` | `src/styles/components-ecom.css` | Ecom Phase 3 components agent |
| Anything used by exactly one component | Co-located `<style>` block in the component's `.astro` or the matching `components-<pack>.css` | The pack that owns the component |

The Phase 3 components agents already write to `components-<pack>.css` (the file is imported by the designer's `Layout.astro` from the start). This change just makes it the *only* place those classes live — no parallel partial rule in `global.css`.

### Why this is structural

Tokens + truly cross-cutting patterns (buttons, decorative slots, site shell) are stable across verticals and brands — fine for the designer to own. Component-specific layout and spacing evolves with the component. Putting it next to the component means:

- One author per class. No drift.
- Verticals can ship new component variants without round-tripping the designer.
- `overflow: hidden` + `border-radius` traps are caught by the same person who set the radius — no second author who has to *know* the radius value.

### Pre-return checklist for the designer

Before returning the design-system scope, the designer agent runs:

```
grep -r --include="*.astro" --include="*.tsx" -lE "class(\\Name)?=.*(\\.|\\b)(product-card|product-grid|product-card-media|product-card-ribbon|product-card-index|offer-callout|cart-summary|cart-total|cart-empty|checkout-btn)\\b" $SKILL_ROOT/templates/*/
```

For every class name listed above that the designer's `global.css` declares: if any template references it, the class is component-specific and must NOT be in `global.css`. Move the rule to the appropriate `components-<pack>.css` template (or to a scoped `<style>` block in the component template). Do NOT ship a partial rule in `global.css` that the template "completes" — that's the leak this file is preventing.

The check is mechanical and bounded — it scans templates, not the live project.

## Co-located styles — the locality default for one-offs

Astro's `<style>` blocks scope automatically to the `.astro` file by default — no class-name collision risk across routes. When a page needs decoration that doesn't fit utilities and isn't reusable, the rule lives next to its only caller:

```astro
<section class="relative py-4xl">
  <div class="hero-stamp">Made in small batches</div>
</section>

<style>
  .hero-stamp {
    position: absolute;
    bottom: var(--spacing-lg);
    right: var(--spacing-lg);
    background: rgba(27, 26, 23, 0.75);
    color: var(--color-paper);
    padding: 0.5rem 0.875rem;
    font-family: var(--font-display);
    font-style: italic;
  }
</style>
```

No coordination with the designer needed; no entry to forget on the always-required list. If this stamp later becomes a pattern used on three routes, *then* promote it to a global semantic class.

## Why this protocol

The bug class this prevents: markup writers (designer's shells, vertical pages agents, committed templates) and the CSS writer (designer's `global.css`) operate in different phases with no handshake. When the markup writer types a class string the CSS writer didn't pre-declare, Tailwind v4 silently drops it and ships a site with broken styling. Tokens-as-utilities collapses that handshake — there's no class to forget, only utilities derived from a token list everyone reads.
