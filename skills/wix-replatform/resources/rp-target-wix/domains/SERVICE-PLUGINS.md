# Wix service plugins — the fallback when no native primitive fits

A **service plugin** (formerly "SPI") inverts the usual direction: instead of us calling Wix,
**Wix calls us** during one of its own flows, waits for our answer, and continues based on it.
Wix's own phrasing is *"don't call us, we'll call you."*

- Concept: <https://dev.wix.com/docs/build-apps/develop-your-app/extensions/backend-extensions/service-plugins/about-service-plugin-extensions>
- Full catalog: <https://dev.wix.com/docs/build-apps/get-started/overview/how-apps-extend-wix#service-plugins>

## Why this file exists

Every service-plugin surface in every `docs-survey.json` was verdicted `not-relevant` with a
reason along the lines of *"an extension point the site implements, never an import path."*

**The "not an import path" half is correct. The implied "therefore useless to a migration" is
not.** `ecom/discount-rule.json` twice concluded that a WooCommerce buy-X-get-a-different-Y
discount and a bounded quantity tier were both unmappable. Both conclusions were wrong — but for
**two different reasons, which are worth keeping apart**:

| Source shape | Why it looked unmappable | What actually maps it |
|---|---|---|
| Buy X, get a **different** Y | The wrong axis was read: `QUANTITY_BASED` on `discountType`, when BOGO lives on `targetType` | **Native.** `targetType: BUY_X_GET_Y` + `buyXGetYInfo` — no service plugin involved |
| A **bounded** quantity tier (6-10) | A bounded `itemQuantityRange` leaves the rule unrenderable in the dashboard, and the open-ended fallback stacks | **A service plugin** — a Custom Discount Trigger answering yes/no per cart |

Only the second is a service-plugin story, and it is the worked example below. The first belongs to
rung 1 of the ladder — it is the case that proves *read the live enum off the server before
declaring a capability absent*. Conflating them would teach the wrong lesson for both.

A service plugin is never a way to *load records*. It is a way to **supply a capability the
destination lacks** — which is precisely the category of migration gap that otherwise gets written
up as "Wix cannot do this."

## The decision rule

> **Native primitive first, always. A service plugin is the second choice, never the first.**

1. **Find the native primitive.** Read the entity's own object page and, for enums, read the live
   enum off the server's own validation error rather than a doc page — post a bogus value and let
   `UnrecognizedEnumValidator` list the real members. `discount-rule.json`'s
   `buy-x-get-y-is-supported-but-undocumented` pitfall exists because a capability that *was*
   native looked absent in both the published schema and the docs example.
2. **If the primitive exists but the shape is merely awkward, prefer native** — an extra rule per
   tier, a bit more configuration, a field the merchant has to re-enter. Awkward is fine.

   **Awkward is not the same as inexact, and the line is what a customer pays.** Ask: *does this
   shape change who qualifies, or what they are charged?* A widened scope (variation ids resolving
   up to their parent product, so every variant now qualifies) and a lossy field both **fail** that
   test — they are approximations, not awkwardness, and they belong at rung 4 with the gap. An
   earlier version of this list named "a widened scope" as a preferred native fallback; that was
   wrong and it contradicted rung 4.
3. **Only when the destination genuinely has no primitive** for a condition the source depends on,
   consider a service plugin — and price it honestly using the cost list below.
4. **If neither works, it is a real gap — and so is anything you had to approximate to make
   "native" fit.** Record it with the source rule's exact values and say what changed. Never ship
   an approximation silently: an approximated discount is worse than an absent one, because an
   absent one is visible and a wrong one quietly charges the wrong amount.

## What it costs — price this before choosing it

| Cost | Detail |
|---|---|
| **An app** | A service plugin only exists inside a Wix app. Scaffold with `wix generate` → Service Plugin in a Wix CLI project. |
| **Hosting** | The CLI route lets Wix host the endpoints (`wix release`). Self-hosted means you own an HTTPS endpoint and its uptime. |
| **Permanent production infrastructure** | This is the one that matters. The plugin is not a migration script that finishes — it is called on **every cart change, forever**. Uninstall the app and every rule depending on its triggers stops resolving. A migration deliverable that must stay running is a support commitment, not a one-off. |
| **A 3-second budget** | Several plugins document a hard response deadline; a timeout means Wix continues *without* your answer. Degradation is silent. |
| **⚠️ `wix release` publishes the site** | Verified live 2026-08-31: releasing an app version printed `Site published on …` and the storefront went from unpublished to HTTP 200. Never treat "the site is unpublished" as containment for anything, and check for unsafe-when-live state *before* releasing. |

### One supported route: the Wix CLI, inside an app

**Build every service plugin with the Wix CLI as an app extension. That is the only route this
pipeline supports.**

Wix's own docs also describe a per-site **Velo** route and a self-hosted route. Neither is
available here:

- **Velo — not supported.** Do not propose it, do not scaffold it, and do not record it as a
  lighter alternative even though it needs no app. It is out of the product regardless of whether
  it would technically work for a single-site migration.
- **Self-hosted** means owning an HTTPS endpoint and its uptime. The CLI route has Wix host the
  endpoints for you, which is why it is the default here.

So the concrete path is always: `wix generate` → Service Plugin → pick the extension → implement
the handlers → `wix release`.

## Worked example — bounded quantity tiers (PROVEN END TO END, 2026-08-31)

**The gap.** WooCommerce `woo-discount-rules` expresses a bulk discount as mutually exclusive
quantity bands: 1-5 → 5% off, 6-10 → 10%, 11-15 → 15%, 16-20 → 20%, 21+ → 25%. Wix's native
`ITEM_QUANTITY_RANGE` trigger does accept `{from, to}`, but a **bounded** range leaves the rule
unrenderable in the merchant's Automatic Discounts editor. Falling back to open-ended `{from}` is
not equivalent: every lower tier stays true once you pass its minimum and Wix stacks them, so a
21-item cart matched all five tiers for 5+10+15+20+25 = **75% off instead of 25%**. The tiers could
only ship inactive.

**The fix.** The Custom Discount Triggers service plugin answers a plain yes/no per cart, so a band
is expressible exactly and at most one tier is ever eligible.

- Plugin docs: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/custom-discount-triggers-integration-service-plugin/introduction>
- Add it with the CLI: <https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/service-plugins/add-service-plugin-extensions-with-the-wix-cli>

Scaffold it with `wix generate` → Service Plugin → **Ecom Discount Triggers**, which writes a
`<name>.ts` handler file and a `<name>.extension.ts` config file. Keep the decision logic in a third
file with no `@wix` import so it is unit-testable without a deployed app. **Both files below are
complete and copy-pasteable** — this is the whole implementation, not an excerpt.

`bands.ts` — the arithmetic and scope resolution:

```ts
export type Band = { min: number; max: number | null; scopeKey: string | null };

const ID_PREFIX = 'bulk-qty-';

// Product ids per scope key. EMPTY when every listed band is storewide.
// Trigger ids cap at 100 chars and a product GUID is 36, so an id carries a short KEY,
// not the products — which makes a membership change a redeploy, unlike a bounds change.
export const SCOPES: Record<string, readonly string[]> = {};

export const LISTED_BANDS: Band[] = [
  { min: 1, max: 5, scopeKey: null },
  { min: 6, max: 10, scopeKey: null },
  { min: 11, max: 15, scopeKey: null },
  { min: 16, max: 20, scopeKey: null },
  { min: 21, max: null, scopeKey: null },
];

export const bandToId = (b: Band) =>
  `${ID_PREFIX}${b.min}-${b.max === null ? 'plus' : b.max}${b.scopeKey ? `@${b.scopeKey}` : ''}`;

export const bandToName = (b: Band) =>
  b.max === null ? `Cart has ${b.min} or more items` : `Cart has ${b.min}-${b.max} items`;

/** null for anything malformed OR naming a scope this deployment does not define — fail closed. */
export function parseTriggerId(id: string): Band | null {
  if (!id.startsWith(ID_PREFIX)) return null;
  const rest = id.slice(ID_PREFIX.length);
  const at = rest.indexOf('@');
  const scopeKey = at === -1 ? null : rest.slice(at + 1);
  if (scopeKey !== null && !Object.prototype.hasOwnProperty.call(SCOPES, scopeKey)) return null;
  const m = /^(\d+)-(\d+|plus)$/.exec(at === -1 ? rest : rest.slice(0, at));
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] === 'plus' ? null : Number(m[2]);
  if (!Number.isSafeInteger(min) || min < 0) return null;
  if (max !== null && (!Number.isSafeInteger(max) || max < min)) return null;
  return { min, max, scopeKey };
}

export const bandContains = (b: Band, qty: number) =>
  qty >= b.min && (b.max === null || qty <= b.max);

type CartLine = { quantity?: number | null; catalogReference?: { catalogItemId?: string | null } | null };

/** Units (not lines) that count toward this band, filtered to its scope first. */
export function eligibleQuantity(band: Band, lineItems: readonly CartLine[] = []): number {
  const allowed = band.scopeKey === null ? null : new Set(SCOPES[band.scopeKey] ?? []);
  return lineItems.reduce((sum, item) => {
    if (allowed !== null) {
      const id = item?.catalogReference?.catalogItemId;
      if (!id || !allowed.has(id)) return sum;
    }
    return sum + (Number(item?.quantity) || 0);
  }, 0);
}
```

**The proof.** Deployed is not the same as working, so it was verified against live carts. With only
the 6-10 band active, three carts of the same single product were created, calculated, then deleted
(one unit priced P, so the only thing that varies is quantity):

| Cart | Gross | Discount | Result |
|---|---|---|---|
| 3 units | 3P | 0 | no discount — below the band ✅ |
| 7 units | 7P | **exactly 10% of 7P** | discounted, and the applied-discount `name` matched the 6-10 rule ✅ |
| 11 units | 11P | 0 | no discount — **above** the band ✅ |

**The 11-unit row is the one that matters.** Under the old open-ended `{from: 6}` shape it would
also have been discounted, so it is the only case that distinguishes the two implementations: it
proves the plugin is genuinely being consulted and that the band's upper bound holds. A passing
7-unit case alone would have proved nothing. **Design the verification around the case that can
only pass if the new mechanism is live** — for a service plugin that usually means an input the old
behaviour would have answered differently.

Two required handlers. `listTriggers` is static and only feeds the dashboard dropdown;
`getEligibleTriggers` is called on every cart change with the cart's line items:

```ts
import { customTriggers } from '@wix/ecom/service-plugins';
import { LISTED_BANDS, bandToId, bandToName, bandContains, parseTriggerId, eligibleQuantity } from './bands';

customTriggers.provideHandlers({
  // NOTE `_id`, not `id` — see the SDK trap below.
  listTriggers: async () => ({
    customTriggers: LISTED_BANDS.map((band) => ({ _id: bandToId(band), name: bandToName(band) })),
  }),

  getEligibleTriggers: async ({ request }) => {
    const lineItems = request.lineItems ?? [];
    const eligibleTriggers = (request.triggers ?? []).flatMap((trigger) => {
      const id = trigger.customTrigger?._id;
      const identifier = trigger.identifier;
      if (!id || !identifier) return [];
      const band = parseTriggerId(id);                          // null if malformed OR an unknown scope
      if (!band) return [];
      // eligibleQuantity filters the cart to the band's scope BEFORE summing units —
      // see point 0 below. Summing every line item is the scoped-rule bug.
      if (!bandContains(band, eligibleQuantity(band, lineItems))) return [];
      return [{ customTriggerId: id, identifier }];             // echo `identifier` back EXACTLY
    });
    return { eligibleTriggers };
  },
});
```

Each tier then becomes one ordinary `DiscountRule` pointing at the band:

```jsonc
{
  "trigger": {
    "triggerType": "CUSTOM",
    "customTrigger": { "id": "bulk-qty-6-10", "appId": "<your app id>" }
  },
  "discounts": { "values": [{ "targetType": "SPECIFIC_ITEMS", "discountType": "PERCENTAGE", "percentage": 10,
                              "specificItemsInfo": { "scopes": [ /* … */ ] } }] }
}
```

### Four things that generalize to any service plugin

0. **⚠️ Encode the ELIGIBLE SET too, not just the thresholds.** `GetEligibleTriggersRequest`
   carries the cart's line items and the trigger ids, but **not the discount rule's own
   scope**. A handler that sums every line item therefore gets a product-scoped rule wrong:
   for a tier scoped to product A, a cart of 3×A + 3×B sums to 6, activates a 6-10 band and
   discounts A — while the source rule counted 3 eligible units and would not have fired.
   Resolve the scope from the id and filter the cart **before** summing, and fail closed when
   the id names a scope the deployment does not define. Trigger ids cap at 100 characters and
   a product GUID is 36, so ids carry a short scope KEY that resolves to a product list in
   code — which means changing a scope's membership is a redeploy, unlike changing a band's
   bounds. Test the mixed-product cart explicitly; a single-product cart passes either way.
1. **Encode parameters in the trigger/entity id** (`bulk-qty-6-10`, `bulk-qty-21-plus`) and parse
   them at evaluation time. Re-cutting a tier then becomes a *data* edit with no redeploy, and the
   listed set is presentation only.
2. **Keep the decision logic in a module with no `@wix` import** so it is unit-testable without a
   deployed app. The reference implementation's `bands.ts` carries 47 assertions including a
   mutual-exclusivity sweep; the Wix wiring file holds no arithmetic at all.
3. **Fail closed.** An unparseable id resolves to *not eligible*. A permissive default in a
   discount plugin silently discounts every cart on the site.
4. **Echo correlation fields back verbatim.** `identifier` is how Wix matches your answer to the
   rule that asked. Returning only the id applies nothing, with no error.

### The SDK trap, verified 2026-08-31

The SDK renames REST's `id` to `_id` — **inbound only**:

| | Field |
|---|---|
| `getEligibleTriggers` request | `triggers[].customTrigger._id` |
| `listTriggers` response | `customTriggers[]._id` |
| `getEligibleTriggers` response | `eligibleTriggers[].customTriggerId` — **not** renamed |
| `LineItem` | `quantity` — not renamed |

So a correct handler looks internally inconsistent. Writing `id` on the list side compiles clean in
plain JS and returns a trigger list Wix can never match — the discount just never applies and
nothing errors. Read `node_modules/@wix/auto_sdk_ecom_custom-triggers/build/cjs/interfaces-*.d.ts`
rather than the REST docs, and typecheck before releasing.

## Catalog — all 25 service plugins

`Build` is Wix's own column: **CLI** = Wix can host it for you; **self** = self-managed only.
`Gap-closing?` is *our* judgment about whether it could make a migration faithful — only the
Discounts row has actually been used.

### eCommerce / Stores

| Service plugin | Domain | Build | Gap-closing? |
|---|---|---|---|
| [Custom discount triggers](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/custom-discount-triggers-integration-service-plugin/introduction) | `ecom` | CLI | 🟢 **PROVEN** — bounded quantity bands, and any trigger condition Wix lacks |
| [Shipping rates](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/shipping-rates/shipping-rates-integration-service-plugin/introduction) | `ecom` | CLI | 🟡 Likely — the natural home for a source rate table Wix cannot express (see `shipping-option.json`; a free-shipping-over-threshold condition and per-shipping-class costs are both known to fail natively) |
| [Additional fees](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/additional-fees/additional-fees-service-plugin/introduction) | `ecom` | CLI | 🟡 Likely — source surcharges (handling, packaging, COD) with no Wix field |
| [Validations](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/validations/validations-integration-service-plugin/introduction) | `ecom` | CLI | 🟡 Likely — source purchase restrictions (members-only, min/max quantity, region blocks) |
| [Tax calculation](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/tax/tax-calculation-integration-service-plugin/introduction) | `tax` | CLI | 🟡 Possible — only if the source's tax logic exceeds Wix tax groups |
| [Tax groups](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/tax/tax-groups-integration-service-plugin/introduction) | `tax` | self | 🔴 Provider integration, not a migration path |
| [Catalog](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/catalogs/catalog-service-plugin/introduction) | `ecom` | CLI | 🔴 Makes an *external* catalog sellable on Wix. The opposite of a migration — it keeps data at the source |
| [Inventory](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/catalogs/inventory-service-plugin/introduction) | `ecom` | self | 🔴 Same — delegates stock to an external system |
| [Gift vouchers](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/payments/gift-cards/gift-cards-service-plugin/introduction) | `gift-cards` | CLI | 🟡 Worth a look — single-use bearer vouchers are commonly stranded, because Wix rejects a coupon carrying neither scope nor minimum. A voucher provider plugin may be the honest answer |
| [Memberships](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/payments/memberships/memberships-service-plugin/introduction) | `pricing-plans` | self | 🔴 Payment-provider integration |
| [Payment settings (3DS)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/payments/payment-settings/payment-settings-integration-service-plugin/introduction) | `ecom` | CLI | 🔴 Payment configuration, never migrated |
| [Recommendations](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/other-services/recommendations/recommendations-service-plugin/introduction) | `ecom` | self | 🔴 Algorithm provider. Note: source upsell/cross-sell lists are *data* and belong on the product |
| [Product restrictions V3](https://dev.wix.com/docs/api-reference/business-solutions/stores/service-plugins/product-restrictions-v3/introduction) | `stores` | self | 🔴 For dropshipping/POD apps locking product fields |
| [Suppliers Hub marketplace provider](https://dev.wix.com/docs/api-reference/business-solutions/suppliers-hub/marketplace-provider-service-plugin/introduction) | `stores` | CLI | 🔴 Supplier catalog integration |

### Bookings

| Service plugin | Domain | Build | Gap-closing? |
|---|---|---|---|
| [Booking policy](https://dev.wix.com/docs/api-reference/business-solutions/bookings/policies/booking-policy-service-plugin/introduction) | `bookings` | CLI | 🟡 Likely — source cancellation/reschedule windows Wix policies cannot express |
| [Bookings validation](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction) | `bookings` | CLI | 🟡 Likely — source booking constraints |
| [Pricing integration](https://dev.wix.com/docs/api-reference/business-solutions/bookings/pricing/pricing-integration-service-plugin/introduction) | `bookings` | self | 🟡 Possible — source per-service pricing rules |
| [Availability time slots configuration](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/availability-time-slots-configuration-service-plugin/introduction) | `bookings` | CLI | 🟡 Possible — non-standard slot generation |

### Everything else

| Service plugin | Domain | Build | Gap-closing? |
|---|---|---|---|
| [Form submissions](https://dev.wix.com/docs/api-reference/crm/forms/service-plugins/form-submissions-service-plugin/introduction) | `forms` | CLI | 🔴 Adds live validation. Does **not** accept historical submissions, so it cannot carry a source submission archive |
| [SEO keyword suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/seo/seo-keywords-suggestions-service-plugin/introduction) | `seo` | CLI | 🔴 Dashboard suggestions. Note: this is **not** a home for Yoast focus keyphrases (gap §8) — those are per-item data with nowhere to live |
| [External database](https://dev.wix.com/docs/api-reference/business-solutions/cms/external-databases/external-database-service-plugin/introduction) | `cms` | self | 🔴 Keeps data external. Directly opposed to migrating it in |
| [Automations action provider](https://dev.wix.com/docs/api-reference/business-management/automations/actions/action-provider-service-plugin/introduction) | — | self | 🔴 Out of scope |
| [Automations trigger provider](https://dev.wix.com/docs/api-reference/business-management/automations/triggers/trigger-provider-service-plugin/introduction) | — | self | 🔴 Out of scope |
| [Payments provider](https://dev.wix.com/docs/api-reference/business-management/payments/payment-service-provider-service-plugin/introduction) | — | self | 🔴 Payment gateways are re-established by the owner, never migrated |
| [App billing custom charges](https://dev.wix.com/docs/api-reference/app-management/app-billing/custom-charges-service-plugin/introduction) | — | self | 🔴 Out of scope |

⚠️ **Only the Discounts row is verified.** Every 🟡 is a reasoned guess from reading the plugin's
own docs, not a live result. Before promising one to an owner, confirm the handler receives the
inputs your rule needs — that check is what made the discount case work: the decision hinged
entirely on `GetEligibleTriggersRequest` carrying `lineItems[].quantity`.

## When you use one, write it down

A service plugin that closes a gap changes the entity's own knowledge file. Add a pitfall on the
affected entity (as `bounded-quantity-bands-need-a-custom-trigger-spi` does on
`ecom/discount-rule.json`), and add a row here with the verdict promoted from 🟡 to 🟢 plus a
pointer to the implementation.
