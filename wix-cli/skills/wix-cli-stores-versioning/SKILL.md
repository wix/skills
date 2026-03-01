---
name: wix-cli-stores-versioning
description: "Handle Wix Stores Catalog V1 and V3 API compatibility. Use when building integrations that interact with Wix Stores products, collections, or inventory across different catalog versions."
---

# Wix Stores Catalog Versioning

Build integrations that support both Wix Stores Catalog V1 and V3 APIs. Sites may use either version, and they are **NOT backwards compatible**.

## Quick Start Checklist

- [ ] Check catalog version at flow start
- [ ] Implement version-specific API calls
- [ ] Subscribe to both V1 and V3 webhooks
- [ ] Handle `STORES_NOT_INSTALLED` case

## Core Concept

Wix Stores has two catalog versions:

| Version | Description | Status |
|---------|-------------|--------|
| **V1_CATALOG** | Original Wix Stores API | Legacy, sites will migrate |
| **V3_CATALOG** | Newer API with better performance | Current standard |

**Critical Rules:**
- Always call `getCatalogVersion` before any Stores operation
- Catalog version is permanent per site (won't downgrade)
- V1 webhooks fire for V1 sites, V3 webhooks fire for V3 sites

## Detecting Catalog Version

### JavaScript SDK

```typescript
import { catalogVersioning } from '@wix/stores';

async function getCatalogVersion() {
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  return catalogVersion; // 'V1_CATALOG' | 'V3_CATALOG' | 'STORES_NOT_INSTALLED'
}
```

### With Elevated Permissions (Backend)

```typescript
import { catalogVersioning } from '@wix/stores';
import { auth } from '@wix/essentials';

async function getCatalogVersionElevated() {
  const elevatedGetCatalogVersion = auth.elevate(catalogVersioning.getCatalogVersion);
  const { catalogVersion } = await elevatedGetCatalogVersion();
  return catalogVersion;
}
```

## Version-Aware API Pattern

### Product Creation Example

```typescript
import { catalogVersioning, productsV3, products } from '@wix/stores';
import { auth } from '@wix/essentials';

interface ProductInput {
  name: string;
  description: string;
  price: number;
}

async function createProduct(input: ProductInput) {
  const elevatedGetVersion = auth.elevate(catalogVersioning.getCatalogVersion);
  const { catalogVersion } = await elevatedGetVersion();

  if (catalogVersion === 'STORES_NOT_INSTALLED') {
    throw new Error('Wix Stores is not installed on this site');
  }

  if (catalogVersion === 'V3_CATALOG') {
    return createProductV3(input);
  }
  
  return createProductV1(input);
}

async function createProductV3(input: ProductInput) {
  const elevatedCreate = auth.elevate(productsV3.createProduct);
  return elevatedCreate({
    name: input.name,
    description: input.description,
    productType: 'PHYSICAL',
    variantsInfo: {
      variants: [{
        price: {
          actualPrice: { amount: String(input.price) }
        },
        physicalProperties: {}
      }]
    }
  });
}

async function createProductV1(input: ProductInput) {
  const elevatedCreate = auth.elevate(products.createProduct);
  return elevatedCreate({
    product: {
      name: input.name,
      description: input.description,
      priceData: {
        price: input.price,
      },
    },
  });
}
```

### Query Products Example

```typescript
import { catalogVersioning, productsV3, products } from '@wix/stores';
import { auth } from '@wix/essentials';

async function queryProducts(limit: number = 10) {
  const elevatedGetVersion = auth.elevate(catalogVersioning.getCatalogVersion);
  const { catalogVersion } = await elevatedGetVersion();

  if (catalogVersion === 'STORES_NOT_INSTALLED') {
    return { items: [], totalCount: 0 };
  }

  if (catalogVersion === 'V3_CATALOG') {
    const elevatedQuery = auth.elevate(productsV3.queryProducts);
    const result = await elevatedQuery().limit(limit).find();
    return { items: result.items, totalCount: result.totalCount };
  }

  const elevatedQuery = auth.elevate(products.queryProducts);
  const result = await elevatedQuery().limit(limit).find();
  return { items: result.items, totalCount: result.totalCount };
}
```

## Webhook Handling

Subscribe to **both** V1 and V3 domain events to handle all sites:

### Backend Event Handler Pattern

```typescript
// src/backend/events/product-created-v3.ts
import { products } from '@wix/stores/events';

export const productCreatedV3 = products.onProductCreated(async (event) => {
  console.log('V3 product created:', event.data.product?.id);
  await handleProductCreated(event.data.product);
});

// src/backend/events/product-created-v1.ts
import { catalog } from '@wix/stores/events';

export const productCreatedV1 = catalog.onProductCreated(async (event) => {
  console.log('V1 product created:', event.data.product?.id);
  await handleProductCreated(event.data.product);
});

// Shared handler
async function handleProductCreated(product: unknown) {
  // Your business logic here
}
```

## SDK Module Differences

| Operation | V1 Module | V3 Module |
|-----------|-----------|-----------|
| Products | `products` | `productsV3` |
| Collections | `collections` | `collectionsV3` |
| Inventory | `inventory` | `inventoryV3` |

## Caching Strategy

Catalog version is permanent per site. Cache the result:

```typescript
const versionCache = new Map<string, string>();

async function getCachedCatalogVersion(siteId: string): Promise<string> {
  if (versionCache.has(siteId)) {
    return versionCache.get(siteId)!;
  }
  
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  versionCache.set(siteId, catalogVersion);
  return catalogVersion;
}
```

## Helper Function Pattern

Create a version-aware wrapper for clean code:

```typescript
type CatalogVersion = 'V1_CATALOG' | 'V3_CATALOG' | 'STORES_NOT_INSTALLED';

interface VersionedOperation<T> {
  v1: () => Promise<T>;
  v3: () => Promise<T>;
}

async function withCatalogVersion<T>(
  operations: VersionedOperation<T>
): Promise<T> {
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  
  if (catalogVersion === 'STORES_NOT_INSTALLED') {
    throw new Error('Wix Stores is not installed');
  }
  
  if (catalogVersion === 'V3_CATALOG') {
    return operations.v3();
  }
  
  return operations.v1();
}

// Usage
const product = await withCatalogVersion({
  v1: () => products.getProduct(productId),
  v3: () => productsV3.getProduct(productId),
});
```

## Error Handling

```typescript
async function safeStoresOperation<T>(
  operation: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    const { catalogVersion } = await catalogVersioning.getCatalogVersion();
    
    if (catalogVersion === 'STORES_NOT_INSTALLED') {
      console.warn('Stores not installed, returning fallback');
      return fallback;
    }
    
    return await operation();
  } catch (error) {
    console.error('Stores operation failed:', error);
    return fallback;
  }
}
```

## Complete Integration Example

See [SDK_EXAMPLES.md](references/SDK_EXAMPLES.md) for a complete `StoresService` class with version-aware operations.

## Non-Matching Intents

Do NOT use this skill for:
- General product display (use existing Stores routes)
- Cart/checkout functionality (handled by eCommerce APIs)
- Site components that don't need catalog operations
- Frontend-only implementations without backend API calls

## Verification

After implementation, use [wix-cli-app-validation](../wix-cli-app-validation/SKILL.md) to validate TypeScript compilation, build, and runtime behavior.

## References

- [Wix Stores Catalog Versioning Docs](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/introduction)
- [Catalog V3 API Reference](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3)
- [Catalog V1 API Reference](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1)
