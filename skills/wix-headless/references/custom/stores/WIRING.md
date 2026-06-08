---
name: custom-stores-wiring
description: "Integration-mode wiring subagent for the stores capability. Connects a brought-in static site's product markup to Wix Stores — replaces hard-coded product cards with live productsV3 queries rendered into the existing DOM template, client-side via @wix/sdk + @wix/stores from CDN. Cart-add + checkout via the ecom guide."
---

# Stores wiring (integration mode)

You wire the **stores capability** into a brought-in static site (`frontend = "custom"`). The design already shows products as **hard-coded sample cards**; you replace the sample data with live `@wix/stores` queries, rendering into the **existing card markup** the design provides. Client-side vanilla JS, `@wix/sdk` from CDN, no build. Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline" first.

## Inputs (inlined by the orchestrator)

- **`appId`** — `OAuthStrategy` `clientId` (from `wix.config.json`).
- **Binding-map entries** for `stores.products` regions: `{ file, anchor, shape, template, bindings, sampleCount }`.
- **Seeded `productIds` / slugs** (from Seed) — so the wired query shows the seeded catalog.
- **`tokens`** — design CSS custom properties (only needed if you add an empty-state node).

## The read-and-render pattern (this is the core; blog/cms reuse it)

For each binding-map list region:

1. **Keep the first sample child as the template.** The region (`anchor`) holds `sampleCount` near-identical children matching `template` (e.g. `article.product-card`). Clone that node per result; remove the remaining static samples. Do **not** restyle — the existing classes carry the design.
2. **Query live data** and **bind fields** by the binding-map `bindings` map (DOM selector relative to template → entity field path).
3. **Render on load**, guard with try/catch; on error leave the original samples visible.

```html
<script type="module">
  import { createClient, OAuthStrategy } from "https://esm.sh/@wix/sdk@1";
  import { productsV3 } from "https://esm.sh/@wix/stores@1";   // V3 — never the V1 `products`

  const wix = createClient({
    modules: { productsV3 },
    auth: OAuthStrategy({ clientId: "REPLACE_WITH_APP_ID" }),
  });

  const grid = document.querySelector("section.product-grid");      // binding-map anchor
  const tpl  = grid?.querySelector("article.product-card");          // binding-map template
  if (grid && tpl) {
    try {
      const { items } = await wix.productsV3
        .queryProducts({ fields: ["CURRENCY"] })
        .limit(12)
        .find();

      const proto = tpl.cloneNode(true);
      grid.replaceChildren(...items.map((p) => {
        const card = proto.cloneNode(true);
        // bindings: selector@attr → field path   (e.g. "img.thumb@src" → media.mainMedia.image.url)
        const img = card.querySelector("img.thumb"); if (img) img.src = p.media?.mainMedia?.image?.url ?? "";
        const name = card.querySelector("h3.name");  if (name) name.textContent = p.name ?? "";
        const price = card.querySelector("span.price"); if (price) price.textContent = p.priceData?.formatted?.price ?? "";
        // description is RICH TEXT — bind plainDescription, never the HTML `description` (see note below)
        const desc = card.querySelector(".description"); if (desc) desc.textContent = p.plainDescription ?? (p.description ?? "").replace(/<[^>]*>/g, "");
        // link to a detail page if the design has one (see "Detail" below)
        const link = card.querySelector("a"); if (link && p.slug) link.href = `/product/${p.slug}`;
        return card;
      }));
    } catch (err) {
      console.error("[wix-stores] product query failed:", err);   // leave samples visible
    }
  }
</script>
```

- **Use `productsV3`**, never V1 `products` (V1 silently returns 0 on V3 catalogs).
- **Description is rich text — bind `p.plainDescription`, never `p.description`.** `description` is HTML/ricos; binding it into `textContent` (or a framework `{…}` expression) renders literal `<p>…</p>` tags. Use `plainDescription` (a plain string), falling back to `description.replace(/<[^>]*>/g, "")` if absent.
- **(create × own only — N/A for brought-in static sites.)** When you *own* the markup (the SPA is generated, not brought in), size every image: Wix media URLs are full-resolution, so an `<img>` with no sizing overflows its card onto the text. Put each image in a fixed `aspect-ratio`/`height` slot with `width:100%; height:100%; object-fit:cover`. A brought-in static site is already sized by its own design — skip this.
- Apply the binding-map's actual selectors/field paths — the snippet's `img.thumb`/`h3.name`/`span.price`/`.description` are illustrative.
- **Categories:** if a region is `categoriesV3`, query `wix.categoriesV3.queryCategories().eq("visible", true).find()` (the builder rejects empty filters — always chain at least one predicate).

## Detail (`shape: "detail"`)

If the design has a product-detail page keyed by slug, read the slug from the URL (`location.pathname`), `queryProducts().eq("slug", slug).find()`, and bind the single result into the detail markup. If there is no detail page, link cards to the catalog or omit links.

## Buy / cart

Add-to-cart and checkout are the **ecom** capability — see `references/custom/ecom/WIRING.md`. If a card has a "Buy"/"Add" control and ecom is in the capability set, the ecom guide wires it; otherwise leave it inert or link to the product.

## Discipline & return

Additive only; render into the existing template; inline `appId`; guard every call (samples are the error fallback). Return per `shared/RETURN_CONTRACT.md`: files edited, anchors wired, query used, seeded IDs surfaced. Missing seeded catalog → note it; the empty query still wires (Seed should have populated it).
