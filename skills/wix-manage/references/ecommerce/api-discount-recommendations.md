---
name: "API: Discount Recommendations"
description: Internal API for gathering site data, catalog analytics, product catalog data, and category IDs used by discount recommendation flows. Base URL is manage.wix.com.
layer: L3
---
# API: Discount Recommendations Service

This service provides data-gathering tools used by the discount recommendation flows. These are internal APIs hosted at `manage.wix.com` (not `wixapis.com`).

**Base URL**: `https://manage.wix.com/recommendations`

**Permission**: `ecom:discounts_recommendations:v1:recommendation:build_recommendation`

## How to call these APIs

These endpoints are **not** directly callable as MCP tools. You must use `CallWixSiteAPI` to invoke them:

```
CallWixSiteAPI(
  url: "https://manage.wix.com/recommendations/v1/recommendations/<endpoint>",
  method: "POST",
  siteId: "<siteId>",
  body: { ... }
)
```

**Important**: You must have a `siteId` before calling any of these. Use `ListWixSites` first to resolve the site.

---

## GetSiteData

Retrieves site-level business metrics needed for discount analysis.

**Endpoint**: `POST https://manage.wix.com/recommendations/v1/recommendations/get-site-data-tool`

**Request**:
```json
{
  "fields": ["country", "businessType", "industry", "visitors", "revenue", "ordersCount", "currency", "language"],
  "include": ["currentDiscounts", "AOV", "discountMargin"]
}
```

**Response**:
```json
{
  "country": "US",
  "businessType": "online",
  "industry": "Fashion",
  "visitors": 15000,
  "revenue": 45000,
  "ordersCount": 320,
  "aov": 140,
  "currency": "USD",
  "language": "en-US",
  "currentDiscounts": "YES",
  "discountMargin": 0.25
}
```

| Field | Type | Description |
|---|---|---|
| `country` | string | Site's primary country (ISO alpha-2) |
| `businessType` | string | Type of business |
| `industry` | string | Industry vertical |
| `visitors` | int | Visitors in last 30 days (0-1M) |
| `revenue` | int | Revenue in last 30 days in site currency (0-1M) |
| `ordersCount` | int | Orders in last 30 days (0-1M) |
| `aov` | int | Average order value (revenue / ordersCount) |
| `currency` | string | Store currency code (ISO-4217) |
| `language` | string | Site language code |
| `currentDiscounts` | string | `"YES"` or `"NO"` — whether active discounts exist |
| `discountMargin` | double | Global max discount as decimal (0.25 = 25%) |

**Validation**: If `country`, `industry`, or `revenue` are missing/null, do not proceed with recommendations.

**Note**: `discountMargin` is returned as a decimal (0.25). Convert to percentage by multiplying by 100 (= 25%).

---

## GetCatalogAnalytics

Computes aggregate statistics on the product catalog, grouped by category.

**Endpoint**: `POST https://manage.wix.com/recommendations/v1/recommendations/get-catalog-analytics-tool`

**Request**:
```json
{
  "aggregates": [
    { "op": "count", "field": "price" },
    { "op": "quantiles", "field": "price", "q": [0.5, 0.75, 0.9] },
    { "op": "avg", "field": "profitMargin" }
  ],
  "minMarginPct": 0.15
}
```

**Request fields**:

| Field | Type | Required | Description |
|---|---|---|---|
| `aggregates` | array | Yes | List of aggregation operations (max 100) |
| `aggregates[].op` | enum | Yes | `count`, `sum`, `avg`, `min`, `max`, `stddev`, `quantiles` |
| `aggregates[].field` | enum | Yes | `quantity`, `price`, `cost`, `profit`, `profitMargin`, `ordersCount` |
| `aggregates[].q` | double[] | If QUANTILES | Quantile values 0.0-1.0 (max 20) |
| `minMarginPct` | double | Yes | Min margin filter as decimal (e.g., 0.15 for 15%) |

**Response**:
```json
{
  "categoryGroups": [
    {
      "categoryName": "Electronics",
      "fields": {
        "count()": 45,
        "quantiles([0.5,0.75,0.9],price)": [
          { "quantile": 0.5, "value": 89.99 },
          { "quantile": 0.75, "value": 149.99 },
          { "quantile": 0.9, "value": 299.99 }
        ],
        "avg(profitMargin)": 0.42
      }
    },
    {
      "categoryName": "All Products",
      "fields": {
        "count()": 120,
        "quantiles([0.5,0.75,0.9],price)": [
          { "quantile": 0.5, "value": 59.99 },
          { "quantile": 0.75, "value": 99.99 },
          { "quantile": 0.9, "value": 199.99 }
        ],
        "avg(profitMargin)": 0.35
      }
    }
  ]
}
```

**Aggregates to request per business goal**:

| Goal | Aggregates |
|---|---|
| UPSELL_BOOST | `count(price)`, `quantiles([0.5,0.75,0.9], price)`, `avg(profitMargin)` |
| STOCK_MOVER | `sum(quantity)`, `sum(ordersCount)`, `avg(profitMargin)` |
| SEASONAL | `sum(ordersCount)`, `quantiles([0.5,0.9], price)`, `avg(profitMargin)` |
| BUNDLE_AND_SAVE | `min(price)`, `max(price)`, `avg(profitMargin)`, `count(price)` |

**Important**: Always exclude "All Products" from category-level analysis. Use the "All Products" group only for overall catalog stats (AOV sanity check, price distribution).

---

## GetProductCatalogData

Fetches product-level data for analysis. Returns individual products with pricing, margins, and inventory.

**Endpoint**: `POST https://manage.wix.com/recommendations/v1/recommendations/get-product-catalog-data-tool`

**Request**:
```json
{
  "query": "t-shirts",
  "categoryNames": ["Summer Collection"],
  "businessGoal": "UPSELL_BOOST",
  "minMarginPct": 0.15,
  "catalogLimit": 30
}
```

**Request fields**:

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | No | Keyword filter for products (max 250 chars) |
| `categoryNames` | string[] | No | Category names to restrict search (max 10). Pass empty array if none. |
| `businessGoal` | string | No | `UPSELL_BOOST`, `BUNDLE_AND_SAVE`, `STOCK_MOVER`, or `SEASONAL`. Affects sort order. |
| `minMarginPct` | double | Yes | Min margin filter as decimal (0.15 = 15%) |
| `catalogLimit` | int | No | Max products to return (1-1000, default 30) |

**Sort order by goal** (applied server-side based on `businessGoal`):

| Goal | Sort order |
|---|---|
| UPSELL_BOOST | price DESC, ordersCount DESC |
| BUNDLE_AND_SAVE | price DESC, ordersCount DESC |
| STOCK_MOVER | quantity DESC, ordersCount ASC |
| SEASONAL | ordersCount DESC |

**Response**:
```json
{
  "items": [
    {
      "id": "product-uuid-1",
      "name": "Premium Headphones",
      "description": "Noise-cancelling wireless headphones",
      "brand": "AudioTech",
      "quantity": 85,
      "price": 149.99,
      "profit": 67.50,
      "profitMargin": 0.45,
      "ordersCount": 23
    },
    {
      "id": "product-uuid-2",
      "name": "Bluetooth Speaker",
      "description": "Portable waterproof speaker",
      "brand": "SoundWave",
      "quantity": 210,
      "price": 59.99,
      "profit": 24.00,
      "profitMargin": 0.40,
      "ordersCount": 8
    }
  ]
}
```

**Response item fields**:

| Field | Type | Description |
|---|---|---|
| `id` | string | Product UUID — use this for `productIds` in discount rules |
| `name` | string | Product name |
| `description` | string | Product description |
| `brand` | string | Product brand |
| `quantity` | int | Current stock level |
| `price` | double | Product price |
| `profit` | double | Profit per unit |
| `profitMargin` | double | Profit margin as decimal (0.45 = 45%) |
| `ordersCount` | int | Number of orders in the period |

**Important rules**:
- Always exclude "All Products" from `categoryNames`
- Max 30 items per request is the recommended catalog limit
- If both getCatalogAnalytics and getProductCatalogData fail, fall back to site-wide conservative discount

---

## GetCategoryIds

Converts human-readable category names to GUID IDs. **Must be called before using CATEGORY scope** — never output category names as IDs.

**Endpoint**: `POST https://manage.wix.com/recommendations/v1/recommendations/get-category-ids-tool`

**Request**:
```json
{
  "categoryNames": ["Electronics", "Summer Collection"]
}
```

**Response**:
```json
{
  "categoryIds": [
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "b2c3d4e5-f6a7-8901-bcde-f12345678901"
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `categoryNames` | string[] | Category names to convert (max 10, max 100 chars each) |
| `categoryIds` | string[] | Resolved GUIDs (GUID format) |

**If empty response**: The category name doesn't exist. Fall back to SITE scope and explain: "Could not resolve IDs for category '{name}', using site-wide discount instead."

---

## Usage pattern in discount flows

All discount L4 flows follow this data-gathering pattern:

```
Step 1: Call GetSiteData → get AOV, margins, country, currency
Step 2: Call GetCatalogAnalytics + GetProductCatalogData concurrently
Step 3: If CATEGORY scope needed → call GetCategoryIds to convert names to GUIDs
Step 4: Analyze data and generate recommendation
Step 5: Create discount rule or coupon via the respective API
```

**Single attempt policy**: You get one chance to call GetCatalogAnalytics + GetProductCatalogData. No retries.

**Partial failure handling**:
- If GetCatalogAnalytics succeeds but GetProductCatalogData returns empty: use category name from analytics → call GetCategoryIds
- If both fail: fall back to SITE scope with conservative 5-10% discount using only site data
