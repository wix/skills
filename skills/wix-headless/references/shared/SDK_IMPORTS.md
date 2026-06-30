# SDK imports — the legal set (use exactly these)

This is the **closed list of `@wix/*` imports** a build agent may write, per vertical, for the **Astro (Wix-managed) frontend** (`frontendBuild: wix`). Imports are an enumerable, stable surface — so they're pinned here verbatim. **API call shapes are not** — for *how* to call a module (methods, args, current version), read the linked Wix SDK docs; this file fixes only *which* package/module to import.

> **Why this file exists:** the SDK doc pages don't expose the `@wix/*` import string to a reader, so a model authoring from memory invents one. Every import the build has broken on — `getWixClient` from `@wix/astro/client`, `checkout` from `@wix/auto_sdk_ecom_cart-v-2`, a renamed local export — was a guess at this surface. Copy from here; don't derive.

## Rule 0 — there is no client object (the #1 mistake)

Astro + `@wix/astro` authenticates **ambiently**. Import each `@wix/<area>` module and call it **directly** — in `.astro` frontmatter, server routes (`src/pages/api/*.ts`), and `client:*` islands alike.

```ts
import { currentCart } from "@wix/ecom";
await currentCart.addToCurrentCart({ … });   // call the module directly
```

**Never** write any of these — they do not exist in this setup and break the build:
- `getWixClient`, `createClient`, `OAuthStrategy`
- the `@wix/astro/client` subpath (`@wix/astro` exports only `.` and `./builders*`)
- `client.use(<module>)…` (there is no client to construct)

`createClient`/`OAuthStrategy` belong only to the **non-Astro / own-build** path (`references/non-astro.md` / `BUILD-own-build.md`), never here.

## Rule 1 — if a module you need isn't listed below, verify, don't invent

This list covers the common surface. If a capability needs a module not here, confirm the exact export against the **installed** package (`node -e "console.log(Object.keys(require('@wix/<pkg>')))"` or the package's `.d.ts`) before importing it. Never guess an export name or a subpath.

## Cross-cutting (any vertical that queries/render-elevates)
```ts
import { auth } from "@wix/essentials";        // auth.elevate(fn)(...) for SSR reads needing app perms
import { httpClient } from "@wix/essentials";  // httpClient.fetchWithAuth(...) for raw REST from the frontend
import { media } from "@wix/sdk";              // image URL helpers (used by utils/wix-image.ts)
// Skill-shipped local utils — import from local, NOT from a @wix package:
import { resolveWixImageUrl } from "../utils/wix-image";
import { trackEvent } from "../utils/analytics";
```

## Per-vertical

### stores
```ts
import { productsV3, inventoryItemsV3 } from "@wix/stores";          // V3 ONLY
import * as categories from "@wix/auto_sdk_categories_categories";  // NOT @wix/stores "categories"
import { backInStockNotifications, backInStockSettings } from "@wix/ecom";
```
- **Never** import `products` or `collections` from `@wix/stores` — those are V1 and return 0 against the V3 catalog (silently).
- Catalog read/cart contract + the `_id`-not-`id` gotcha: `references/astro/stores/SHARED_WIRING.md`.

### ecom (cart / checkout — co-loaded with stores, bookings, gift-cards, donations)
```ts
import { currentCart } from "@wix/ecom";
import { redirects } from "@wix/redirects";
```
- The discount-rules wrapper (`src/utils/discounts.ts`) is ecom-owned; its exports are pinned in `references/ecom/INSTRUCTIONS.md` (consumers import `fetchLiveOffers`, `offersForProduct`).

### gift-cards
```ts
import { currentCart } from "@wix/ecom";        // buy flow goes through the cart (wixGiftCardsAppNewCatalog: true)
import { httpClient } from "@wix/essentials";   // runtime probe (gift-cards.ts) — fetchWithAuth
```

### bookings
```ts
import { services, categoriesV2 } from "@wix/bookings";
import { availabilityTimeSlots, eventTimeSlots } from "@wix/bookings";   // APPOINTMENT → availabilityTimeSlots; CLASS → eventTimeSlots
import { createCart, calculateCart, placeOrder } from "@wix/auto_sdk_ecom_cart-v-2";  // the cart-v2 sequence — NO "checkout" export
import { redirects } from "@wix/redirects";
import { forms } from "@wix/forms";             // the booking-form schema
```
- **Never** import `checkout` from `@wix/auto_sdk_ecom_cart-v-2` — it isn't exported; the sequence is `createCart → calculateCart → placeOrder` (+ `redirects` to the hosted checkout). Driver contract: `references/bookings/FLOW.md`.

### cms
```ts
import { items } from "@wix/data";
import { auth } from "@wix/essentials";          // wrap reads in auth.elevate(items.query)(...)
```

### forms
```ts
import { forms, submissions } from "@wix/forms";
```

### blog
```ts
import { posts, categories, tags } from "@wix/blog";
import { media } from "@wix/sdk";
// rich content: render post.richContent with @wix/ricos — follow the blog SDK docs for the
// current viewer API; do NOT pin a @wix/ricos version blind.
```
(RSS/sitemap use the `@astrojs/rss` / `@astrojs/sitemap` *integrations* in `astro.config.mjs`, not an SDK import.)
