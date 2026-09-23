# Shipping Rates Service Plugin Reference

## Overview

The Shipping Rates SPI lets you provide custom shipping options and calculate shipping costs based on order details, destination, weight, or any custom logic. Implement the `getShippingRates` handler — it returns the available shipping options with their costs.

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` on the docs URL to get the full request/response types.

| Handler | Docs URL |
| --- | --- |
| `getShippingRates` | https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/shipping-rates/shipping-rates-integration-service-plugin/get-shipping-rates?apiView=SDK |

## Example: International Shipping with Handling Fee

This example provides an international shipping option with an additional handling fee charge.

```typescript
import { shippingRates } from "@wix/ecom/service-plugins";
import { ChargeType } from "@wix/auto_sdk_ecom_shipping-rates";

shippingRates.provideHandlers({
  getShippingRates: async (payload) => {
    const { request, metadata } = payload;
    // Use the `request` and `metadata` received from Wix and
    // apply custom logic.
    return {
      // Return your response exactly as documented to integrate with Wix.
      // Return value example:
      shippingRates: [
        {
          code: "usps-international",
          title: "USPS - International",
          logistics: {
            deliveryTime: "2-5 days",
          },
          cost: {
            price: "15",
            currency: metadata.currency || "ILS",
            additionalCharges: [
              {
                price: "10",
                type: ChargeType.HANDLING_FEE,
                details: "Handling fee of $5 applied for fragile items.",
              },
            ],
          },
        },
      ],
    };
  },
});
```

## ⚠️ Manual setup required — installing the app isn't enough

Like Additional Fees and Payment Settings, this plugin only supplies rates when Wix actually asks it to. Unlike those two, **it isn't asked automatically** — the merchant must explicitly turn your app on as a delivery carrier for a shipping region before Wix calls `getShippingRates` for it. Tell the merchant to do this in the dashboard (confirmed live, click-by-click):

1. Go to **Settings** (left sidebar) → under **Business solutions**, click **Shipping, delivery & fulfillment**.
2. Find the region to enable the carrier for (e.g. **Domestic** or **International**) and click **Manage Your Apps** in that region's header.
3. In the **"Manage your installed apps"** dialog, check the box next to your app's name.
4. A **backup rate** section appears (checked by default) with a **Shipping name** and **Rate at checkout** field — this is what Wix falls back to if your plugin errors or times out. Fill these in (or leave the defaults) — Wix requires a backup rate here, same as the API's `backupRate`.
5. Optionally check **Add a handling fee to every order**.
6. Click **Save**.

Confirmed live: enabling the carrier this way registers it with no errors. Whichever specific rate a given customer sees selected by default (this carrier's vs. another installed one's) is resolved at checkout-page render time, not by the Cart `calculate`/`refresh` endpoints — verify the actual customer-facing rate on the live checkout page, not from a raw API response alone.

(The same thing can be done via the [Add Delivery Carrier](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/shipping-delivery/delivery-profiles/add-delivery-carrier) API if you're scripting site setup yourself, but for a merchant using your app, send them to the dashboard steps above — not a raw API call.)

## Singular Constraint

`ECOM_SHIPPING_RATES` is **singular** — only one component of this type is allowed per app. Do not scaffold or include two Shipping Rates service plugins in the same app.

## Key Implementation Notes

1. **Price as string** - All price values must be strings, not numbers
2. **Currency from metadata** - Use `metadata.currency` to get the site's currency
3. **Multiple options** - You can return multiple shipping rate options for customer to choose
4. **Unique codes** - Each shipping option needs a unique `code` identifier
5. **Additional charges** - Use `additionalCharges` array for itemized extra costs like handling fees
