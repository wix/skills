---
name: gift-cards
triggers: []  # Never triggered independently — co-loaded by packs that include a storefront (stores) via the `requires` field
description: "Conditional gift-card buy page + nav/home contributions. Detects the Wix Gift Card app at runtime; renders only when installed."
requires: ["ecom"]  # buy flow uses currentCart.addToCurrentCart

features:
  - name: "Gift cards (when enabled in dashboard)"
    description: "Customers buy preset-amount gift cards on a dedicated page. Wix issues redeemable codes after payment and emails the recipient. The page, nav link, and home teaser only appear once the Wix Gift Card app is enabled in the dashboard — no rebuild needed."

apps: []  # do NOT auto-install; the user opts in via Catalog → Gift Cards in the dashboard

packages:
  - "@wix/ecom"        # currentCart.addToCurrentCart
  - "@wix/essentials"  # httpClient.fetchWithAuth (REST probe)

routes:
  - route: "/gift-cards"

cmsCollections: []

seed: null  # the dashboard's eGift Card template is the source of truth — never seed denominations from code

components:
  agentLocation: "references/gift-cards/"
  scope: "components"
  description: "Runtime probe util + GiftCardPurchase React island + scoped CSS"
  references: ["references/gift-cards/COMPONENTS.md"]
  files:
    - "src/utils/gift-cards.ts"
    - "src/components/GiftCardPurchase.tsx"
    - "src/styles/components-gift-cards.css"

pages:
  - name: "gift-cards-pages"
    agentLocation: "references/gift-cards/"
    scope: "pages"
    description: "Write /gift-cards landing page (redirects when app is disabled), patch nav link + home teaser via markers"
    references: ["references/gift-cards/PAGES.md"]
    files:
      - "src/pages/gift-cards.astro"
      - "src/components/Navigation.astro (patch — gift-cards link)"
      - "src/pages/index.astro (patch — gift-cards teaser)"

creates:
  - { file: src/utils/gift-cards.ts,            phase: components }
  - { file: src/components/GiftCardPurchase.tsx, phase: components }
  - { file: src/styles/components-gift-cards.css, phase: components }
  - { file: src/pages/gift-cards.astro,         phase: pages }

contributes:
  - file: src/components/Navigation.astro
    marker: "<!-- nav:links -->"
    description: "Gift Cards link → /gift-cards (rendered only when getGiftCardProduct() returns non-null)"
  - file: src/pages/index.astro
    marker: "<!-- home:gift-cards -->"
    description: "Home teaser block (image + lede + CTA), gated on getGiftCardProduct() so it disappears when the app is disabled"

include: false

# disabled: true → the pack ships its code (page file, nav/home contributions),
# but its surfaces are inactive by default. They light up only when the user
# enables the matching app from the Wix dashboard, which the runtime probe in
# `gift-cards.ts` detects per request. DISCOVERY.md plan composition (Sections
# B + C) skips features and routes from disabled packs so the plan never
# promises a surface the user did not opt into.
disabled: true
---

# Gift Cards Pack

Passive vertical: code ships in every site that has a storefront, but every gift-card surface (page, nav link, home teaser) only renders if the **Wix Gift Card app** is enabled in the site's dashboard. A runtime REST probe per request decides — no build-time install, no seeding, no rebuild needed when the app state flips.

## Why passive

The dashboard's Catalog → Gift Cards screen owns the eGift Card template (denominations, image, copy). We never seed it. We never install the app via MCP. Instead:

1. The site owner enables the Wix Gift Card app from their dashboard whenever they want.
2. On every request, `getGiftCardProduct()` probes `POST /gift-cards/v1/gift-card-products/query` and memoizes the result for the request.
3. If the probe returns a product → page renders, nav link shows, home teaser shows. If the probe returns null (app uninstalled, revoked, or the dashboard template not configured) → all three surfaces hide. The page redirects to `/`.

This keeps gift cards as a "lights-up-when-ready" feature rather than a build-time commitment.

## Co-load semantics

This pack is **never user-triggered**. It loads when another pack pulls it in via `requires`. Today the storefront-bearing pack (`stores`) is the only puller; future commerce packs (bookings, events) can opt in the same way.

If a user builds a pure-blog or pure-forms site, this pack does not load — no gift-card code ships, no `/gift-cards` route, no markers requested from the designer.

## Wix Gift Card app reference data

- **App ID** (`WIX_GIFT_CARDS_APP_ID`): `d80111c5-a0f4-47a8-b63a-65b54d774a27`. Captured from a real paid Wix-Editor order line item — not in the public "Apps Created by Wix" registry. Treat as stable; if Wix rotates it, both the runtime probe and buy flow break together (failure mode is identical to "app uninstalled" — page hides gracefully).
- **Probe endpoint**: `POST https://www.wixapis.com/gift-cards/v1/gift-card-products/query`. The auto-package `@wix/auto_sdk_ecom_gift-vouchers` exposes only redemption methods; the buy template is reachable only via REST.
- **Buy-flow `catalogReference` shape** (passed to `currentCart.addToCurrentCart`):
  ```ts
  {
    appId: WIX_GIFT_CARDS_APP_ID,
    catalogItemId: <giftCardProduct.id>,
    options: {
      variantId: <selected preset variantId>,
      quantity: 1,
      giftingInfo: {
        recipientInfo: { email, firstName, lastName },
        greetingMessage,
      },
      wixGiftCardsAppNewCatalog: true,
    },
  }
  ```
- **Post-payment**: on `ORDER_PAID`, Wix's gift-card backend auto-issues a redeemable card with `source: "ORDER"` and emails the recipient. No webhook, no admin scope, no follow-up call required.

## Stores-vertical interaction

When the Wix Gift Card app is enabled, it auto-creates **5 mirror Stores products** (one per denomination, `productType: "DIGITAL"`, ribbon name `"Gift Card"`). They appear in standard product queries and would compete with our `/gift-cards` page (a customer buying the mirror gets a dud DIGITAL line item that does not trigger gift-card issuance).

The `stores` pack drops them in its product queries via `productList.filter(p => p.ribbon?.name !== "Gift Card")`. That filter is owned by stores (not gift-cards) so it protects the listing regardless of whether the gift-cards pack is loaded — a future site that drops gift-cards but still has the dashboard app would still hide the mirrors. See `references/stores/PRODUCT_PAGES.md` § "Gift-card mirror filter".

## References

- `references/gift-cards/COMPONENTS.md` — runtime probe util + React island
- `references/gift-cards/PAGES.md` — landing page + nav/home contributions
