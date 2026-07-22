# Stores — V1 → V3 Field Mapping & Webhooks

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
