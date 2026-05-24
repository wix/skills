# Vertical Schema

Each file in `references/verticals/` declares one vertical's contribution to the build flow. The skill reads the user's prompt, loads matching verticals, and assembles the phase-based flow from them.

## File format

Markdown with YAML frontmatter. The frontmatter is the machine-readable config. The markdown body is human-readable docs (what the vertical does, gotchas, examples).

## Frontmatter fields

```yaml
---
# --- Identity ---
name: stores                          # unique vertical name, matches the filename stem
triggers:                             # prompt patterns that route the user to this vertical
  - "sell"
  - "ecommerce"
  - "store"
  - "shop"
description: "Full ecommerce: products, cart, checkout, thank-you"

# --- Dependencies ---
requires: []                          # optional list of vertical names that must be co-loaded
                                      # e.g. stores requires ["ecom"] for cart/checkout

# --- Plan contribution ---
features:                             # human-readable feature blurbs for the plan
  - name: "Product catalog"
    description: "Browse products with images, prices, and variants."
  - name: "Cart & checkout"
    description: "Add to cart, review, check out via Wix's hosted checkout."

# --- Infrastructure ---
apps:                                 # MCP app installs (0 or more per pack)
  - name: "Wix Stores"
    appDefId: "215238eb-22a5-4c36-9e7b-e7c08025e04e"
packages:                             # npm packages to install
  - "@wix/stores"
  - "@wix/ecom"
  - "@wix/redirects"
  - "@wix/site"

# --- Routes this vertical contributes (for plan assembly) ---
# Agent dispatch for rewriting page files lives under the 'pages:' phase entry further down.
routes:
  - route: "/products"
  - route: "/products/[slug]"
    name: "Product Detail"                     # OPTIONAL: user-facing name override for DISCOVERY's Section C table. When omitted, the orchestrator derives the name from the path (/ → "Home"; /thank-you → "Thank You"). Override only when path-derivation produces a poor name (e.g. /products/[slug] would derive to "Products [slug]") OR when the route has no path (ecom's Wix-hosted Checkout uses route: "Hosted by Wix" + name: "Checkout").

# --- CMS collections this vertical declares (if any) ---
cmsCollections: []                    # stores adds none; the cms vertical adds About + FAQ

# --- Seed phase: data seeding (MCP-only, no design-token dependency) ---
seed:
  agentLocation: "references/stores/"
  scope: "seed"
  description: "Delete default sample products, create on-brand products"
  references: ["references/stores/PRODUCT_CATALOG_DATA.md"]

# --- Components phase: shared React/Astro components (runs after Design System, parallel with other verticals' components) ---
components:
  agentLocation: "references/stores/"
  scope: "components"
  description: "SDK-wiring code and reusable islands (reads design tokens + site.d.ts)"
  references: ["references/stores/SHARED_WIRING.md"]
  files:
    - "src/utils/wix-image.ts"
    - "src/utils/analytics.ts"
    - "src/components/SeoTags.astro"
    - "src/components/AddToCartButton.tsx"
    - "src/components/CartBadge.tsx"
    - "src/components/ProductPurchase.tsx"
    - "src/components/CartView.tsx"

# --- Pages phase: route files (written ONCE with both visual design and data queries) ---
pages:
  - name: "product-pages"
    agentLocation: "references/stores/"
    scope: "pages-products"
    references: ["references/stores/PRODUCT_PAGES.md"]
    files:
      - "src/pages/products/index.astro"
      - "src/pages/products/[slug].astro"
      - "src/components/ProductCard.astro"
  - name: "cart-checkout"
    agentLocation: "references/stores/"
    scope: "pages-cart-checkout"
    references: ["references/ecom/CART_PAGES.md"]
    files:
      - "src/pages/cart.astro"
      - "src/pages/thank-you.astro"
  - name: "home-and-nav"
    agentLocation: "references/stores/"
    scope: "pages-home-and-nav"
    references: ["references/stores/HOME_AND_NAV.md"]
    files:
      - "src/pages/index.astro (patch)"
      - "src/components/Navigation.astro (patch)"

# --- File ownership declarations ---
# `creates:` lists files this vertical is the sole author of. Schema validator
#   enforces single-owner (two verticals claiming the same file → fail at session start)
#   and unresolved-import check (if ANY loaded reference imports ../utils/X, some
#   vertical must declare it in `creates:` OR it must be a plugin shared utility).
# `contributes:` lists files this vertical co-edits via named markers. The Design
#   System phase scaffolds shell files (Navigation.astro, index.astro) with markers;
#   each vertical inserts at its marker. Replaces the old `homeSection:` concept —
#   contributes[].description is surfaced in the plan shown to the user.
# Skill-level shared utilities (wix-image.ts, analytics.ts, ricos.ts) are NEVER listed here —
#   they ship via <SKILL_ROOT>/shared-utilities/ and are copied into projects by
#   <SKILL_ROOT>/scripts/seed-utilities.sh during Setup.
creates:
  - { file: src/components/AddToCartButton.tsx, phase: components }
  - { file: src/pages/products/index.astro,     phase: pages }

contributes:
  - file: src/pages/index.astro
    marker: "<!-- home:stores -->"
    description: "Featured products grid (3–6 items from productsV3.queryProducts)"
  - file: src/components/Navigation.astro
    marker: "<!-- nav:links -->"
    description: "Shop menu link → /products"

# --- Loading + activation (orthogonal pack-level flags) ---
include: false                        # if true, the pack loads in every site regardless of triggers/requires (today: only `cms` sets include:true). Default false → loads on trigger match or via another pack's requires.
disabled: false                       # if true, the pack ships its code but its surfaces (pages, nav, home blocks) are inactive by default — they light up only when the user takes a separate action (today: enabling the matching Wix app from the dashboard, detected by a runtime probe). DISCOVERY.md plan composition (Sections B + C) skips features and routes from disabled packs so the plan never promises a surface the user did not ask for. Today only `gift-cards` sets disabled:true. Default false.
---
```

## Field reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Matches filename stem (e.g., `stores.md` → `name: stores`) |
| `triggers` | string[] | yes unless `include: true` | Case-insensitive substrings matched against user prompt |
| `description` | string | yes | Short label for the plan |
| `features` | object[] | yes | Feature blurbs for the plan's "Features" section |
| `apps` | object[] | no | MCP app installs; `{name, appDefId}` pairs |
| `packages` | string[] | yes | npm packages |
| `routes` | object[] | no | `{route, name?}` — routes the pack ships. Optional `name` overrides the path-derived page name in DISCOVERY's Section C. |
| `cmsCollections` | object[] | no | Collections this vertical adds |
| `seed` | object | no | Seed-phase agent config; omit if the vertical has no seeding |
| `components` | object | no | Components-phase agent config; omit if none |
| `pages` | object[] | no | Pages-phase agent dispatch (one entry per page-rewrite sub-scope) |
| `creates` | object[] | no | `{file, phase}` — files this vertical is sole author of. Schema validator enforces single-owner + unresolved-import check. |
| `contributes` | object[] | no | `{file, marker, description}` — files this vertical co-edits via named markers. |
| `include` | bool | no | If true, the pack loads in every site regardless of triggers/requires (today: only `cms`). Controls **loading**. |
| `disabled` | bool | no | If true, the pack ships its code but its surfaces are inactive by default — they light up only via a separate user action (today: enabling the matching Wix app from the dashboard; the pack's runtime probe detects it). DISCOVERY plan composition skips disabled packs from Sections B + C. Today only `gift-cards`. Controls **activation**. |

### `include` vs `disabled` — orthogonal axes

The two flags answer different questions. Don't conflate them:

- **`include`** — *Is this pack in the loaded set?* Default: load when triggers match or another pack pulls it in via `requires:`. `include: true` overrides that and forces the pack to load in every site. Used by `cms` (every site needs About/FAQ).
- **`disabled`** — *Do this pack's surfaces appear without further user action?* Default: yes — the moment the pack is loaded, its routes and contributions are live. `disabled: true` says no — the code ships, but a separate runtime check (today: a dashboard-app probe) decides whether to render. Used by `gift-cards` (the surface only appears once the user enables the Wix Gift Card app from the dashboard).

A pack can be `include: true, disabled: true` (always loaded but never auto-active) or any other combination — they don't conflict.

## How the skill uses the vertical

1. **Discovery step**: scan loaded verticals for `features`, `routes`, `cmsCollections` → assemble plan markdown.
2. **Setup phase**: collect `apps`, `packages` → one MCP call per app, one `npm install` with merged package list.
3. **Seed phase**: for each vertical with a `seed` block, dispatch `seed.agent + scope`.
4. **Design System phase**: Design System agent writes global styling — `@theme` token contract + a small set of always-required global semantic classes (compound patterns, interactive states, JS targets). Layout/spacing/typography flows through tokens-as-utilities at call sites; see `references/shared/STYLING.md`.
5. **Components phase**: for each vertical with a `components` block, dispatch `components.agent + scope` (parallel).
6. **Pages phase**: for each vertical, launch one agent per `pages[*]` entry (parallel).

## Adding a new vertical

1. Create `<name>.md` in this directory with frontmatter per the schema above.
2. Create `references/<name>/` with `INSTRUCTIONS.md` and `references/`.
3. No changes needed to `SKILL.md` or other verticals.

The skill discovers verticals by listing this directory. No registration step.

## Validation (informal)

The skill should sanity-check vertical frontmatter at load time:
- `name` matches filename stem
- `packages` non-empty (empty would mean nothing to install)
- If `seed` is declared, `seed.agentLocation` exists on disk
- If `components` or `pages` declared, their agent locations exist on disk
- All declared `apps`, `routes`, `creates`, `contributes` paths are valid and don't collide with another loaded vertical's owned paths

If validation fails, fail loud — surface the error to the user. A malformed vertical breaking the whole flow is better than silently dropping it.
