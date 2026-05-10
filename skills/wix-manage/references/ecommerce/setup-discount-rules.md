---
name: "Setup: Discount Rules"
description: Configures automatic discount rules using the eCommerce Discount Rules API. Covers percentage and fixed-amount discounts, scope targeting (catalog-wide, specific collections, or individual products), and scheduling active periods.
layer: config
---
# Setup Discount Rules

## Prerequisites

- Wix Stores (or another eCommerce business solution) installed on the site
- At least one product in the catalog

## Required APIs

- [Create Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/discount-rules/create-discount-rule)
- [Get Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/discount-rules/get-discount-rule)
- [Query Discount Rules](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/discount-rules/query-discount-rules)
- [Update Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/discount-rules/update-discount-rule)
- [Delete Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/discount-rules/delete-discount-rule)

---

## Step 1: Query existing discount rules

Before creating new rules, check what already exists to avoid conflicts.

**Endpoint**: `POST https://www.wixapis.com/ecom/v1/discount-rules/query`

**Request**:
```json
{
  "query": {
    "paging": {
      "limit": 100
    }
  }
}
```

**Response**:
```json
{
  "discountRules": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "revision": "1",
      "name": "Summer Sale 10%",
      "active": true,
      "activeTimeInfo": {
        "start": "2026-06-01T00:00:00.000Z",
        "end": "2026-08-31T23:59:59.000Z"
      },
      "discounts": [
        {
          "discount": {
            "discountType": "PERCENTAGE",
            "percentage": 10
          },
          "scope": {
            "id": "catalog",
            "type": "CATALOG"
          }
        }
      ]
    }
  ],
  "pagingMetadata": {
    "count": 1,
    "hasNext": false
  }
}
```

Note existing rules and their scopes to avoid stacking conflicts.

---

## Step 2: Create a percentage discount rule

**Endpoint**: `POST https://www.wixapis.com/ecom/v1/discount-rules`

**Request** — 20% off all products:
```json
{
  "discountRule": {
    "name": "Flash Sale 20% Off",
    "active": true,
    "activeTimeInfo": {
      "start": "2026-05-01T00:00:00.000Z",
      "end": "2026-05-03T23:59:59.000Z"
    },
    "discounts": [
      {
        "discount": {
          "discountType": "PERCENTAGE",
          "percentage": 20
        },
        "scope": {
          "id": "catalog",
          "type": "CATALOG"
        }
      }
    ]
  }
}
```

**Response**:
```json
{
  "discountRule": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "revision": "1",
    "name": "Flash Sale 20% Off",
    "active": true,
    "activeTimeInfo": {
      "start": "2026-05-01T00:00:00.000Z",
      "end": "2026-05-03T23:59:59.000Z"
    },
    "discounts": [
      {
        "discount": {
          "discountType": "PERCENTAGE",
          "percentage": 20
        },
        "scope": {
          "id": "catalog",
          "type": "CATALOG"
        }
      }
    ]
  }
}
```

**Request** — 15% off a specific collection:
```json
{
  "discountRule": {
    "name": "Summer Collection Sale",
    "active": true,
    "discounts": [
      {
        "discount": {
          "discountType": "PERCENTAGE",
          "percentage": 15
        },
        "scope": {
          "id": "collection-uuid-here",
          "type": "COLLECTION"
        }
      }
    ]
  }
}
```

---

## Step 3: Create a fixed-amount discount rule

**Request** — $5 off specific products:
```json
{
  "discountRule": {
    "name": "$5 Off Selected Items",
    "active": true,
    "discounts": [
      {
        "discount": {
          "discountType": "FIXED_AMOUNT",
          "fixedAmount": "5.00"
        },
        "scope": {
          "id": "product-uuid-here",
          "type": "SPECIFIC_PRODUCTS"
        }
      }
    ]
  }
}
```

---

## Step 4: Update a discount rule

**Endpoint**: `PATCH https://www.wixapis.com/ecom/v1/discount-rules/{discountRuleId}`

**Request**:
```json
{
  "discountRule": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "revision": "1",
    "name": "Extended Flash Sale 25% Off",
    "discounts": [
      {
        "discount": {
          "discountType": "PERCENTAGE",
          "percentage": 25
        },
        "scope": {
          "id": "catalog",
          "type": "CATALOG"
        }
      }
    ]
  }
}
```

The `revision` field is required and must match the current revision.

---

## Step 5: Deactivate or delete a discount rule

To deactivate without deleting:
```json
{
  "discountRule": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "revision": "2",
    "active": false
  }
}
```

To delete permanently:

**Endpoint**: `DELETE https://www.wixapis.com/ecom/v1/discount-rules/{discountRuleId}`

---

## Key field rules

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Internal name for the rule |
| `active` | Yes | Whether the rule is currently applied |
| `activeTimeInfo.start` | No | ISO 8601 start time. Omit for immediate activation |
| `activeTimeInfo.end` | No | ISO 8601 end time. Omit for no expiration |
| `discounts[].discount.discountType` | Yes | `PERCENTAGE` or `FIXED_AMOUNT` |
| `discounts[].discount.percentage` | If PERCENTAGE | Integer 1-100 |
| `discounts[].discount.fixedAmount` | If FIXED_AMOUNT | Decimal string (e.g., `"5.00"`) |
| `discounts[].scope.type` | Yes | `CATALOG`, `COLLECTION`, or `SPECIFIC_PRODUCTS` |
| `discounts[].scope.id` | Yes | `"catalog"` for CATALOG type, or the collection/product UUID |

## Scope types

| Scope Type | `scope.id` value | Description |
|---|---|---|
| `CATALOG` | `"catalog"` | Applies to all products in the store |
| `COLLECTION` | Collection UUID | Applies to all products in a specific collection |
| `SPECIFIC_PRODUCTS` | Product UUID | Applies to a single product (use multiple discount entries for multiple products) |

## Recommendation → API Mapping

When creating a discount rule from a recommendation output, use this mapping to convert the recommendation's simplified JSON into the actual Discount Rules API payload.

### Constants

- **Store catalog app ID**: `215238eb-22a5-4c36-9e7b-e7c08025e04e` — used in all scope constructions below.
- **Initial state**: Recommendations create rules as `active: false` with `status: "PENDING"`. The merchant must approve before the rule goes live.

### Scope mapping

The recommendation's `scope` field maps to the API's internal scope structure. The scope ID uses a prefix convention:

| Recommendation scope | API scope type | Scope ID prefix | How to build |
|---|---|---|---|
| `SITE` | `CATALOG_ITEM` | `all_` | Set `catalogItemFilter.catalogAppId` to the store catalog app ID. No item IDs. |
| `ITEMS` | `CATALOG_ITEM` | `specific_` | Set `catalogItemFilter.catalogAppId` + `catalogItemFilter.catalogItemIds` to the product UUIDs from `productIds`. |
| `CATEGORY` | `CUSTOM_FILTER` | `collections_` | Set `customFilter.appId` to the store catalog app ID + `customFilter.params.collectionIds` to the category UUIDs from `categoryIds`. |

**Example — SITE scope**:
```json
{
  "scope": {
    "id": "all_215238eb-22a5-4c36-9e7b-e7c08025e04e",
    "type": "CATALOG_ITEM",
    "catalogItemFilter": {
      "catalogAppId": "215238eb-22a5-4c36-9e7b-e7c08025e04e"
    }
  }
}
```

**Example — ITEMS scope** (with product IDs):
```json
{
  "scope": {
    "id": "specific_215238eb-22a5-4c36-9e7b-e7c08025e04e",
    "type": "CATALOG_ITEM",
    "catalogItemFilter": {
      "catalogAppId": "215238eb-22a5-4c36-9e7b-e7c08025e04e",
      "catalogItemIds": ["product-uuid-1", "product-uuid-2"]
    }
  }
}
```

**Example — CATEGORY scope** (with collection IDs):
```json
{
  "scope": {
    "id": "collections_215238eb-22a5-4c36-9e7b-e7c08025e04e",
    "type": "CUSTOM_FILTER",
    "customFilter": {
      "appId": "215238eb-22a5-4c36-9e7b-e7c08025e04e",
      "params": {
        "collectionIds": ["collection-uuid-1"]
      }
    }
  }
}
```

### Discount type mapping

| Recommendation `discountType` | API field to set | Value format |
|---|---|---|
| `PERCENTAGE` | `discount.percentage` | Integer (e.g., `15`) |
| `FIXED_AMOUNT` | `discount.fixedAmount` | String (e.g., `"5.00"`) |
| `FIXED_PRICE` | `discount.fixedPrice` | String (e.g., `"29.99"`) |

All discount entries use `targetType: "SPECIFIC_ITEMS"` with the scope wrapped in `specificItemsInfo.scopes[]`.

### Trigger mapping (conditions)

Triggers determine WHEN the discount activates. They are built from the recommendation's `conditions` fields. **If no conditions exist (both minSubTotal and minItemQuantity are 0), do NOT set a trigger — the discount applies unconditionally.**

| Condition | Trigger type | How to build |
|---|---|---|
| `minItemQuantity > 0` only | `ITEM_QUANTITY_RANGE` | Set `itemQuantityRange.from` to the value. No upper bound. Include the same scope as the discount target. |
| `minSubTotal > 0` only | `SUBTOTAL_RANGE` | Set `subtotalRange.from` to the value as a string. No upper bound. Include the same scope. |
| Both conditions > 0 | `AND` | Combine both triggers in `and.triggers[]` array. |
| Neither condition | No trigger | Leave trigger field unset entirely. |

**Example — minSubTotal trigger** (upsell boost: spend $200+):
```json
{
  "trigger": {
    "triggerType": "SUBTOTAL_RANGE",
    "subtotalRange": {
      "from": "200",
      "scopes": [
        {
          "id": "all_215238eb-22a5-4c36-9e7b-e7c08025e04e",
          "type": "CATALOG_ITEM",
          "catalogItemFilter": {
            "catalogAppId": "215238eb-22a5-4c36-9e7b-e7c08025e04e"
          }
        }
      ]
    }
  }
}
```

**Example — minItemQuantity trigger** (bundle: buy 3+):
```json
{
  "trigger": {
    "triggerType": "ITEM_QUANTITY_RANGE",
    "itemQuantityRange": {
      "from": 3,
      "scopes": [
        {
          "id": "collections_215238eb-22a5-4c36-9e7b-e7c08025e04e",
          "type": "CUSTOM_FILTER",
          "customFilter": {
            "appId": "215238eb-22a5-4c36-9e7b-e7c08025e04e",
            "params": {
              "collectionIds": ["category-uuid"]
            }
          }
        }
      ]
    }
  }
}
```

**Example — AND trigger** (both conditions):
```json
{
  "trigger": {
    "triggerType": "AND",
    "and": {
      "triggers": [
        {
          "triggerType": "ITEM_QUANTITY_RANGE",
          "itemQuantityRange": { "from": 2, "scopes": [/* same scope */] }
        },
        {
          "triggerType": "SUBTOTAL_RANGE",
          "subtotalRange": { "from": "100", "scopes": [/* same scope */] }
        }
      ]
    }
  }
}
```

### Date handling

| Recommendation field | API mapping |
|---|---|
| `startDate` is a date string (e.g., `"2026-06-01"`) | Convert to ISO 8601 timestamp: `activeTimeInfo.start` |
| `startDate` is empty `""` | Default to current time (now) |
| `endDate` is a date string | Convert to ISO 8601 timestamp: `activeTimeInfo.end` |
| `endDate` is empty `""` | Omit `activeTimeInfo.end` — rule has no expiration |

### Settings

All recommendation-created rules use these fixed settings:
```json
{
  "settings": {
    "appliesTo": "ALL_ITEMS",
    "indexOptIn": true
  }
}
```

---

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `DISCOUNT_RULE_NOT_FOUND` | The discount rule ID doesn't exist | Re-query discount rules to get current IDs |
| `REVISION_MISMATCH` | The `revision` doesn't match the current version | Re-fetch the rule to get the latest revision, then retry |
| `INVALID_DISCOUNT_TYPE` | Unsupported discount type | Use `PERCENTAGE` or `FIXED_AMOUNT` |
| Both `productIds` and `categoryIds` set | Scope mutual exclusivity violation | Use only one: ITEMS with productIds OR CATEGORY with categoryIds |
| `productIds` empty when scope is ITEMS | Missing required IDs | Query products and provide at least 1 product UUID |
| `categoryIds` empty when scope is CATEGORY | Missing required IDs | Call getCategoryIds to convert category names to GUIDs |

## References

- [Discount Rules API](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/discount-rules/introduction)
- [Coupons API](https://dev.wix.com/docs/api-reference/business-solutions/coupons/introduction)
