---
name: custom-cms-wiring
description: "Integration-mode wiring subagent for the cms capability. Connects a brought-in static site's repeated content (portfolio items, team, FAQ, resources) to a Wix CMS (Wix Data) collection — live queries rendered into the existing DOM template, client-side via @wix/sdk from CDN. PUBLIC-READ collections only (no auth.elevate on a static site)."
---

# CMS wiring (integration mode)

You wire the **cms capability** into a brought-in (`frontend = "custom"`) frontend. There are **two shapes**, keyed on `frontendBuild` (the *mechanic* is the Build layer's call — `BUILD-own-build.md` § "Wiring cell"; this guide gives the SDK call shapes for both):
- **Static HTML (`none`)** — replace hard-coded repeated content (portfolio grid, team list, FAQ, resource cards) with live `@wix/data` collection items rendered into the existing markup. Client-side vanilla JS, `@wix/sdk` from **CDN**, no build. (§ "List" below.)
- **Framework SPA (`own`)** — a **persistence swap**: rewrite the app's source data layer (or write a fresh data module) to call `@wix/data`, `@wix/sdk` **bundled** via `npm`. (§ "Framework SPA — persistence swap" below.)

Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline", and `references/custom/stores/WIRING.md` § "The read-and-render pattern" — the static cms path reuses it.

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

Apply the binding-map's actual selectors and the seeded collection's actual field keys. The `items` API is the **`items`** named export of **`@wix/data`** (`import { items } from "@wix/data"`; CDN-pinned in the snippet above) — `items.query/insert/update/remove` plus the `bulk*` helpers.

## Framework SPA — persistence swap (`frontendBuild: own`)

When the brought-in (or scaffolded) frontend is a **client-build SPA** with a client-state data layer, the connection is a **persistence swap**, not a `<script>` injection: you **rewrite the source data layer** to call the Wix Data `items` API. The SDK is **bundled** (the app `npm install`ed `@wix/sdk @wix/data`), so you `import` it — **never the CDN `esm.sh` form**. The component tree, JSX, and styling are untouched; only the load/save functions change. This dispatch is keyed on the connection plan's `persistenceSwap` entries (`CONNECTION_PLAN.md` § "(c)"), one per `sourceFile`.

> **Shared/public collection — say so.** The visitor token gives no per-user identity, so the collection is **shared across all visitors** (not per-user, not cross-device). The collection is seeded **public-read + visitor-write**; surface the shared-data caveat (the orchestrator already told the user). Per-user storage needs member auth — deferred.

**Inputs:** `persistenceSwap` entries (`{ sourceFile, dataLayer: {load, save}, inferredShape }`), the seeded `collectionId` per entity-shape, and `appId`.

> **Items API: `import { items } from "@wix/data"`.** The Wix Data items API is the `items` named export of **`@wix/data`** (`items.query/insert/update/remove`, `items.bulk*`). Import it, elevate via `createClient({ modules: { items } })`, and call `wix.items.*`. **Do not** import a namespace from `@wix/wix-data-items-sdk` — `@wix/data` is the single documented package the whole skill uses (`references/astro/cms/CMS_FOUNDATIONS.md`, `SETUP.md`).

> **🛑 `update()` REPLACES the whole item — it does NOT patch.** Per the [docs](https://dev.wix.com/docs/sdk/business-solutions/data/items/introduction): *"Updating a data item replaces the existing item entirely. If the existing item had fields with values and those fields aren't included in the updated item, the values in those properties are lost."* So `update(COLLECTION, { _id, done })` **wipes `text`, `listId`, and every other field** — the classic "toggling done erases the name" bug. **Always send the FULL item** on `update`. A client-state SPA already holds the whole record in memory — pass all of it. (Same footgun the images phase documents for the REST `PUT` — `images/INSTRUCTIONS.md` § "CMS Items".)

**The bundled client + CRUD call shapes** (framework-blind — adapt the *idiom* to React/Vue/Svelte, the calls are identical):

```js
import { createClient, OAuthStrategy } from "@wix/sdk";        // bundled import — NOT esm.sh
import { items } from "@wix/data";                            // Wix Data items API (query/insert/update/remove/bulk*)

const wix = createClient({ modules: { items }, auth: OAuthStrategy({ clientId: "REPLACE_WITH_APP_ID" }) });
const COLLECTION = "REPLACE_WITH_COLLECTION_ID";

// load()  — was: read localStorage / in-memory
export const load = async () => {
  const { items: rows } = await wix.items.query(COLLECTION).limit(100).find();
  return rows;                       // map _id ↔ the app's id field as the app expects
};
// create — was: push to array + persist
export const add    = (item)      => wix.items.insert(COLLECTION, item);            // returns the created item (has _id)
// update — FULL REPLACE: pass the ENTIRE item, not just the changed field(s)
export const update = (item)      => wix.items.update(COLLECTION, item);            // item MUST carry _id + every field to keep
// delete — was: filter out + persist
export const remove = (id)        => wix.items.remove(COLLECTION, id);
```

> **Partial update?** If you only have the id + the one changed field (not the full record), use **`items.bulkPatch(COLLECTION, [id]).setField("done", value).run()`** — `bulkPatch` modifies *only* the named fields and leaves the rest intact (unlike `update`). For the common SPA case the full record is already in state, so a full `update(item)` is simpler and correct.

**Two operations, same call shapes:**
- **connect × own** — *rewrite* the existing data layer in `persistenceSwap.sourceFile`: replace the named `load`/`save` functions/effects with the calls above. Keep the app's existing call sites and state shape; only the bodies change. Map the app's `id` to Wix Data's `_id`. **On every update/toggle, send the full item** (read it from local state and spread all fields) — never `{ _id, oneField }`.
- **create × own** — *write a fresh* data module (e.g. `src/wixData.js`) exposing the `load`/`add`/`update`/`remove` surface the generated components import. No archaeology — the skill controls the source.

**Local-state vs `@wix/data` sync** (optimistic local update + async write-through, vs read-through on every change) is a **per-app judgment the wiring agent makes at runtime** — not a pattern this guide prescribes. Pick what fits the app; keep edits surgical and diffable.

## Discipline & return

Additive; for static (`none`) render into the existing template, for SPA (`own`) rewrite only the data-layer functions; inline `appId` + `collectionId`; guard calls; **public-read only** (no elevate). Return per `shared/RETURN_CONTRACT.md`: files edited, the connection kind (`binding` | `persistenceSwap`), `collectionId`(s), and a flag if the collection wasn't public-readable.
