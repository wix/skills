---
name: ecom
triggers: []  # Never triggered independently — co-loaded by packs that require it (stores, bookings, etc.)
description: "Vertical-agnostic ecommerce: cart page, checkout redirect, order confirmation"

features:
  - name: "Cart & checkout"
    description: "Add items to cart, review order, check out via Wix's secure hosted checkout. Order confirmation on thank-you page."

apps: []  # No app to install — @wix/ecom works with any installed catalog app

packages:
  - "@wix/ecom"
  - "@wix/redirects"
  - "@wix/site"
  - "@wix/essentials"  # auth.elevate() in src/utils/discounts.ts — ECOM.DISCOUNT_RULES_READ

routes:
  - route: "/cart"
  - route: "/thank-you"
  - route: "Hosted by Wix"   # Wix-hosted endpoint — no .astro file. Listed so the discovery plan's Section C table includes a Checkout row (omitting it created user anxiety in the 2026 dolls-store run; the cart appeared to "go nowhere"). The route cell renders the literal string "Hosted by Wix".
    name: "Checkout"

cmsCollections: []

seed: null  # No data seeding — ecom has no data of its own

components:
  agentLocation: "references/ecom/"
  scope: "components"
  description: "Cart/checkout React islands. CSS is split into the sibling componentsCss scope."
  references: ["references/ecom/CART_WIRING.md"]
  files:
    - "src/components/CartView.tsx"
    - "src/components/CartBadge.tsx"
    - "src/utils/discounts.ts"

componentsCss:
  agentLocation: "references/ecom/"
  scope: "components-css"
  description: "Scoped ecom CSS — components-ecom.css. Runs in parallel with the components scope; reads design tokens + global.css (for leak audit) but no SDK templates. Independent of TSX work because TSX/CSS link is build-time via class names."
  references:
    - "references/ecom/COMPONENTS_CSS.md"
  files:
    - "src/styles/components-ecom.css"

pages:
  - name: "ecom-pages"
    agentLocation: "references/ecom/"
    scope: "pages"
    description: "Mount CartView on cart.astro, wire thank-you.astro, mount CartBadge in Navigation"
    references: ["references/ecom/CART_PAGES.md"]
    files:
      - "src/pages/cart.astro"
      - "src/pages/thank-you.astro"
      - "src/components/Navigation.astro (patch — CartBadge mount only)"

creates:
  - { file: src/components/CartView.tsx,      phase: components }
  - { file: src/components/CartBadge.tsx,     phase: components }
  - { file: src/styles/components-ecom.css,   phase: components }
  - { file: src/utils/discounts.ts,           phase: components }
  - { file: src/pages/cart.astro,             phase: pages }
  - { file: src/pages/thank-you.astro,        phase: pages }

contributes:
  - file: src/components/Navigation.astro
    marker: "<!-- nav:actions -->"
    description: "CartBadge mount point in the nav actions area"

include: false
disabled: false
---

# Ecom Pack

Vertical-agnostic ecommerce cart, checkout, and order confirmation. Co-loaded by any pack that needs cart/checkout (stores, bookings, events) via the `requires` field.

## Why separate from stores

The cart page works with any catalog provider — `@wix/ecom`'s `currentCart` API returns line items with all the display data (name, image, options, availability, price) regardless of which app added the item. CartView, CartBadge, and the checkout flow have zero dependency on `@wix/stores`.

Separating ecom from stores:
- Enables future verticals (bookings, events) to reuse cart/checkout without pulling in the stores agent
- Clarifies ownership boundaries — stores owns the catalog, ecom owns the purchase flow
- Reduces the stores agent's scope and context window usage

## Cross-agent event contract

`cart-updated` CustomEvent on `window`:
- **Dispatchers:** AddToCartButton (stores), CartView (ecom)
- **Listener:** CartBadge (ecom)

## Template files

The `ecom-shared` scope uses real template files at `templates/ecom/` instead of inline markdown code. The agent reads each template, adapts CSS class names to the styling contract, and writes to the project. This reduces markdown size and ensures the agent copies proven code rather than improvising.
