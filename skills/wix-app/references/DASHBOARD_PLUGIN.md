
# Wix Dashboard Plugin Builder

Dashboard plugins are interactive widgets that embed into predefined **slots** on dashboard pages managed by Wix first-party business apps (Wix Stores, Wix Bookings, Wix Blog, Wix eCommerce, etc.). They occupy the full width of their slot and maintain dynamic height based on content.

## Scaffold

Use `wix generate --params` with `extensionType: DASHBOARD_PLUGIN`. `extendsSlotId` is the back-office extension container component ID from the host Wix app — see [Slots Reference](dashboard-plugin/SLOTS.md). The CLI generates the folder, the React component, the builder file, the UUID, and the `src/extensions.ts` registration.

## Architecture

Dashboard plugins operate through two mechanisms:

1. **Visual Integration** — Embedding plugin UI inside a supported dashboard page slot
2. **Logical Integration** — Implementing communication between the plugin and the host page's data via `observeState()`

## The `extendsSlotId` field

Specifies which dashboard page slot hosts your plugin. Each Wix business app exposes slots on its dashboard pages. You must provide the exact slot ID.

**Important:** Some slots with the same ID appear on different pages within the dashboard. If you create a plugin for a slot that exists on multiple pages, the plugin is displayed on all of those pages.

For the complete list of available slot IDs, see [Slots Reference](dashboard-plugin/SLOTS.md).

## Available Resources in Plugin Components

- **React** — Component logic and state management
- **Wix SDK** — Access Wix business solutions and site data
- **Wix Dashboard SDK** (`@wix/dashboard`) — Interact with the dashboard page's data passed to the slot
- **Wix Design System** (`@wix/design-system`) — Native-looking React components matching Wix's own dashboard UI

## Theme

A plugin is its own iframe, so **it inherits nothing from the host page it sits in** — not even though that page is a redesigned first-party Wix app. This makes a plugin the least forgiving dashboard surface: an unthemed one renders classic icons and pre-redesign buttons directly beside the redesigned Stores/Bookings/Blog UI framing it.

Wrap the plugin component in the app's `BusinessManagerTheme` (the example below does), import icons from `@wix/wix-ui-icons-common/lazy`, and style with `--wds-*` tokens or `skin`/`size` props — never a hardcoded colour or an inline `style` override ([BUSINESS_MANAGER_TOKENS.md](BUSINESS_MANAGER_TOKENS.md)). The wrapper file itself is written once per app: [BUSINESS_MANAGER_THEME.md § 2](BUSINESS_MANAGER_THEME.md#2-the-wrapper--write-this-file-once-per-app).

Two things to get right in a slot specifically:

- **Match the host's density, don't fight it.** The wrapper's defaults (`Button` small/dark, `IconButton` small/dark/tertiary) are what the surrounding page uses. Overriding them per call site is how a plugin starts looking like a different product.
- **A nested icon button inside your own card or list row is Dark / Tertiary.** The wrapper's `IconButton` default already gives you this — don't re-specify `skin="standard"` on it.

A plugin has no page of its own, so looking at it means navigating to the host app's page that carries the slot — the Blog posts or Bookings staff screen itself.

## Interacting with Dashboard Data

Use `observeState()` from the Dashboard SDK to receive data from the host dashboard page:

```tsx
import { dashboard } from "@wix/dashboard";
import { useEffect, useState, type FC } from "react";
import { Card, Text } from "@wix/design-system";
import { BusinessManagerTheme } from "../../BusinessManagerTheme";

const Plugin: FC = () => {
  const [params, setParams] = useState<Record<string, unknown>>({});

  useEffect(() => {
    dashboard.observeState((componentParams) => {
      setParams(componentParams);
    });
  }, []);

  return (
    <BusinessManagerTheme>
      <Card>
        <Card.Content size="medium">
          <Text>Received data: {JSON.stringify(params)}</Text>
        </Card.Content>
      </Card>
    </BusinessManagerTheme>
  );
};
```

### Typed Props from Host Apps

Some Wix apps expose typed interfaces for their slot parameters. Import them from the app's dashboard package:

```typescript
import type { plugins } from "@wix/blog/dashboard";

type Props = plugins.BlogPosts.PostsBannerParams;

const Plugin: FC<Props> = (props) => {
  // props are typed according to the Blog Posts slot contract
};
```

> **Note:** Typed props availability varies by Wix app. Consult the specific app's SDK documentation. Not all slots provide typed parameter interfaces.

## Sizing Behavior

- Dashboard plugins take the **full width** of their slot
- **Height** adjusts dynamically based on content within slot boundaries
- When using Dashboard SDK or dashboard-react SDK, dimensions change dynamically based on contents


## Examples

### Blog Posts Banner Plugin

**Request:** "Create a plugin for the Wix Blog posts page that shows a promotional banner"

**Output:** Plugin targeting slot `46035d51-2ea9-4128-a216-1dba68664ffe` (Blog Posts page) with a Card component displaying promotional content, using `observeState()` to access blog post data.

### Bookings Staff Calendar Widget

**Request:** "Add a plugin to the Wix Bookings staff page that shows weekly availability"

**Output:** Plugin targeting slot `261e84a2-31d0-4258-a035-10544d251108` (Bookings Staff page) with a schedule display component, using `observeState()` to receive staff data.

### Order Details Plugin

**Request:** "Create a plugin on the eCommerce order page showing fulfillment status"

**Output:** Plugin targeting slot `cb16162e-42aa-41bd-a644-dc570328c6cc` (eCommerce Order page) with status badges and fulfillment details, using `observeState()` to access order data.

