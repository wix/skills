# Context Provider Examples

Complete examples covering all context provider patterns.

## Simple Context Provider

A basic context provider that exposes simple text values:

```json
{
  "type": "wixElements.userContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/user-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useUserContext",
      "moduleSpecifier": "my-user-context"
    }
  },
  "context": {
    "items": {
      "userId": {
        "dataType": "text",
        "displayName": "User ID"
      },
      "userName": {
        "dataType": "text",
        "displayName": "User Name"
      }
    }
  },
  "data": {
    "defaultUserId": {
      "dataType": "text",
      "displayName": "Default User ID"
    }
  }
}
```

```javascript
const { userId, userName } = useUserContext();
// userId: "user_abc123"
// userName: "John Doe"
```

## Array of Strings

```json
{
  "type": "wixElements.productListContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/product-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useProductListContext"
    }
  },
  "context": {
    "items": {
      "products": {
        "dataType": "arrayItems",
        "displayName": "Product List",
        "arrayItems": {
          "item": {
            "dataType": "text"
          }
        }
      }
    }
  },
  "data": {
    "initialProducts": {
      "dataType": "arrayItems",
      "displayName": "Initial Products",
      "arrayItems": {
        "item": {
          "dataType": "text"
        }
      }
    }
  }
}
```

```javascript
const { products } = useProductListContext();
// products: ["iPhone 15", "MacBook Pro", "AirPods Pro", "iPad Air"]
```

## Array of Numbers

```json
{
  "type": "wixElements.scoresContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/scores-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useScoresContext"
    }
  },
  "context": {
    "items": {
      "scores": {
        "dataType": "arrayItems",
        "displayName": "Score List",
        "arrayItems": {
          "item": {
            "dataType": "number"
          }
        }
      },
      "average": {
        "dataType": "number",
        "displayName": "Average Score"
      }
    }
  },
  "data": {
    "maxScore": {
      "dataType": "number",
      "displayName": "Maximum Possible Score"
    }
  }
}
```

```javascript
const { scores, average } = useScoresContext();
// scores: [85, 92, 78, 95, 88]
// average: 87.6
```

## Array of Complex Objects (Locations)

```json
{
  "type": "wixElements.locationsContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/locations-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useLocationsContext"
    }
  },
  "context": {
    "items": {
      "locations": {
        "dataType": "arrayItems",
        "displayName": "Locations",
        "arrayItems": {
          "item": {
            "dataType": "data",
            "data": {
              "items": {
                "latitude": {
                  "dataType": "number",
                  "displayName": "Latitude"
                },
                "longitude": {
                  "dataType": "number",
                  "displayName": "Longitude"
                },
                "address": {
                  "dataType": "text",
                  "displayName": "Address"
                }
              }
            }
          }
        }
      }
    }
  },
  "data": {
    "defaultZoom": {
      "dataType": "number",
      "displayName": "Default Map Zoom Level"
    }
  }
}
```

```javascript
const { locations } = useLocationsContext();
// locations: [
//   { latitude: 40.7128, longitude: -74.0060, address: "New York, NY" },
//   { latitude: 34.0522, longitude: -118.2437, address: "Los Angeles, CA" }
// ]
```

## Nested Arrays (2D Grid)

```json
{
  "type": "wixElements.gridContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/grid-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useGridContext"
    }
  },
  "context": {
    "items": {
      "grid": {
        "dataType": "arrayItems",
        "displayName": "Grid Rows",
        "arrayItems": {
          "item": {
            "dataType": "arrayItems",
            "displayName": "Grid Columns",
            "arrayItems": {
              "item": {
                "dataType": "text"
              }
            }
          }
        }
      },
      "xAxisLabel": {
        "dataType": "textEnum",
        "displayName": "X Axis Label",
        "textEnum": {
          "options": [
            { "value": "column", "displayName": "Column" },
            { "value": "horizontal", "displayName": "Horizontal" }
          ]
        }
      },
      "yAxisLabel": {
        "dataType": "textEnum",
        "displayName": "Y Axis Label",
        "textEnum": {
          "options": [
            { "value": "row", "displayName": "Row" },
            { "value": "vertical", "displayName": "Vertical" }
          ]
        }
      }
    }
  },
  "data": {
    "rows": { "dataType": "number", "displayName": "Number of Rows" },
    "columns": { "dataType": "number", "displayName": "Number of Columns" }
  }
}
```

```javascript
const { grid, xAxisLabel, yAxisLabel } = useGridContext();
// grid: [["A1", "B1", "C1"], ["A2", "B2", "C2"], ["A3", "B3", "C3"]]
// xAxisLabel: "column"
// yAxisLabel: "row"
```

## Complex Object

```json
{
  "type": "wixElements.userProfileContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/user-profile-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useUserProfileContext"
    }
  },
  "context": {
    "items": {
      "profile": {
        "dataType": "data",
        "displayName": "User Profile",
        "data": {
          "items": {
            "firstName": { "dataType": "text", "displayName": "First Name" },
            "lastName": { "dataType": "text", "displayName": "Last Name" },
            "email": { "dataType": "email", "displayName": "Email Address" },
            "age": { "dataType": "number", "displayName": "Age" }
          }
        }
      }
    }
  },
  "data": {
    "defaultProfile": { "dataType": "text", "displayName": "Default Profile" }
  }
}
```

```javascript
const { profile } = useUserProfileContext();
// profile: { firstName: "John", lastName: "Doe", email: "john@example.com", age: 30 }
```

## Array of Complex Objects (Cart)

```json
{
  "type": "wixElements.cartContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/cart-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useCartContext"
    }
  },
  "context": {
    "items": {
      "items": {
        "dataType": "arrayItems",
        "displayName": "Cart Items",
        "arrayItems": {
          "item": {
            "dataType": "data",
            "data": {
              "items": {
                "productId": { "dataType": "text", "displayName": "Product ID" },
                "quantity": { "dataType": "number", "displayName": "Quantity" },
                "price": { "dataType": "number", "displayName": "Price" }
              }
            }
          }
        }
      },
      "total": { "dataType": "number", "displayName": "Total Price" }
    }
  },
  "data": {
    "currency": {
      "dataType": "textEnum",
      "displayName": "Currency",
      "textEnum": {
        "options": [
          { "value": "USD", "displayName": "US Dollar" },
          { "value": "EUR", "displayName": "Euro" }
        ]
      }
    }
  }
}
```

```javascript
const { items, total } = useCartContext();
// items: [{ productId: "prod_001", quantity: 2, price: 29.99 }, ...]
// total: 139.94
```

## TextEnum

```json
{
  "type": "wixElements.subscriptionContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/subscription-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useSubscriptionContext"
    }
  },
  "context": {
    "items": {
      "tier": {
        "dataType": "textEnum",
        "displayName": "Subscription Tier",
        "textEnum": {
          "options": [
            { "value": "basic", "displayName": "Basic" },
            { "value": "premium", "displayName": "Premium" },
            { "value": "enterprise", "displayName": "Enterprise" }
          ]
        }
      }
    }
  },
  "data": {
    "defaultTier": {
      "dataType": "textEnum",
      "displayName": "Default Tier",
      "textEnum": {
        "options": [
          { "value": "basic", "displayName": "Basic" },
          { "value": "premium", "displayName": "Premium" },
          { "value": "enterprise", "displayName": "Enterprise" }
        ]
      }
    }
  }
}
```

```javascript
const { tier } = useSubscriptionContext();
// tier: "enterprise" (one of: "basic", "premium", "enterprise")
```

## Functions with Parameters (Shopping Cart)

```json
{
  "type": "wixElements.shoppingCartContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/shopping-cart-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useShoppingCartContext",
      "moduleSpecifier": "my-shopping-cart"
    }
  },
  "context": {
    "items": {
      "cartItems": {
        "dataType": "arrayItems",
        "displayName": "Cart Items",
        "arrayItems": {
          "item": {
            "dataType": "data",
            "data": {
              "items": {
                "productId": { "dataType": "text", "displayName": "Product ID" },
                "name": { "dataType": "text", "displayName": "Product Name" },
                "quantity": { "dataType": "number", "displayName": "Quantity" },
                "unitPrice": { "dataType": "number", "displayName": "Unit Price" }
              }
            }
          }
        }
      },
      "totalItems": { "dataType": "number", "displayName": "Total Items Count" },
      "totalPrice": { "dataType": "number", "displayName": "Total Price" },
      "addItem": {
        "dataType": "function",
        "displayName": "Add Item to Cart",
        "function": {
          "parameters": [
            { "dataType": "text", "displayName": "Product ID", "description": "The ID of the product to add" },
            { "dataType": "number", "displayName": "Quantity", "description": "Number of items to add", "optional": true }
          ],
          "async": false
        }
      },
      "removeItem": {
        "dataType": "function",
        "displayName": "Remove Item from Cart",
        "function": {
          "parameters": [
            { "dataType": "text", "displayName": "Product ID", "description": "The ID of the product to remove" }
          ],
          "async": false
        }
      },
      "updateQuantity": {
        "dataType": "function",
        "displayName": "Update Item Quantity",
        "function": {
          "parameters": [
            { "dataType": "text", "displayName": "Product ID", "description": "The ID of the product to update" },
            { "dataType": "number", "displayName": "New Quantity", "description": "The new quantity for the item" }
          ],
          "async": false
        }
      },
      "clearCart": {
        "dataType": "function",
        "displayName": "Clear Cart",
        "function": {
          "parameters": [],
          "async": false
        }
      },
      "checkout": {
        "dataType": "function",
        "displayName": "Checkout",
        "function": {
          "parameters": [
            { "dataType": "text", "displayName": "Payment Method", "description": "The payment method to use" }
          ],
          "returns": {
            "dataType": "data",
            "displayName": "Checkout Result",
            "data": {
              "items": {
                "success": { "dataType": "booleanValue", "displayName": "Success" },
                "orderId": { "dataType": "text", "displayName": "Order ID" },
                "message": { "dataType": "text", "displayName": "Message" }
              }
            }
          },
          "async": true
        }
      }
    }
  },
  "data": {
    "currency": {
      "dataType": "textEnum",
      "displayName": "Currency",
      "textEnum": {
        "options": [
          { "value": "USD", "displayName": "US Dollar" },
          { "value": "EUR", "displayName": "Euro" },
          { "value": "GBP", "displayName": "British Pound" }
        ]
      }
    },
    "taxRate": { "dataType": "number", "displayName": "Tax Rate (%)" }
  }
}
```

```javascript
const { cartItems, totalItems, totalPrice, addItem, removeItem, updateQuantity, clearCart, checkout } = useShoppingCartContext();

addItem("prod_003");           // Add 1 item (quantity defaults to 1)
addItem("prod_004", 3);        // Add 3 items
removeItem("prod_001");        // Remove product from cart
updateQuantity("prod_002", 5); // Update quantity to 5
clearCart();                   // Clear all items from cart

// Async function with return value:
const result = await checkout("credit_card");
// result: { success: true, orderId: "order_abc123", message: "Order placed successfully" }
```

## Context Implementor (Order with Line Items)

The parent order context delegates each line item to a `lineItemContext` implementor. The parent exposes `setCurrentOrderItem`; the implementor wraps it into a scoped `setAsCurrentOrderItem`.

**Order Context Provider (parent):**

```json
{
  "type": "wixStores.orderContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/order-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useOrderContext",
      "moduleSpecifier": "my-order-context"
    }
  },
  "context": {
    "items": {
      "orderId": { "dataType": "text", "displayName": "Order ID" },
      "setCurrentOrderItem": {
        "dataType": "function",
        "displayName": "Set the Current Order Item",
        "function": {
          "arguments": [
            { "dataType": "text", "displayName": "Item ID" }
          ],
          "async": false
        }
      },
      "lineItems": {
        "dataType": "arrayItems",
        "displayName": "Line Items",
        "arrayItems": {
          "item": {
            "dataType": "data",
            "data": {
              "items": {
                "id": { "dataType": "text", "displayName": "Item ID" },
                "productName": { "dataType": "text", "displayName": "Product Name" },
                "quantity": { "dataType": "number", "displayName": "Quantity" },
                "price": { "dataType": "text", "displayName": "Price" }
              },
              "contextImplementor": {
                "componentType": "wixStores.lineItemContext",
                "propKey": "lineItemData"
              }
            }
          }
        }
      },
      "totalPrice": { "dataType": "text", "displayName": "Total Price" }
    }
  },
  "data": {
    "currency": {
      "dataType": "textEnum",
      "displayName": "Currency",
      "textEnum": {
        "options": [
          { "value": "USD", "displayName": "US Dollar" },
          { "value": "EUR", "displayName": "Euro" }
        ]
      }
    }
  }
}
```

**Line Item Context Provider (implementor):**

```json
{
  "type": "wixStores.lineItemContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/line-item-context-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useLineItemContext",
      "moduleSpecifier": "my-line-item-context"
    }
  },
  "context": {
    "items": {
      "id": { "dataType": "text", "displayName": "The product ID" },
      "productName": {
        "dataType": "data",
        "displayName": "Product Name",
        "data": {
          "items": {
            "original": { "dataType": "text", "displayName": "Original Name" },
            "translated": { "dataType": "text", "displayName": "Translated Name" }
          }
        }
      },
      "quantity": { "dataType": "number", "displayName": "Quantity" },
      "price": { "dataType": "text", "displayName": "Price" },
      "fullPrice": { "dataType": "text", "displayName": "Full Price" },
      "totalPrice": { "dataType": "text", "displayName": "Total Price" },
      "image": { "dataType": "image", "displayName": "Product Image" },
      "url": { "dataType": "webUrl", "displayName": "Product URL" },
      "setAsCurrentOrderItem": {
        "dataType": "function",
        "displayName": "Set This Item as Current Order Item",
        "function": {
          "arguments": [],
          "async": false
        }
      }
    }
  },
  "data": {}
}
```

**How it works:** The `contextImplementor` on each array item is instantiated with `wixStores.lineItemContext` and passes the item data via `lineItemData`. Since the implementor lives inside the parent's tree, it can access `useOrderContext().setCurrentOrderItem` and wrap it into a scoped, zero-argument `setAsCurrentOrderItem`.

## Editor Bundle

A context provider that includes an editor bundle for mock data in the editor:

```json
{
  "type": "wixElements.productCatalogContext",
  "resources": {
    "client": {
      "url": "https://cdn.example.com/product-catalog-context-bundle.js"
    },
    "editor": {
      "url": "https://cdn.example.com/product-catalog-context-editor-bundle.js"
    },
    "contextSpecifier": {
      "hook": "useProductCatalogContext"
    }
  },
  "context": {
    "items": {
      "products": {
        "dataType": "arrayItems",
        "displayName": "Products",
        "arrayItems": {
          "item": {
            "dataType": "data",
            "data": {
              "items": {
                "productId": { "dataType": "text", "displayName": "Product ID" },
                "name": { "dataType": "text", "displayName": "Product Name" },
                "price": { "dataType": "number", "displayName": "Price" },
                "inStock": { "dataType": "booleanValue", "displayName": "In Stock" }
              }
            }
          }
        }
      },
      "totalProducts": { "dataType": "number", "displayName": "Total Products Count" }
    }
  },
  "data": {
    "catalogId": { "dataType": "text", "displayName": "Catalog ID" }
  }
}
```

```javascript
const { products, totalProducts } = useProductCatalogContext();
// products: [
//   { productId: "cat_001", name: "Wireless Mouse", price: 29.99, inStock: true },
//   { productId: "cat_002", name: "Mechanical Keyboard", price: 149.99, inStock: true }
// ]
// totalProducts: 2
```
