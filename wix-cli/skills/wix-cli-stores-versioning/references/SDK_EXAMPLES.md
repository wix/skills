# Wix Stores SDK Examples

Complete SDK examples for V1 and V3 catalog operations.

## SDK Imports

```typescript
// Catalog versioning
import { catalogVersioning } from '@wix/stores';

// V3 Products (newer API)
import { productsV3 } from '@wix/stores';

// V1 Products (legacy API)
import { products } from '@wix/stores';

// For elevated permissions in backend
import { auth } from '@wix/essentials';
```

## Full Backend Service Example

```typescript
// src/backend/stores-service.ts
import { catalogVersioning, productsV3, products } from '@wix/stores';
import { auth } from '@wix/essentials';

type CatalogVersion = 'V1_CATALOG' | 'V3_CATALOG' | 'STORES_NOT_INSTALLED';

class StoresService {
  private cachedVersion: CatalogVersion | null = null;

  async getVersion(): Promise<CatalogVersion> {
    if (this.cachedVersion) {
      return this.cachedVersion;
    }
    
    const elevatedGetVersion = auth.elevate(catalogVersioning.getCatalogVersion);
    const { catalogVersion } = await elevatedGetVersion();
    this.cachedVersion = catalogVersion as CatalogVersion;
    return this.cachedVersion;
  }

  async createProduct(data: {
    name: string;
    description: string;
    price: number;
  }) {
    const version = await this.getVersion();
    
    if (version === 'STORES_NOT_INSTALLED') {
      throw new Error('Wix Stores not installed');
    }

    if (version === 'V3_CATALOG') {
      const elevatedCreate = auth.elevate(productsV3.createProduct);
      return elevatedCreate({
        name: data.name,
        description: data.description,
        productType: 'PHYSICAL',
        variantsInfo: {
          variants: [{
            price: {
              actualPrice: { amount: String(data.price) }
            },
            physicalProperties: {}
          }]
        }
      });
    }

    const elevatedCreate = auth.elevate(products.createProduct);
    return elevatedCreate({
      product: {
        name: data.name,
        description: data.description,
        priceData: { price: data.price },
      },
    });
  }

  async getProducts(limit: number = 10) {
    const version = await this.getVersion();
    
    if (version === 'STORES_NOT_INSTALLED') {
      return { items: [], total: 0 };
    }

    if (version === 'V3_CATALOG') {
      const elevatedQuery = auth.elevate(productsV3.queryProducts);
      const result = await elevatedQuery().limit(limit).find();
      return { items: result.items, total: result.totalCount };
    }

    const elevatedQuery = auth.elevate(products.queryProducts);
    const result = await elevatedQuery().limit(limit).find();
    return { items: result.items, total: result.totalCount };
  }

  async getProduct(productId: string) {
    const version = await this.getVersion();
    
    if (version === 'STORES_NOT_INSTALLED') {
      return null;
    }

    if (version === 'V3_CATALOG') {
      const elevatedGet = auth.elevate(productsV3.getProduct);
      return elevatedGet(productId);
    }

    const elevatedGet = auth.elevate(products.getProduct);
    return elevatedGet(productId);
  }
}

export const storesService = new StoresService();
```

## V3 Product Payload Structure

The V3 API uses a different payload structure than V1:

```typescript
// V3 Create Product payload
const v3ProductPayload = {
  name: "Product Name",
  productType: "PHYSICAL", // or "DIGITAL"
  description: "Product description",
  physicalProperties: {},
  variantsInfo: {
    variants: [{
      price: {
        actualPrice: {
          amount: "29.99"
        }
      },
      physicalProperties: {}
    }]
  }
};

// V1 Create Product payload (legacy)
const v1ProductPayload = {
  product: {
    name: "Product Name",
    productType: "physical",
    description: "Product description",
    priceData: {
      price: 29.99
    }
  }
};
```

## Required Permissions

Add to app configuration:

```
SCOPE.STORES.CATALOG_READ
SCOPE.STORES.CATALOG_WRITE
```
