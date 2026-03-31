# Site Plugin Slots Reference

This reference provides additional details about slots beyond what's covered in the main SKILL.md.

## Supported Pages and Slots

| Wix App        | Supported Pages/Widgets                                      |
| -------------- | ------------------------------------------------------------ |
| Wix Stores     | Product Page (new and old versions), Category Page, Shop Page, Gallery Widget |
| Wix eCommerce  | Checkout Page, Side Cart                                     |
| Wix Bookings   | Service Page                                                 |
| Wix Events     | Event Details Page                                           |
| Wix Blog       | Post Page                                                    |

## Common Wix App IDs

| Wix App                | App Definition ID                      |
| ---------------------- | -------------------------------------- |
| Wix Stores (Old)       | `1380b703-ce81-ff05-f115-39571d94dfcd` |
| Wix Stores (New)       | `a0c68605-c2e7-4c8d-9ea1-767f9770e087` |
| Wix Bookings           | `13d21c63-b5ec-5912-8397-c3a5ddb27a97` |
| Wix Events             | `140603ad-af8d-84a5-2c80-a0f60cb47351` |
| Wix Blog               | `14bcded7-0066-7c35-14d7-466cb3f09103` |
| Wix Restaurants        | `13e8d036-5516-6104-b456-c8466db39542` |

---

## Wix Stores Slots

### Product Page (New Version)

| Property          | Value                                    |
| ----------------- | ---------------------------------------- |
| `appDefinitionId` | `a0c68605-c2e7-4c8d-9ea1-767f9770e087`   |
| `widgetId`        | `6a25b678-53ec-4b37-a190-65fcd1ca1a63`   |

**Available Slot IDs:**
- `product-page-media-1`
- `product-page-details-2`

**Plugin API Properties:**
- `productId` (string) - The product ID
- `selectedVariantId` (string) - Selected product variant ID
- `selectedChoices` (object) - Customer's option selections
- `quantity` (number) - Item quantity
- `customText` (string[]) - Custom text field entries

### Product Page (Old Version)

| Property          | Value                                    |
| ----------------- | ---------------------------------------- |
| `appDefinitionId` | `1380b703-ce81-ff05-f115-39571d94dfcd`   |
| `widgetId`        | `13a94f09-2766-3c40-4a32-8edb5acdd8bc`   |

**Available Slot IDs:**
- `product-page-details-2`
- Additional slots vary by layout (Classic, Simple, Sleek, Spotlight, Stunning)

**Note:** Check which Wix Stores version is installed before building plugins, as slots differ between versions. Your app should include placements for both versions for maximum compatibility.

### Shop Page

| Property          | Value                                    |
| ----------------- | ---------------------------------------- |
| `appDefinitionId` | `1380b703-ce81-ff05-f115-39571d94dfcd`   |
| `widgetId`        | `1380bba0-253e-a800-a235-88821cf3f8a4`   |

**Plugin API Properties:**
- `categoryId` (string) - The category ID

### Gallery Widget

| Property          | Value                                    |
| ----------------- | ---------------------------------------- |
| `appDefinitionId` | `1380b703-ce81-ff05-f115-39571d94dfcd`   |
| `widgetId`        | `13afb094-84f9-739f-44fd-78d036adb028`   |

**Plugin API Properties:**
- `categoryId` (string) - The category ID

**Note:** When selecting slots, use the same slot across Shop page, Gallery widget, and Category page to ensure compatibility across different Wix site setups.

---

## Wix eCommerce Slots

### Checkout Page

| Property          | Value                                    |
| ----------------- | ---------------------------------------- |
| `appDefinitionId` | `1380b703-ce81-ff05-f115-39571d94dfcd`   |
| `widgetId`        | `14fd5970-8072-c276-1246-058b79e70c1a`   |

**Available Slot IDs:**
- `checkout:header`
- `checkout:top`
- `checkout:steps:before`
- `checkout:summary:before`
- `checkout:summary:lineItems:after`
- `checkout:summary:lineItems:after2`
- `checkout:summary:totalsBreakdown:before`
- `checkout:summary:after`

**Plugin API Properties:**
- `checkoutId` (string) - ID of the current checkout process
- `stepId` (string) - Current step: `contact-details`, `delivery-method`, `payment-and-billing`, or `place-order`
- `checkoutUpdatedDate` (string) - When checkout was last updated
- `onRefreshCheckout()` - Callback function to refresh checkout when needed

---

## Wix Blog Slots

### Post Page

| Property          | Value                                    |
| ----------------- | ---------------------------------------- |
| `appDefinitionId` | `14bcded7-0066-7c35-14d7-466cb3f09103`   |
| `widgetId`        | `211b5287-14e2-4690-bb71-525908938c81`   |

**Available Slot IDs:**
- `above-header`
- `above-content-1`
- `above-content-2`
- `below-content-1`
- `below-content-2`
- `page-bottom-1`
- `page-bottom-2`
- `page-bottom-3`

**Plugin API Properties:**
- `postId` (string) - The ID of the current post

---

## Wix Bookings Slots

### Service Page

| Property          | Value                                    |
| ----------------- | ---------------------------------------- |
| `appDefinitionId` | `13d21c63-b5ec-5912-8397-c3a5ddb27a97`   |

**Plugin API Properties:**
- `bookingsServiceId` (string) - The ID of the service

Use `wix-bookings-frontend` APIs like `getServiceAvailability()` to query service information.

---

## Wix Events Slots

### Event Details Page

| Property          | Value                                    |
| ----------------- | ---------------------------------------- |
| `appDefinitionId` | `140603ad-af8d-84a5-2c80-a0f60cb47351`   |

**Plugin API Properties:**
- `eventId` (string) - The ID of the event

**Note:** Event Details Page slots are currently in beta and available only to a closed group of developers.

---

## Multiple Placements

You can configure a single plugin to appear in multiple slots:

```typescript
placements: [
  {
    appDefinitionId: '1380b703-ce81-ff05-f115-39571d94dfcd',
    widgetId: '13a94f09-2766-3c40-4a32-8edb5acdd8bc',
    slotId: 'product-page-details-2',
  },
  {
    appDefinitionId: 'a0c68605-c2e7-4c8d-9ea1-767f9770e087',
    widgetId: '6a25b678-53ec-4b37-a190-65fcd1ca1a63',
    slotId: 'product-page-details-2',
  },
]
```

**Note:** If you have multiple placements for slots on a single page, the plugin will be added to the first slot in the array by default. Users can manually move the plugin to their desired location in the editor.

## Finding Slot IDs

To find available slots for a specific Wix app:

1. Use the Wix CLI `generate` command and select "Site Plugin"
2. The CLI will prompt you to select a Wix app and display available slots
3. Use the arrow keys to navigate and select the desired slot

The CLI automatically populates the `placements` array with the correct IDs.

## Slot Limitations

- Each slot has specific size constraints defined by the host app
- Some slots may only be available in certain editor types (Wix Editor, Editor X, Wix Studio)
- Multiple plugins can occupy the same slot, displayed next to each other and ordered by creation date
