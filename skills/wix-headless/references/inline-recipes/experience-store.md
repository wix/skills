---
name: "Storefront Experience"
description: The storefront's own design and copy bar, on top of DESIGN.md and CONTENT.md — how to derive a store's direction from its catalog, what the homepage, gallery, product page, and cart must show, the overlay contract, truthful commerce copy, and image discipline. Read when building or wiring a store frontend; the API contract lives in how-to-code-a-store.md.
---
**EXPERIENCE OVERLAY**: What makes a storefront good — read after `DESIGN.md` and `CONTENT.md`

`DESIGN.md` and `CONTENT.md` are the floor for every site. This file adds what is specific to a store. It is the *what* of a good storefront — the API *how* is `how-to-code-a-store.md`. The wiring is necessary, not sufficient: a store whose calls all work but whose homepage repeats the shop page, whose first screen shows no product, or whose cart hides checkout behind a page is not done.

## 1 · Design from the catalog, not from the category

Before choosing tokens, **look at the catalog**: the categories and their depth, the assortment size, the media (count, aspect ratios, background consistency, focal points), the options and price points, the ribbons and sales. Then write the store's direction as a few lines, held with the design tokens:

- a **one-sentence thesis** — the offer, the shopper, the character;
- **three traits**;
- an **avoid-list** of the stereotypes this store would fall into by default: "premium" does not mean dark, serif, minimal; "kids" does not mean primary colors; a bakery is not automatically cream and script. Keep the conventions of the store's own vertical that genuinely help shoppers compare and choose;
- one **signature decision** that makes the store recognizable with the logo hidden, backed by real content — a product form, a material, the category structure, a typographic move;
- a **media treatment** per placement (product, category, hero, fallback): frame ratio, `cover`/`contain`, focal behavior.

Two stores with the same vertical and different catalogs should look nothing alike. Never ask the user for a reference store; if they supply one, take only portable principles (hierarchy, image prominence, rhythm, density), never its layout, palette, typefaces, or taxonomy.

**Audit the media before giving it a role.** Never stretch an image, enlarge a thumbnail into a hero, or crop the product away; give every image a stable aspect ratio and `object-fit` so the grid doesn't jump. When hero-scale media is absent, compose the hero from typography, a product tile, or a collage of what exists. Product photography informs compatible backgrounds and contrast; it does not automatically dictate the UI's dominant color.

## 2 · The surfaces and their bar

- **Global shell:** category navigation from the live tree (a curated menu is fine, but every product-bearing category stays reachable); a persistent cart control with a live count; a footer sized to the real destinations. Announcement, shipping, and returns text only from the merchant.
- **Homepage — a merchandising surface, not the shop page again.** Say what the store sells and give one dominant shopping action in the first viewport; real products from live queries under truthful headings; category discovery when the taxonomy is meaningful. Don't reuse the same first product as hero, first card, and feature. No section exists to fill space — a claim-dependent module with no truthful source is omitted.
- **Gallery — a discovery surface.** Title, result count, sort, the filters the catalog supports, paging; in its default state a **real product card — image, name, price, link — is inside the first viewport**, also on a short desktop window. Skeletons while loading, a distinct "no results for these filters" with a reset, an honest empty catalog, a recoverable error. Filters that stay visible with the results commit immediately; filters in a sheet stage changes until Apply.
- **Product page — a complete purchase decision.** In the first viewport at mobile, tablet, and desktop: a recognizable product image, name, price, the first required choice (or a control that jumps to it), and the buy action with its neutral disabled reason. Then every ribbon, the full description and info sections, a gallery of **every** image, quantity, and — when the catalog has them — subscriptions, preorder, group navigation, notify-me. A sticky buy region must never cover a control.
- **Cart — a side drawer by default**, opened after every successful add and from the header: image, name, the chosen options and text, quantity editing with pending and failure states, line prices, the calculated subtotal and discount, "shipping and taxes calculated at checkout", and checkout **from the drawer**. Persists across navigation and refresh. A separate cart page is optional, never a mandatory step before checkout.
- **Quick add** anchors to its card (an inline or attached panel; a bottom sheet on mobile); a centered dialog is the exception for a demonstrably large configuration, not the default. Its first view shows identity, price, the first required choice, and the action.

## 3 · Overlays (cart drawer, quick add, mobile nav, filter sheet)

Mount at the document root — a `position: fixed` panel inside a header with a `transform`, `filter`, or `backdrop-filter` gets clipped. Full-viewport scrim; background scroll locked and inert; the panel scrolls independently with Close and the primary action always reachable; focus moves in and is trapped while modal; Escape closes; focus returns to the trigger on close (or moves to a successor surface when one overlay opens another). Verify this in the browser — CSS alone doesn't prove it.

## 4 · Truthful commerce copy

- **Claims come from the merchant or the data, never from the page's need for a section.** No invented reviews, ratings, "X people bought this", scarcity, delivery promises, certifications, guarantees, or payment/trust badges.
- **Labels match their source.** "Best Sellers" needs sales data or a category the merchant named that way; the catalog's default order is not a ranking. "Featured" or the category's real name is always safe.
- **Write for shoppers, not implementers.** No Wix IDs, API names, "catalog", "current catalog", "headless", or integration words in headings, labels, buttons, or empty states.
- **Prices tell the truth.** A ribbon is a label, never proof of a discount; a struck price is labelled ("was") and shown only when it is real and higher; a range never gets a lone struck minimum; savings are never computed in the client.
- **Operational text is the merchant's.** A cart says "shipping and taxes calculated at checkout" rather than a number nobody configured.

## 5 · Images

Responsive delivery (`srcset` + `sizes` from scaled Wix media candidates — `how-to-code-a-store.md` § Rendering product images), stable aspect ratios with `width`/`height`, lazy loading below the fold, meaningful `alt` text from the catalog's `altText` or the product name. Failed images get a visible fallback, never a broken icon.
