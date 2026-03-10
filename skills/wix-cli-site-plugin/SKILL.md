---
name: wix-cli-site-plugin
description: Use when building interactive components for predefined slots in Wix business solutions. Triggers include site plugin, slot, Wix app integration, plugin explorer, business solution extension.
compatibility: Requires Wix CLI development environment.
---

# Wix Site Plugin Builder

Creates site plugin extensions for Wix CLI applications. Site plugins are custom elements that integrate into predefined **slots** within Wix business solutions (like Wix Stores, Wix Bookings, Wix eCommerce), extending their functionality and user experience.

Site owners can place site plugins into UI slots using the plugin explorer in Wix editors.

## Quick Start Checklist

Follow these steps in order when creating a site plugin:

1. [ ] Create plugin folder: `src/extensions/site/plugins/<plugin-name>/`
2. [ ] Copy [plugin-component-template.tsx](assets/plugin-component-template.tsx) → `<plugin-name>.tsx`, then adapt it
3. [ ] Copy [settings-panel-template.tsx](assets/settings-panel-template.tsx) → `<plugin-name>.panel.tsx`, then adapt it
4. [ ] Copy [extension-template.ts](assets/extension-template.ts) → `<plugin-name>.extension.ts`, then adapt it
5. [ ] Update `src/extensions.ts` to import and use the new extension

## Architecture

Site plugins consist of **three required files**:

### 1. Plugin Component (`<plugin-name>.tsx`)

Custom element component that renders in the slot using native HTMLElement. **Start from** [plugin-component-template.tsx](assets/plugin-component-template.tsx) and adapt:

- Rename the class and update `observedAttributes` for your plugin's properties
- Build your HTML in `render()` with inline styles
- Read attribute values with `this.getAttribute('kebab-case-name')`

Key rules:
- Extend `HTMLElement` class directly
- Attributes use **kebab-case** (e.g., `display-name`, `bg-color`)
- Use inline styles only — CSS imports are not supported in custom elements
- Wix handles `define()` for you — do NOT call `customElements.define()`

### 2. Settings Panel (`<plugin-name>.panel.tsx`)

Settings panel shown in the Wix Editor sidebar. **Start from** [settings-panel-template.tsx](assets/settings-panel-template.tsx) and adapt:

- Add state variables and `useEffect` loaders for each configurable property
- Create onChange handlers that update both local state AND `widget.setProp()`
- Add WDS form fields inside `SidePanel.Content`

Key rules:
- Prop names in `widget.getProp()` and `widget.setProp()` use **kebab-case**
- Always update both local state AND widget prop in onChange handlers
- Wrap content in `WixDesignSystemProvider > SidePanel > SidePanel.Content`
- Use WDS components from `@wix/design-system` — see [wds-docs](../wds-docs/SKILL.md) for reference
- Import `@wix/design-system/styles.global.css` for styles
- Include `aria-label` for accessibility

### 3. Extension Configuration (`<plugin-name>.extension.ts`)

Defines the plugin's placement configuration. **Start from** [extension-template.ts](assets/extension-template.ts) and adapt:

- Generate a fresh UUID v4 for `id` — do NOT use `randomUUID()` or copy from examples
- Configure `placements` with the correct slot IDs from [SLOTS.md](references/SLOTS.md)
- Update `tagName`, `element`, and `settings` paths

## Color & Font Picker Fields

For settings panels that need color or font pickers, copy these reusable components into your plugin folder:

- [ColorPickerField.tsx](assets/ColorPickerField.tsx) — opens the native Wix color picker with theme colors, gradients, etc. Use this instead of `<Input type="color">`
- [FontPickerField.tsx](assets/FontPickerField.tsx) — opens the native Wix font picker with font family, size, bold, italic

Both components use `inputs` from `@wix/editor` — import them alongside your other panel dependencies.

## Attribute Naming Convention

Site plugins use **kebab-case** consistently for HTML attributes:

| File                              | Convention | Example                            |
| --------------------------------- | ---------- | ---------------------------------- |
| `<plugin>.tsx` (getAttribute)     | kebab-case | `this.getAttribute('display-name')` |
| `<plugin>.tsx` (observedAttributes) | kebab-case | `['display-name', 'bg-color']`     |
| `<plugin>.panel.tsx` (widget API) | kebab-case | `widget.getProp('display-name')`   |

## Output Structure

Site plugins live under `src/extensions/site/plugins`. Each plugin has its own folder with files named after the plugin.

```
src/extensions/site/plugins/
└── {plugin-name}/
    ├── {plugin-name}.tsx           # Main plugin component (HTMLElement)
    ├── {plugin-name}.panel.tsx     # Settings panel component
    └── {plugin-name}.extension.ts  # Extension registration
public/
└── {plugin-name}-logo.svg          # Plugin logo (optional)
```

## References

| Topic | Reference |
| --- | --- |
| Complete Examples | [EXAMPLES.md](references/EXAMPLES.md) |
| Slots (App IDs, multiple placements, finding slots) | [SLOTS.md](references/SLOTS.md) |
| WDS Components | [wds-docs](../wds-docs/SKILL.md) |

## Available Slots

Site plugins integrate into predefined slots in Wix business solutions. Each slot is identified by:

- **appDefinitionId**: The ID of the Wix app (e.g., Stores, Bookings)
- **widgetId**: The ID of the page containing the slot
- **slotId**: The specific slot identifier

Common placement areas include product pages (Wix Stores), checkout and side cart (Wix eCommerce), booking pages (Wix Bookings), service pages, event pages, and blog post pages.

For supported pages, common Wix App IDs, and how to find slot IDs, see [SLOTS.md](./references/SLOTS.md).

## Extension Registration

**Extension registration is MANDATORY and has TWO required steps.**

### Step 1: Create Plugin-Specific Extension File

Copy [extension-template.ts](assets/extension-template.ts) into your plugin folder and adapt it. See the template comments for what to change.

**Extension properties reference:**

| Property                   | Type    | Description                                                     |
| -------------------------- | ------- | --------------------------------------------------------------- |
| `id`                       | string  | Unique static UUID v4 (generate fresh)                          |
| `name`                     | string  | Internal name for the plugin                                    |
| `marketData.name`          | string  | Display name in plugin explorer and app dashboard               |
| `marketData.description`   | string  | Description shown in plugin explorer and app dashboard          |
| `marketData.logoUrl`       | string  | Path to logo file (`{{BASE_URL}}` resolves to public folder)    |
| `placements`               | array   | Array of slot placements where plugin can be added              |
| `placements.appDefinitionId` | string | ID of the Wix app containing the slot                          |
| `placements.widgetId`      | string  | ID of the page containing the slot                              |
| `placements.slotId`        | string  | ID of the specific slot                                         |
| `installation.autoAdd`       | boolean | Whether to auto-add plugin to slots on app installation       |
| `tagName`                  | string  | HTML custom element tag (kebab-case, must contain a hyphen)     |
| `element`                  | string  | Relative path to plugin component                               |
| `settings`                 | string  | Relative path to settings panel component                       |

### Step 2: Register in Main Extensions File

**CRITICAL:** After creating the plugin-specific extension file, you MUST read [wix-cli-extension-registration](../wix-cli-extension-registration/SKILL.md) and follow the "App Registration" section to update `src/extensions.ts`.

**Without completing Step 2, the site plugin will not be available in the plugin explorer.**

## Checkout Plugins

If you are building a plugin for the **checkout page**, it may not support automatic addition upon installation. You must create a dashboard page to provide users with a way to add the plugin to their site. See [EXAMPLES.md](references/EXAMPLES.md) for the dashboard page pattern.

## Examples

For complete examples with all three required files (plugin component, settings panel, extension configuration), see [EXAMPLES.md](references/EXAMPLES.md).

**Example use cases:**

- **Best Seller Badge** - Customizable badge on product pages with text and color settings
- **Booking Confirmation** - Custom confirmation message for booking pages
- **Product Reviews Summary** - Star rating and review count display
- **Data-Driven Plugin** - Plugin with Wix Data API integration and editor environment handling

## Best Practices

### Implementation Guidelines

- **Use inline styles** - CSS imports are not supported in custom elements
- **Handle editor environment** - Show placeholders when in editor mode for data-dependent plugins
- **Do not call `define()`** - Wix handles `customElements.define()` for you automatically
- **Validate all input** - Check required props are present
- **Follow naming conventions** - kebab-case for all attributes and widget API
- **Keep plugins focused** - Each plugin should do one thing well
- **Test in multiple slots** - If supporting multiple placements, test each one
- **Support both Stores versions** - Include placements for both old and new Wix Stores product pages for maximum compatibility

### Editor Sandboxing

Site plugins are sandboxed when rendered in the editor. This means they're treated as if they come from a different domain, which impacts access to browser storage APIs.

**Restricted APIs in the editor:**
- `localStorage` and `sessionStorage` (Web Storage API)
- `document.cookie` (Cookie Store API)
- IndexedDB API
- Cache API

**How to handle sandboxing:**

Use the `viewMode()` function from `@wix/site-window` to check the current mode before accessing restricted APIs:

```typescript
import { window as wixWindow } from '@wix/site-window';

const viewMode = await wixWindow.viewMode();

if (viewMode === 'Site') {
  const item = localStorage.getItem('myKey');
} else {
  // Mock storage or modify API usage for editor mode
}
```

### Using Wix SDK Modules in Site Plugins

Site plugins can import and use Wix SDK modules directly — you do NOT need `createClient()`. The Wix runtime provides the client context automatically.

```typescript
// CORRECT — Import SDK modules directly
import { items } from "@wix/data";
import { currentCart } from "@wix/ecom";
import { products } from "@wix/stores";

class MyPlugin extends HTMLElement {
  async loadData() {
    // Call SDK methods directly — no createClient needed
    const result = await items.query("MyCollection").find();
    const cart = await currentCart.getCurrentCart();
    const productList = await products.queryProducts().limit(10).find();
  }
}
```

```typescript
// WRONG — Do NOT use createClient in site plugins
import { createClient } from "@wix/sdk";
const wixClient = createClient({ modules: { items, products } });
await wixClient.items.query(...); // Wrong — API surface differs through client
```

### Performance Considerations

- Keep bundle size small - plugins load on user-facing pages
- Avoid heavy computations on initial render
- Lazy load data when possible
- Use efficient re-rendering patterns
