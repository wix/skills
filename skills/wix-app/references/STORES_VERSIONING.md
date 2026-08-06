# Wix Stores Catalog Versioning (V1 / V3)

Wix Stores has two catalog versions that are **NOT backwards compatible**. Apps **must support both** — single-version apps cannot list in the App Market and break on new sites.

| Version | Status | Modules |
|---------|--------|---------|
| **V1_CATALOG** | Legacy | `products`, `collections`, `inventory` |
| **V3_CATALOG** | Current | `productsV3`, `inventoryItemsV3`, `customizationsV3`, `ribbonsV3`, `brandsV3`, `infoSectionsV3` (all from `@wix/stores`); `categories` (from `@wix/categories`) |

---

## Mandatory: Detect Version First

**Every Stores flow must call `catalogVersioning.getCatalogVersion()` before any other Stores operation.** The version is permanent per site — cache it.

```typescript
import { catalogVersioning, products, productsV3 } from '@wix/stores';

export type CatalogVersion = 'V1_CATALOG' | 'V3_CATALOG' | 'STORES_NOT_INSTALLED';
let cached: CatalogVersion | undefined;

export async function getVersion(): Promise<CatalogVersion> {
  if (cached) return cached;
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  cached = catalogVersion as CatalogVersion;
  return cached;
}
```

Handle `STORES_NOT_INSTALLED` gracefully — return empty results, do not throw.

---

## Module Map (V1 → V3)

| Concern | V1 (`@wix/stores`) | V3 (`@wix/stores` unless noted) |
|---------|--------------------|--------------------------------|
| Catalog version | `catalogVersioning` | `catalogVersioning` (same) |
| Products CRUD | `products` | `productsV3` |
| Inventory | `inventory` | `inventoryItemsV3` |
| Collections / Categories | Read: `collections`. **Write ops live on `products`** (`createCollection`, `updateCollection`, `addProductsToCollection`, …) | `@wix/categories` → `categories` |
| Custom text fields | `customTextFields` on product | `customizationsV3` (FREE_TEXT modifier) |
| Ribbons | inline `ribbon` string | `ribbonsV3` |
| Brand | inline `brand` string | `brandsV3` |
| Info sections | inline `additionalInfoSections` | `infoSectionsV3` |
| Subscriptions | dedicated subscriptions API | inline `subscriptionDetails` on product |

---

## Permissions

**Always include `SCOPE.STORES.CATALOG_READ_LIMITED`** — required by `getCatalogVersion()`. Request **both** V1 and V3 scopes for any operation you implement on both code paths.

| Operation | V1 scope | V3 scope |
|-----------|----------|----------|
| Get catalog version | `SCOPE.STORES.CATALOG_READ_LIMITED` | `SCOPE.STORES.CATALOG_READ_LIMITED` |
| Read products | `SCOPE.DC-STORES.READ-PRODUCTS` | `SCOPE.STORES.PRODUCT_READ` |
| Read hidden products / merchant data | `SCOPE.DC-STORES.READ-PRODUCTS` | `SCOPE.STORES.PRODUCT_READ_ADMIN` |
| Create / update / delete products | `SCOPE.DC-STORES.MANAGE-PRODUCTS` | `SCOPE.STORES.PRODUCT_WRITE` |
| Read inventory | `SCOPE.DC-STORES.READ-PRODUCTS` | `SCOPE.STORES.INVENTORY_ITEM_READ` |
| Update inventory | `SCOPE.DC-STORES.MANAGE-PRODUCTS` | `SCOPE.STORES.INVENTORY_ITEM_WRITE` |
| Read orders (unchanged) | `SCOPE.DC-STORES.READ-ORDERS` | `SCOPE.DC-STORES.READ-ORDERS` |
| Manage collections (V1) / categories (V3) | `SCOPE.DC-STORES.MANAGE-PRODUCTS` | `SCOPE.CATEGORIES.CATEGORY_WRITE` |
| Read categories (V3) | — | `SCOPE.CATEGORIES.CATEGORY_READ` |

---

## Major V3 Behavior Changes (gotchas)

1. **Every product has at least one variant.** `manageVariants` is gone. Single-variant products still expose price/sku via `variantsInfo.variants[0]`.
2. **`revision` required on update.** V3 uses optimistic concurrency — fetch current `revision`, pass it back. Each update increments it.
3. **Array fields overwrite, don't merge.** When updating `options`, `modifiers`, or `variantsInfo.variants`, send the entire array. `options` and `variantsInfo.variants` are coupled — update one, update the other.
4. **`queryProducts` (V3) does not return variants.** Use `getProduct` or the Read-Only Variants API.
5. **Hidden products require `SCOPE.STORES.PRODUCT_READ_ADMIN`** for V3 reads. The basic read scope only sees `visible: true`.
6. **Requested fields**: V3 needs `'CURRENCY'`, `'MERCHANT_DATA'`, `'URL'`, `'INFO_SECTION'`, etc. in the `fields` array to populate those fields.
7. **Prices are strings in V3, numbers in V1.** Enums are **UPPER_CASE in V3, lower-case in V1** (`PHYSICAL` vs `physical`).
8. **Categories require a `treeReference`** (`appNamespace` + `treeKey`) — V1 collections did not.
9. **V3 paging is cursor-only — no offset, no total count.** The V3 builder uses `.skipTo(cursor)` (not V1's `.skip(n)`), and the result has `cursors.next` + `hasNext()` but no `totalCount`. Don't build "page X of Y" UI for V3 — use Next/Previous.
10. **V3 product sort fields fail at runtime even when TypeScript accepts them.** TS allows `'_createdDate' | '_updatedDate' | 'slug' | 'visible'`, but real V3 sites return `Field '_createdDate' is not declared as sortable`. **Omit `sort` on V3 product queries** unless verified on a live V3 site.
11. **Stock status is UPPER_SNAKE_CASE on both versions** — `IN_STOCK`, `OUT_OF_STOCK`, `PARTIALLY_OUT_OF_STOCK`, plus `PREORDER` on V3. Never compare against lowercase.

---

## V1 → V3 Field Mapping (most common)

For the full table see the [Catalog V1 to V3 Migration Guide](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/catalog-v1-to-v3-migration-guide?apiView=SDK).

| V1 | V3 |
|----|----|
| `priceData.price` (no discount) | `variantsInfo.variants[i].price.actualPrice.amount` |
| `priceData.price` (with discount) | `variantsInfo.variants[i].price.compareAtPrice.amount` |
| `priceData.discountedPrice` | `variantsInfo.variants[i].price.actualPrice.amount` |
| `priceData.currency` | `currency` (top-level, requested field) |
| `sku`, `weight` (single variant) | `variantsInfo.variants[0].sku` / `physicalProperties.weight` |
| `stock.quantity`, `stock.trackInventory` | Inventory Items API (`inventoryItemsV3`) |
| `stock.inventoryStatus` | `inventory.availabilityStatus` |
| `productType: "physical"` | `productType: "PHYSICAL"` (upper-case) |
| `additionalInfoSections[i]` | `infoSections[i]` (now requires `uniqueName`) |
| `customTextFields[i]` | `modifiers[i]` with `freeTextSettings` |
| `manageVariants: true` (creates variants) | `options[i]` |
| `manageVariants: false` (customizations) | `modifiers[i]` |
| `collectionIds[i]` | `directCategories[i].id` |
| `ribbon`, `brand` (string) | `ribbon.name`, `brand.name` (managed via `ribbonsV3` / `brandsV3`) |
| `media.mainMedia.image.url` (main image URL) | `media.main.image ?? media.main.url` — in V3, `ProductMedia.image` is a `string` (Wix-hosted URL), `url` is a `string` (external URL); check both |
| `lastUpdated` | `updatedDate` |

**Pricing model** — V1 had a `discount` object; V3 removed it. Discounts are now expressed by the relationship between two fields on the variant: `actualPrice` (required, what the customer pays) vs `compareAtPrice` (optional, original price shown struck through). With discount: V1 `price`/`discountedPrice` → V3 `compareAtPrice`/`actualPrice`. Without discount: V1 `price` → V3 `actualPrice`, leave `compareAtPrice` empty.

---

## Webhooks

**Subscribe to BOTH V1 and V3 webhooks** so your app handles every site.

| V1 event | V3 event |
|----------|----------|
| `products.onProductCreated` / `onProductChanged` / `onProductDeleted` | `productsV3.onProductCreated` / `onProductUpdated` / `onProductDeleted` |
| `products.onProductVariantsChanged` | `productsV3.onProductUpdated` (with `variantsInfo` in `modifiedFields`) |
| `products.onProductCollectionCreated` / `onProductCollectionChanged` / `onProductCollectionDeleted` (yes — the collection webhooks live on the `products` namespace) | `categories.onCategoryCreated` / `onCategoryUpdated` / `onCategoryDeleted` |

Payload changes: V1 `changedFields` → V3 `modifiedFields`. Top-level `entityId` on all V3 payloads. V1 created-event entity → V3 `createdEvent.entityAsJson`. Order webhooks are unchanged — use `@wix/ecom` → `orders`.

---

## Detailed references

- [stores/QUERY.md](stores/QUERY.md) — list/query products, pagination, price and stock display
- [stores/GET_PRODUCT.md](stores/GET_PRODUCT.md) — getProduct, options/choices, modifiers, variant choices
- [stores/WRITE.md](stores/WRITE.md) — create, update, delete products
- [stores/INVENTORY.md](stores/INVENTORY.md) — inventory read and write operations
- [stores/CATEGORIES.md](stores/CATEGORIES.md) — collections (V1) ↔ categories (V3)

For methods not listed here, use `SearchWixSDKDocumentation` then `ReadFullDocsArticle`. Always return the required permission scopes to the user.
