---
name: custom-cms-wiring
description: "Integration-mode wiring subagent for the cms capability. Connects a brought-in static site's repeated content (portfolio items, team, FAQ, resources) to a Wix CMS (Wix Data) collection — live queries rendered into the existing DOM template, client-side via @wix/sdk from CDN. PUBLIC-READ collections only (no auth.elevate on a static site)."
---

# CMS wiring (integration mode)

You wire the **cms capability** into a brought-in static site (`frontend = "custom"`). Replace hard-coded repeated content (portfolio grid, team list, FAQ, resource cards) with live `@wix/data` collection items, rendered into the existing markup. Client-side vanilla JS, `@wix/sdk` from CDN, no build. Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline", and `references/custom/stores/WIRING.md` § "The read-and-render pattern" — cms reuses it.

> **Public-read collections ONLY.** A static site has no server, so **`auth.elevate` is not available** — it needs the app secret. The seeded collection MUST have **public read** permission for anonymous visitors, and integration-mode CMS is **read-only on the client** (visitor writes only via Forms). Seed sets the collection's read permission to public; if a collection isn't public-readable, the query returns nothing — surface that, don't try to elevate.

## Inputs

- **`appId`** — `OAuthStrategy` `clientId`.
- **Binding-map entries** for `data.items`: `{ anchor, template, bindings }` + the **`collectionId`** (from Seed).
- **Seeded `collectionId` + `itemIds`**.

## List

```html
<script type="module">
  import { createClient, OAuthStrategy } from "https://esm.sh/@wix/sdk@1";
  import { items } from "https://esm.sh/@wix/data@1";

  const wix = createClient({ modules: { items }, auth: OAuthStrategy({ clientId: "REPLACE_WITH_APP_ID" }) });

  const COLLECTION = "REPLACE_WITH_COLLECTION_ID";
  const grid = document.querySelector("[data-cms-list], .portfolio-grid");   // binding-map anchor
  const tpl  = grid?.querySelector(".item-card");                            // binding-map template
  if (grid && tpl) {
    try {
      const { items: rows } = await wix.items.query(COLLECTION).limit(50).find();
      const proto = tpl.cloneNode(true);
      grid.replaceChildren(...rows.map((row) => {
        const card = proto.cloneNode(true);
        // bind by the binding-map field paths (collection field keys)
        const title = card.querySelector(".title"); if (title) title.textContent = row.title ?? "";
        const img = card.querySelector("img");       if (img && row.image) img.src = row.image;
        const body = card.querySelector(".body");    if (body) body.textContent = row.description ?? "";
        return card;
      }));
    } catch (err) { console.error("[wix-data] collection query failed:", err); }
  }
</script>
```

Apply the binding-map's actual selectors and the seeded collection's actual field keys. (`@wix/data` `items.query(collectionId)…find()`; `items` lives in `@wix/wix-data-items-sdk` in some SDK versions — use whichever the CDN build exposes for the query/`find` API.)

## Discipline & return

Additive; render into the existing template; inline `appId` + `collectionId`; guard calls; **public-read only** (no elevate). Return per `shared/RETURN_CONTRACT.md`: files edited, anchors wired, `collectionId`, and a flag if the collection wasn't public-readable.
