# Extension Metadata: `name` and `aiContext`

`wix generate` scaffolds builder files without the metadata Wix uses for logs and for its AI. Finish each scaffolded `*.extension.ts` by adding it:

- **`name`** on a backend event or service plugin — a short title-case label of what the extension does, trigger first, then action: `"New Member Created"`, `"Order Paid Send Receipt"`, `"Weekend Delivery Fee"`. In a `@wix/custom-extensions` project the build slugifies it into the URL site monitoring logs show: `/_wix/extensions/webhooks/new-member-created/<id>` for an event, `/_wix/extensions/service-plugins/weekend-delivery-fee/<id>` for a service plugin; an event with no `name` logs as `/_wix/extensions/webhooks/webhook/<id>`. A service plugin's scaffolded `name` is its folder path, so replace it.
- **`aiContext: { description }`** — one or two plain sentences on what the extension does for the site owner and when it runs. Wix's AI reads it to understand the extension.

## Read the scaffolded import first

The builder package decides which fields exist:

- `import { extensions } from '@wix/custom-extensions'` — follow the table below.
- `import { extensions } from '@wix/astro/builders'` — its builders declare no `aiContext` and no `name` on an event, and its URLs carry no name. Replace the service plugin's folder-path `name` with the title-case label and add nothing else.

## Where each field goes (`@wix/custom-extensions` 1.0.6)

| `extensionType` | Builder | `name` | `aiContext` |
| --- | --- | --- | --- |
| `EVENT` | `extensions.event()` | add it (optional in the type) | top level |
| `SERVICE_PLUGIN` — eCom (`ecomAdditionalFees`, `ecomShippingRates`, `ecomDiscountTriggers`, `ecomValidations`, `ecomPaymentSettings`, `ecomGiftCards`) and `bookingsStaffSortingProvider` | per SPI | replace the folder path | top level |
| `SERVICE_PLUGIN` — the other Bookings providers, `realtimePermissionsProvider`, `toolsProvider` | per SPI | replace the folder path | not accepted |
| `DATA_COLLECTION` | `extensions.dataCollections()` | keep the scaffolded value | top level |
| `DASHBOARD_PAGE` | `extensions.dashboardPage()` | — | `metaData.aiContext`, beside the scaffolded `searchable` and `description` |
| `DASHBOARD_MODAL` | `extensions.dashboardModal()` | — | `metaData: { aiContext }` |
| `DASHBOARD_PLUGIN` | `extensions.dashboardPlugin()` | — | top level |
| `DASHBOARD_MENU_PLUGIN` | `extensions.dashboardMenuPlugin()` | — | top level |

Versions 1.0.5 and earlier take neither `name` on an event nor any `aiContext`. The installed builder's options type is the authority: add a field only where it declares one.

## Example

Scaffolded values (`…`) stay as the CLI wrote them.

```typescript
import { extensions } from '@wix/custom-extensions';

export default extensions.event({
  id: '…',
  name: 'Order Paid Send Receipt',
  aiContext: {
    description: 'Emails the buyer a branded receipt as soon as an order is paid.',
  },
  source: '…',
});
```

```typescript
export default extensions.dashboardPage({
  id: '…',
  title: 'Delivery Fees',
  routePath: 'delivery-fees',
  component: '…',
  fullPage: false,
  metaData: {
    searchable: true,
    description: 'Manage Delivery Fees in your dashboard.',
    aiContext: {
      description: 'Lets the site owner set the weekend delivery fee amount and the days it applies.',
    },
  },
});
```

## Done when

`npx tsc --noEmit` passes and every extension this run scaffolded carries each field its builder declares. A `tsc` error like `Object literal may only specify known properties, and 'aiContext' does not exist` means that builder version lacks the field: remove it from that file and keep the rest.
