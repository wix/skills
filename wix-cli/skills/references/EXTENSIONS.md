# Wix Extension Registration Reference

Every Wix CLI extension must be registered with the framework using `extensions.ts` files. This reference covers all extension types and their registration patterns.

## UUID Generation (CRITICAL)

**Every extension requires a unique, static UUID for its `id` field.**

### Rules

1. **Generate a NEW UUID** for every extension you create - never reuse UUIDs across extensions
2. **UUID must be a static string literal** - NOT a function call like `randomUUID()`
3. **UUID format:** `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` (standard UUID v4)
4. **Never copy UUIDs** from examples or other extensions

### How to Generate

Create a unique UUID by generating a random 32-character hex string and formatting as: 8-4-4-4-12 characters separated by hyphens.

**In code examples below, `{{GENERATE_UUID}}` is a placeholder.** When implementing, replace it with a freshly generated UUID string like `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`.

## Overview

Extensions are registered using builders from `@wix/astro/builders`:

```typescript
import { extensions } from "@wix/astro/builders";

export const myExtension = extensions.extensionType({
  // config specific to extension type
});
```

All extension exports are collected in `src/index.ts` and registered with the app in `src/extensions.ts`.

## Extension Types

### Dashboard Page

```typescript
import { extensions } from "@wix/astro/builders";

export const dashboardpageMyPage = extensions.dashboardPage({
  id: "{{GENERATE_UUID}}",
  title: "My Page Title",
  routePath: "my-page",
  component: "./dashboard/pages/my-page/page.tsx",
});
```

| Property    | Type   | Description                                                                                          |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `id`        | string | Unique identifier (generate a fresh UUID v4 - see UUID Generation section above)                     |
| `title`     | string | Display title in the dashboard sidebar                                                               |
| `routePath` | string | URL path segment. Lowercase letters, numbers, dashes, and slashes only. Must NOT start with a slash. |
| `component` | string | Relative path to the page component (.tsx)                                                           |

### Embedded Script

```typescript
import { extensions } from "@wix/astro/builders";

export const embeddedscriptMyScript = extensions.embeddedScript({
  id: "{{GENERATE_UUID}}",
  name: "My Script Name",
  source: "./site/embedded-scripts/my-script/embedded.html",
  placement: "BODY_END",
  scriptType: "FUNCTIONAL",
});
```

| Property     | Type   | Description                                           |
| ------------ | ------ | ----------------------------------------------------- |
| `id`         | string | Unique identifier (generate a fresh UUID v4)          |
| `name`       | string | Display name for the script                           |
| `source`     | string | Relative path to the HTML file                        |
| `placement`  | enum   | `HEAD`, `BODY_START`, or `BODY_END`                   |
| `scriptType` | enum   | `ESSENTIAL`, `FUNCTIONAL`, `ANALYTICS`, `ADVERTISING` |

### Custom Element (Site Widget)

```typescript
import { extensions } from "@wix/astro/builders";

export const sitewidgetMyWidget = extensions.customElement({
  id: "{{GENERATE_UUID}}",
  name: "My Widget",
  tagName: "my-widget",
  element: "./site/widgets/custom-elements/my-widget/widget.tsx",
  settings: "./site/widgets/custom-elements/my-widget/panel.tsx",
  installation: {
    autoAdd: true,
  },
  width: {
    defaultWidth: 500,
    allowStretch: true,
  },
  height: {
    defaultHeight: 500,
  },
});
```

| Property       | Type   | Description                                  |
| -------------- | ------ | -------------------------------------------- |
| `id`           | string | Unique identifier (generate a fresh UUID v4) |
| `name`         | string | Display name in editor                       |
| `tagName`      | string | HTML custom element tag (kebab-case)         |
| `element`      | string | Path to widget React component               |
| `settings`     | string | Path to settings panel component             |
| `installation` | object | Auto-add behavior                            |
| `width`        | object | Default width and stretch settings           |
| `height`       | object | Default height settings                      |

### Site Component

```typescript
import { extensions } from "@wix/astro/builders";
import manifest from "./site/components/my-component/manifest.json";

export const sitecomponentMyComponent = extensions.siteComponent({
  ...manifest,
  id: "{{GENERATE_UUID}}",
  description: "My Component",
  type: "platform.builder.{{GENERATE_UUID}}",
  resources: {
    client: {
      component: "./site/components/my-component/component.tsx",
      componentUrl: "./site/components/my-component/component.tsx",
    },
  },
});
```

**Note:** The `id` and `type` should use the same UUID. The manifest is imported and spread to include `editorElement` and other manifest properties.

### Backend Event

```typescript
import { extensions } from "@wix/astro/builders";

export const backendeventMyEvent = extensions.event({
  id: "{{GENERATE_UUID}}",
  source: "./backend/events/my-event/event.ts",
});
```

| Property | Type   | Description                                  |
| -------- | ------ | -------------------------------------------- |
| `id`     | string | Unique identifier (generate a fresh UUID v4) |
| `source` | string | Relative path to the event handler           |

### Service Plugins (eCommerce SPIs)

Service plugins use specific builder methods based on the SPI type:

```typescript
import { extensions } from "@wix/astro/builders";

// Shipping Rates
export const ecomshippingratesMyShipping = extensions.ecomShippingRates({
  id: "{{GENERATE_UUID}}",
  name: "My Shipping Rates",
  source: "./backend/service-plugins/ecom-shipping-rates/my-shipping/plugin.ts",
});

// Additional Fees
export const ecomadditionalfeesMyFees = extensions.ecomAdditionalFees({
  id: "{{GENERATE_UUID}}",
  name: "My Additional Fees",
  source: "./backend/service-plugins/ecom-additional-fees/my-fees/plugin.ts",
});

// Validations
export const ecomvalidationsMyValidation = extensions.ecomValidations({
  id: "{{GENERATE_UUID}}",
  name: "My Validations",
  source: "./backend/service-plugins/ecom-validations/my-validation/plugin.ts",
});
```

**Available builder methods:**

| SPI Type          | Builder Method           |
| ----------------- | ------------------------ |
| Shipping Rates    | `ecomShippingRates()`    |
| Additional Fees   | `ecomAdditionalFees()`   |
| Validations       | `ecomValidations()`      |
| Discount Triggers | `ecomDiscountTriggers()` |
| Gift Cards        | `ecomGiftCards()`        |
| Payment Settings  | `ecomPaymentSettings()`  |

### Site Plugin

Site plugins integrate into predefined slots within Wix business solutions:

```typescript
import { extensions } from '@wix/astro/builders';

export default extensions.sitePlugin({
  id: '{{GENERATE_UUID}}',
  name: 'My Site Plugin',
  marketData: {
    name: 'My Site Plugin',
    description: 'Marketing Description',
    logoUrl: '{{BASE_URL}}/my-site-plugin-logo.svg',
  },
  placements: [{
    appDefinitionId: 'a0c68605-c2e7-4c8d-9ea1-767f9770e087',
    widgetId: '6a25b678-53ec-4b37-a190-65fcd1ca1a63',
    slotId: 'product-page-details-6',
  }],
  installation: { autoAdd: true },
  tagName: 'my-site-plugin',
  element: './extensions/site/plugins/my-site-plugin/my-site-plugin.tsx',
  settings: './extensions/site/plugins/my-site-plugin/my-site-plugin.panel.tsx',
});
```

| Property                     | Type    | Description                                              |
| ---------------------------- | ------- | -------------------------------------------------------- |
| `id`                         | string  | Unique identifier (generate a fresh UUID v4)             |
| `name`                       | string  | Internal name for the plugin                             |
| `marketData.name`            | string  | Display name in plugin explorer and app dashboard        |
| `marketData.description`     | string  | Description shown in plugin explorer and app dashboard   |
| `marketData.logoUrl`         | string  | Path to logo file (`{{BASE_URL}}` resolves to public)    |
| `placements`                 | array   | Array of slot placements where plugin can be added       |
| `placements.appDefinitionId` | string  | ID of the Wix app containing the slot                    |
| `placements.widgetId`        | string  | ID of the page containing the slot                       |
| `placements.slotId`          | string  | ID of the specific slot                                  |
| `installation.autoAdd`       | boolean | Whether to auto-add plugin on app installation           |
| `tagName`                    | string  | HTML custom element tag (kebab-case, must have hyphen)   |
| `element`                    | string  | Path to plugin HTMLElement component                     |
| `settings`                   | string  | Path to settings panel component                         |

## Extension Types Without Registration

The following extension types do **not** require `extensions.ts` files:

- **Backend API** - Astro server endpoints are auto-discovered

## App Registration

**CRITICAL: Extension registration in `src/extensions.ts` is MANDATORY.**

After creating any extension file, you MUST update the main `src/extensions.ts` file to register the extension with the app. Without this step, the extension will not be recognized by Wix CLI.

### Simple Pattern (Recommended for Small Apps)

**`src/extensions.ts`** - Import and register extensions directly:

```typescript
import { app } from "@wix/astro/builders";
import { dataExtension } from "./data/extensions.ts";
import { dashboardpageMyPage } from "./dashboard/pages/my-page/extensions.ts";
import { embeddedscriptMyScript } from "./site/embedded-scripts/my-script/extensions.ts";

export default app()
  .use(dataExtension)
  .use(dashboardpageMyPage)
  .use(embeddedscriptMyScript);
```

**Steps for each new extension:**

1. Import the extension from its `extensions.ts` file
2. Add `.use(extensionName)` to the app chain
3. Chain multiple extensions together

### Advanced Pattern (For Large Apps)

**`src/index.ts`** - Re-export all extensions:

```typescript
export { dashboardpageMyPage } from "./dashboard/pages/my-page/extensions";
export { embeddedscriptMyScript } from "./site/embedded-scripts/my-script/extensions";
export { dataExtension } from "./data/extensions";
```

**`src/extensions.ts`** - Register all extensions programmatically:

```typescript
import { app } from "@wix/astro/builders";
import * as allExtensions from "./index";

const extensionList = Object.values(allExtensions);

const appBuilder = app();
extensionList.forEach((extension) => {
  appBuilder.use(extension);
});

export default appBuilder;
```

## Naming Conventions

Extension export names follow this pattern: `{extensiontype}{CamelCaseName}`

Examples:

- `dashboardpageCartPopupManager`
- `embeddedscriptCouponPopup`
- `sitewidgetCountdownWidget`
- `sitepluginProductBadge`
- `ecomshippingratesCustomShipping`

The type prefix is the extension type in lowercase with no separators.
