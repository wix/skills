
# Wix Service Plugin (SPI) Builder

Service plugins are a set of APIs defined by Wix that let you inject custom logic into the existing backend flows of Wix business solutions or introduce entirely new flows. When you implement a service plugin, Wix calls your custom functions during specific flows. Common use cases include eCommerce customization (shipping, fees, payment settings, validations) and Bookings customization (staff sorting).

## Scaffold

Use `wix generate --params` with `extensionType: SERVICE_PLUGIN`. `pluginType` is one of:

| Value | SPI |
| --- | --- |
| `ECOM_ADDITIONAL_FEES` | Additional Fees |
| `ECOM_SHIPPING_RATES` | Shipping Rates |
| `ECOM_DISCOUNTS_TRIGGER` | Discount Triggers |
| `ECOM_VALIDATIONS` | Validations |
| `ECOM_PAYMENT_SETTINGS` | Payment Settings |
| `GIFT_CARDS_PROVIDER` | Gift Cards Provider |
| `STAFF_SORTING_PROVIDER` | Bookings Staff Sorting |
| `REALTIME_PERMISSIONS_PROVIDER` | Realtime Permissions Provider |

The CLI generates the folder, `plugin.ts`, the builder file, the UUID, and the `src/extensions.ts` registration with the appropriate builder method for the SPI type.

## Workflow

1. **Scaffold** with `wix generate --params` (above)
2. **Read the SPI reference** for the chosen `pluginType` (see [References](#references)) and **STOP and call `ReadFullDocsMethodSchema`** with the docs URL from that reference to get the exact request/response types — **DO NOT edit code until you have the schema**
3. **Implement** the handler in the generated `plugin.ts` per the SPI reference
4. **Validate** (`npx tsc --noEmit`, `npx wix build`)
5. **Test** by triggering the relevant site action (e.g., add to cart for fees)

## References

**You MUST read the relevant reference document before implementing a relevant SPI.** Each reference contains the correct imports, handler signatures, response structures, and working examples.

| SPI Type | Reference |
| --- | --- |
| Additional Fees | [ADDITIONAL-FEES.md](service-plugin/ADDITIONAL-FEES.md) |
| Discount Triggers | [DISCOUNT-TRIGGERS.md](service-plugin/DISCOUNT-TRIGGERS.md) |
| Gift Cards | [GIFT-CARDS.md](service-plugin/GIFT-CARDS.md) |
| Payment Settings | [PAYMENT-SETTINGS.md](service-plugin/PAYMENT-SETTINGS.md) |
| Shipping Rates | [SHIPPING-RATES.md](service-plugin/SHIPPING-RATES.md) |
| Validations | [VALIDATIONS.md](service-plugin/VALIDATIONS.md) |
| Bookings Staff Sorting | [BOOKINGS-STAFF-SORTING.md](service-plugin/BOOKINGS-STAFF-SORTING.md) |

## Implementation Pattern

The handler file (`plugin.ts`) contains the service plugin logic. It must:

1. Import the relevant service plugin from the appropriate package (e.g., `@wix/ecom/service-plugins` for eCommerce, `@wix/bookings/service-plugins` for Bookings)
2. Call `provideHandlers()` with an object containing handler functions
3. Each handler function receives a payload with `request` and `metadata`
4. Return the expected response structure for that SPI type

```typescript
import { shippingRates } from "@wix/ecom/service-plugins";

shippingRates.provideHandlers({
  getShippingRates: async (payload) => {
    const { request, metadata } = payload;

    // Implement custom logic based on request data
    // - request contains cart items, shipping address, etc.
    // - metadata contains currency, locale, etc.

    return {
      shippingRates: [
        {
          code: "custom-shipping",
          title: "Custom Shipping",
          logistics: {
            deliveryTime: "3-5 business days",
          },
          cost: {
            price: "9.99",
            currency: metadata.currency || "USD",
          },
        },
      ],
    };
  },
});
```

Handler functions are called automatically by Wix when the relevant site action triggers them. Your custom logic should be placed inside each handler function.

## Implementation Requirements

- **Implement ALL required handler functions** with complete business logic
- **Include proper TypeScript types and error handling**
- **Focus on implementing the EXACT business logic** described in the user prompt
- **If capabilities are undocumented/unavailable**, explicitly state the gap and proceed only with documented minimal logic
- **Never use placeholders** - always implement complete, working functionality

## Data Validation

All service plugins must include comprehensive data validation:

- **Validate all input data** from Wix requests
- **Ensure required fields** are present and properly formatted
- **Handle missing or malformed data** gracefully
- **Validate business logic constraints** (e.g., minimum order amounts, valid addresses)

## Elevating Permissions for API Calls

When making Wix API calls from service plugins, you must elevate permissions using `auth.elevate` from `@wix/essentials`.

```typescript
import { auth } from "@wix/essentials";
import { items } from "@wix/data";

export const myFunction = async () => {
  const elevatedFunction = auth.elevate(items.query);
  const elevatedResponse = await elevatedFunction("myCollection");
  return elevatedResponse;
};
```

```typescript
import { auth } from "@wix/essentials";
import { cart } from "@wix/ecom";

export const myFunction = async () => {
  const elevatedFunction = auth.elevate(cart.getCart);
  const elevatedResponse = await elevatedFunction("cart-id");
  return elevatedResponse;
};
```

```typescript
import { auth } from "@wix/essentials";
import { products } from "@wix/stores";

export const myFunction = async () => {
  const elevatedFunction = auth.elevate(products.deleteCollection);
  const elevatedResponse = await elevatedFunction("collection-id");
  return elevatedResponse;
};
```

## Builder field overrides

The CLI generates a builder with `id`, `name`, and `source`. Some SPI types accept additional optional fields you may want to set in the generated builder file:

| SPI Type | Builder Method | Additional Optional Fields |
| --- | --- | --- |
| Shipping Rates | `ecomShippingRates()` | `description`, `learnMoreUrl`, `dashboardUrl`, `fallbackDefinitionMandatory`, `thumbnailUrl` |
| Validations | `ecomValidations()` | `validateInCart` |
| Payment Settings | `ecomPaymentSettings()` | `fallbackValueForRequires3dSecure` |
| Bookings Staff Sorting | `bookingsStaffSortingProvider()` | `methodName` (required), `methodDescription` (required, max 100 chars), `dashboardPluginId` |

Only `ecomShippingRates()` accepts `description`. Passing unsupported fields to other builders causes TypeScript errors. `bookingsStaffSortingProvider()` requires `methodName` and `methodDescription` fields — set these in the generated builder file after scaffolding.

## Best Practices

- **Always implement complete, working functionality** - never use placeholders
- **Validate all input:** Check required fields are present and properly formatted
- **Handle errors gracefully:** Return appropriate error responses, don't throw unhandled exceptions
- **Return exact format:** Responses must match Wix documented structure exactly
- **Use TypeScript types:** Leverage SDK types for better type safety
- **Test edge cases:** Empty carts, missing addresses, invalid data
- **Performance:** Keep calculations efficient - these run on every checkout
- **Logging:** Add console.log for debugging but keep production logs minimal

## Testing Service Plugins

To test your service plugin extension:

1. **Release a version** with your changes - new service plugins or changes to existing ones won't take effect until you've built and released your project
2. **Trigger the call** to your service plugin by performing the relevant action (e.g., add items to cart and view cart to test Additional Fees)
