
# Wix Embedded Script Builder

Embedded scripts are HTML code fragments injected into the DOM of Wix sites — for integration with third-party services, analytics tracking, advertising, and custom JavaScript functionality.

## Scaffold

Use `wix generate --params` with `extensionType: EMBEDDED_SCRIPT`. Allowed values:

| Field | Values |
| --- | --- |
| `scriptType` | `ESSENTIAL`, `FUNCTIONAL`, `ANALYTICS`, `ADVERTISING` |
| `placement` | `HEAD`, `BODY_START`, `BODY_END` |

The CLI generates the folder, `embedded.html`, the builder file, the UUID, and the `src/extensions.ts` registration.

**Companion dashboard page** — Every embedded script needs a configuration UI. Scaffold a separate `DASHBOARD_PAGE` extension and use `embeddedScripts` from `@wix/app-management` to load/save parameters (see [Dashboard Page reference](DASHBOARD_PAGE.md)).

After implementation, the app developer must enable `SCOPE.DC-APPS.MANAGE-EMBEDDED-SCRIPTS` in the Wix Dev Center — see [Enable Embedded Script Permission](#enable-embedded-script-permission).

## Script Types

Embedded scripts must declare a type for consent management:

| Type          | Description                                      | Use Cases                               |
| ------------- | ------------------------------------------------ | --------------------------------------- |
| `ESSENTIAL`   | Core functionality crucial to site operation     | Authentication, security features       |
| `FUNCTIONAL`  | Remembers user choices to improve experience     | Language preferences, UI customization  |
| `ANALYTICS`   | Provides statistics on how visitors use the site | Google Analytics, Hotjar, Mixpanel      |
| `ADVERTISING` | Provides visitor data for marketing purposes     | Facebook Pixel, Google Ads, retargeting |

**Selection rule:** If a script falls into multiple types, choose the option closest to the bottom of the list (most restrictive). For example, a script with both Analytics and Advertising aspects should be typed as `ADVERTISING`.

## Placement Options

| Placement    | Description                              | Best For                          |
| ------------ | ---------------------------------------- | --------------------------------- |
| `HEAD`       | Between `<head>` and `</head>` tags      | Analytics, early initialization   |
| `BODY_START` | Immediately after opening `<body>` tag   | Critical functionality, noscript  |
| `BODY_END`   | Immediately before closing `</body>` tag | Non-blocking scripts, performance |

**Selection guidelines:**

- Analytics/tracking → `HEAD` (initialize early)
- Advertising pixels → `BODY_END` (non-blocking)
- Critical functionality → `HEAD` or `BODY_START`
- Non-critical features → `BODY_END` (better performance)

## Dynamic Parameters and Dashboard Configuration

**Every embedded script requires a companion dashboard page** to configure its parameters. Site owners use the dashboard page UI to set values, which are then passed to the embedded script as template variables.

### Architecture Flow

```
Dashboard Page (React UI)
    │
    │  embeddedScripts.embedScript({ parameters: {...} })
    ▼
Wix App Management API
    │
    │  Stores parameters, injects as template variables
    ▼
Embedded Script (HTML)
    │
    │  {{parameterKey}} → actual value
    ▼
Site DOM
```

### Parameter Types

| Type       | Description              | Dashboard Component    |
| ---------- | ------------------------ | ---------------------- |
| `TEXT`     | Single-line text         | Input                  |
| `NUMBER`   | Numeric value            | Input type="number"    |
| `BOOLEAN`  | True/false toggle        | ToggleSwitch, Checkbox |
| `IMAGE`    | Image from media manager | ImagePicker            |
| `DATE`     | Date only                | DatePicker             |
| `DATETIME` | Date with time           | DatePicker + TimeInput |
| `URL`      | URL with validation      | Input                  |
| `SELECT`   | Dropdown options         | Dropdown               |
| `COLOR`    | Color value              | ColorPicker            |

### Template Variable Syntax

Embedded scripts support parameterization using template variable syntax `{{variableName}}`. These parameters are configured through the dashboard and passed as template variables that should be used in your HTML/JavaScript code.

**Usage Instructions:**

1. **Template Variable Syntax:**
   - Use `{{parameterKey}}` syntax to insert parameter values into your HTML
   - Template variables work in HTML attributes
   - They will be replaced with actual values when the script is injected

2. **HTML Attributes (REQUIRED):**
   - Store ALL parameter values in data attributes on a configuration element
   - Template variables can ONLY be used here, not directly in JavaScript
   - Example: `<div id="config" data-headline="{{headline}}" data-text="{{text}}"></div>`

3. **JavaScript Access:**
   - JavaScript must read parameter values from the data attributes
   - Use `getAttribute()` or the `dataset` property
   - Examples:
     ```javascript
     const config = document.getElementById("config");
     const headline = config?.getAttribute("data-headline");
     // OR using dataset:
     const { headline, text } = config.dataset;
     ```

4. **Type Safety:**
   - Be aware of parameter types when using them in JavaScript
   - NUMBER types: convert with `Number()` or `parseInt()`
   - BOOLEAN types: compare with `'true'` or `'false'` strings
   - DATE/DATETIME: parse with `new Date()`

5. **Required vs Optional:**
   - Required parameters will always have values
   - Optional parameters may be empty - handle gracefully
   - Provide fallback values for optional parameters

6. **Relevant Parameter Usage:**
   - Only use dynamic parameters that are relevant to your current use case
   - Ignore parameters that don't apply to the functionality you're implementing
   - Each parameter you use should serve a clear purpose in the script's functionality
   - It's perfectly fine to not use all parameters if they're not applicable

**Example Patterns:**

**Pattern 1 - Configuration in Data Attributes:**

```html
<div
  id="script-config"
  data-api-key="{{apiKey}}"
  data-enabled="{{enabled}}"
  data-color="{{primaryColor}}"
></div>
<script>
  const config = document.getElementById("script-config");
  const apiKey = config.getAttribute("data-api-key");
  const enabled = config.getAttribute("data-enabled") === "true";
  const color = config.getAttribute("data-color");

  if (enabled && apiKey) {
    // Initialize with configuration
  }
</script>
```

**Pattern 2 - Using dataset Property:**

```html
<div
  id="script-config"
  data-headline="{{headline}}"
  data-message="{{message}}"
  data-image-url="{{imageUrl}}"
></div>
<script>
  const config = document.getElementById("script-config");
  const { headline, message, imageUrl } = config.dataset;

  // Use the variables in your script logic
  if (headline) {
    document.querySelector("#headline").textContent = headline;
  }
</script>
```

**Pattern 3 - Conditional Logic:**

```html
<div
  id="config"
  data-mode="{{activationMode}}"
  data-start="{{startDate}}"
  data-end="{{endDate}}"
></div>
<script>
  const config = document.getElementById("config");
  const mode = config.getAttribute("data-mode");

  if (mode === "timed") {
    const startDate = new Date(config.getAttribute("data-start"));
    const endDate = new Date(config.getAttribute("data-end"));
    const now = new Date();

    if (now >= startDate && now <= endDate) {
      // Show content
    }
  } else if (mode === "active") {
    // Show content immediately
  }
</script>
```

**Validation Requirements:**

- Only use dynamic parameters that are relevant to your specific use case
- Ignore parameters that don't apply to the functionality being implemented
- Template variables `{{parameterKey}}` must match the exact key names from the parameter definitions
- Handle both required and optional parameters appropriately
- Provide sensible default behavior when optional parameters are not set
- Ensure type-appropriate usage (don't use NUMBER parameters as strings without conversion)

### Common Parameters

Every embedded script should have at minimum an **enable/disable toggle** parameter:

| Parameter    | Type      | Purpose                              |
| ------------ | --------- | ------------------------------------ |
| `enabled`    | `BOOLEAN` | Allow site owner to activate/disable |
| `apiKey`     | `TEXT`    | Third-party service credentials      |
| `trackingId` | `TEXT`    | Analytics/pixel identifiers          |
| `headline`   | `TEXT`    | Customizable display text            |
| `color`      | `COLOR`   | UI customization                     |

## Implementation Pattern

Inside the generated `embedded.html`:

```html
<!-- Configuration element with template variables -->
<div id="my-config" data-api-key="{{apiKey}}" data-enabled="{{enabled}}"></div>

<!-- Container for dynamic content -->
<div id="my-container"></div>

<style>
  /* Scoped styles for the embedded content */
  #my-container {
    /* styles */
  }
</style>

<script type="module">
  // Get configuration from data attributes
  const config = document.getElementById("my-config");
  if (!config) throw new Error("Config element not found");

  const { apiKey, enabled } = config.dataset;

  // Exit early if disabled (use throw at module scope, not return)
  if (enabled !== "true") {
    throw new Error("Script disabled");
  }

  // Implement functionality in a named function (return is allowed here)
  async function initialize() {
    try {
      // Your implementation
    } catch (error) {
      console.error("Script error:", error);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
</script>
```

## Examples

### Analytics Tracking

**Request:** "Add Google Analytics tracking to my site"

**Output:**

- Script type: `ANALYTICS`
- Placement: `HEAD`
- Template variables: `{{trackingId}}`
- Implements: gtag.js initialization, page view tracking

### Popup/Modal

**Request:** "Create a coupon popup that shows when cart value exceeds $50"

**Output:**

- Script type: `FUNCTIONAL`
- Placement: `BODY_END`
- Template variables: `{{couponCode}}`, `{{minimumCartValue}}`, `{{enablePopup}}`
- Implements: Cart value detection, popup display logic, localStorage for "don't show again"

### Third-Party Chat Widget

**Request:** "Integrate Intercom chat widget"

**Output:**

- Script type: `FUNCTIONAL`
- Placement: `BODY_END`
- Template variables: `{{appId}}`, `{{userEmail}}`, `{{userName}}`
- Implements: Intercom SDK initialization, user identification

## Best Practices

- **Always create a dashboard page:** Every embedded script needs a configuration UI
- **Include enable/disable toggle:** Let site owners control activation without removing the script
- **Performance:** Minimize impact - scripts should be lightweight and non-blocking
- **Security:** Avoid inline event handlers, validate data, escape user input
- **Error handling:** Fail silently when appropriate - don't break the site
- **Module scope early exits:** Use `throw new Error()` for early exits at module scope, not `return`. Rollup (used by Astro) doesn't allow `return` statements at module scope. Wrap main logic in a named async function where `return` is valid.
- **Type conversions:** Parameters are always strings - convert in JavaScript as needed
- **API calls:** Only create fetch() calls to /api/\* endpoints that exist in the API spec
- **Scoping:** Prefix CSS classes and IDs to avoid conflicts with site styles
- **Cleanup:** Remove event listeners and intervals when appropriate

## Complete Example: Coupon Popup

### 1. Define Parameters

```
Parameters for "cart-coupon-popup":
- couponCode (TEXT, required) - The coupon code to display
- popupHeadline (TEXT, required) - Headline text
- popupDescription (TEXT, required) - Description text
- minimumCartValue (NUMBER) - Minimum cart value to show popup
- enablePopup (BOOLEAN, required) - Enable/disable toggle
```

### 2. Embedded Script (`embedded.html`)

```html
<div
  id="popup-config"
  data-coupon-code="{{couponCode}}"
  data-popup-headline="{{popupHeadline}}"
  data-minimum-cart-value="{{minimumCartValue}}"
  data-enable-popup="{{enablePopup}}"
></div>
<div id="popup-container"></div>

<script type="module">
  // Get configuration from data attributes
  const config = document.getElementById("popup-config");
  if (!config) throw new Error("Config element not found");

  const { couponCode, popupHeadline, minimumCartValue, enablePopup } =
    config.dataset;

  // Exit early if disabled (use throw at module scope, not return)
  if (enablePopup !== "true") {
    throw new Error("Popup disabled");
  }

  // Main logic in a function (return is allowed here)
  async function initializePopup() {
    const minValue = Number(minimumCartValue) || 0;
    // ... popup implementation
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePopup);
  } else {
    initializePopup();
  }
</script>
```

### 3. Dashboard Page (See the DASHBOARD_PAGE.md reference)

Uses `embeddedScripts` API from `@wix/app-management`:

```typescript
import { embeddedScripts } from "@wix/app-management";

// Load parameters
const script = await embeddedScripts.getEmbeddedScript();
const params = script.parameters; // { couponCode: "...", ... }

// Save parameters (all values must be strings)
await embeddedScripts.embedScript({
  parameters: {
    couponCode: "SAVE20",
    minimumCartValue: "50", // Number as string
    enablePopup: "true", // Boolean as string
  },
});
```

## Enable Embedded Script Permission

After implementation, the app developer must manually enable the embedded script permission:

1. Go to [https://manage.wix.com/apps/{app-id}/dev-center-permissions](https://manage.wix.com/apps/{app-id}/dev-center-permissions) (replace `{app-id}` with your actual app ID)
2. Add the `SCOPE.DC-APPS.MANAGE-EMBEDDED-SCRIPTS` permission
3. Save the changes

**Note:** This is a manual step in the Wix Dev Center. Without this permission, embedded scripts will not function on the site.
