---
name: wix-app
description: "Build Wix CLI app extensions — dashboard pages, modals, plugins, menu plugins, site widgets, site components, site plugins, embedded scripts, backend APIs, backend events, service plugins, data collections. Use when building ANY feature or extension for a Wix CLI app. Triggers on: add, build, create, implement, help me, dashboard, widget, plugin, backend, API, event, collection, embedded script, service plugin, site component, checkout, shipping, tax, discount, SPI, CMS, schema, tracking, popup, admin panel, menu item, modal, validate, test, verify, register extension."
compatibility: Requires Wix CLI development environment.
---

# Wix App Builder

Helps build extensions for Wix CLI applications. Covers all extension types: dashboard pages, modals, plugins, menu plugins, site widgets, site components, site plugins, embedded scripts, backend APIs, events, service plugins, and data collections.

## ⚠️ MANDATORY WORKFLOW CHECKLIST ⚠️

**Before reporting completion to the user, ALL boxes MUST be checked:**

- [ ] **Step 1:** Determined extension type(s) needed
  - [ ] Asked clarifying questions if requirements were unclear
  - [ ] Checked for implicit Data Collection need — unless user provided a collection ID directly (see [Data Collection Inference](#data-collection-inference))
  - [ ] Obtained app namespace if Data Collection extension is being created
  - [ ] Determined full scoped collection IDs if Data Collection extension is being created (see [Collection ID Coordination](#collection-id-coordination))
  - [ ] Explained recommendation with reasoning
- [ ] **Step 2:** Read extension reference file(s) for the chosen type(s)
- [ ] **Step 3:** Checked API references; used MCP discovery only for gaps
- [ ] **Step 4:** Implemented all extensions
  - [ ] All files created
  - [ ] Extension(s) registered in extensions.ts
  - [ ] Invoked `wds-docs` skill FIRST when using @wix/design-system (for correct imports, especially icons)
- [ ] **Step 5:** Ran validation (see [Validation](#validation))
  - [ ] Dependencies installed
  - [ ] TypeScript compiled
  - [ ] Build succeeded
  - [ ] Preview deployed
- [ ] **Step 6:** Collected and presented ALL manual action items to user

**🛑 STOP:** If any box is unchecked, do NOT proceed to the next step.

---

## ❌ ANTI-PATTERNS (DO NOT DO)

| ❌ WRONG                                    | ✅ CORRECT                                     |
| ------------------------------------------- | ---------------------------------------------- |
| Implementing without reading the extension reference | Always read the relevant reference file first |
| Using MCP discovery without checking refs   | Check reference files first                    |
| Reporting done without validation           | Always run validation at the end               |
| Letting manual action items get buried      | Aggregate all manual steps at the very end     |

---

## Quick Decision Helper

1. **What are you trying to build?**
   - Admin interface → Dashboard Extensions
   - Backend logic → Backend Extensions
   - Data storage / CMS collections → Data Collection
   - Site component → Site Extensions (app projects only)

2. **Who will see it?**
   - Admin users only → Dashboard Extensions
   - Site visitors → Site Extensions
   - Server-side only → Backend Extensions

3. **Where will it appear?**
   - Dashboard sidebar/page → Dashboard Page or Modal
   - Existing Wix app dashboard (widget) → Dashboard Plugin
   - Existing Wix app dashboard (menu item) → Dashboard Menu Plugin
   - Anywhere on site → Site Widget
   - Anywhere on site (with editor manifest) → Site Component
   - Wix business solution page → Site Plugin
   - During business flow → Service Plugin
   - After event occurs → Event Extension

## Decision Flow (Not sure?)

- **Admin:** Need full-page UI? → Dashboard Page. Need popup/form? → Dashboard Modal. Extending Wix app dashboard with a visual widget? → Dashboard Plugin. Adding a menu item to a Wix app dashboard's more-actions or bulk-actions menu? → Dashboard Menu Plugin. **Modal constraint:** Dashboard Pages cannot use `<Modal />`; use a separate Dashboard Modal extension and `dashboard.openModal()`.
- **Backend:** During business flow (checkout/shipping/tax)? → Service Plugin. After event (webhooks/sync)? → Event Extension. Custom HTTP endpoints? → Backend Endpoints. Need CMS collections for app data? → Data Collection.
- **Site:** User places anywhere (standalone)? → Site Widget. React component with editor manifest (styling, content, elements)? → Site Component. Fixed slot on Wix app page? → Site Plugin. Scripts/analytics only? → Embedded Script.

---

## Extension Types Reference Table

| Extension Type        | Category  | Visibility  | Use When                              | Reference File                                          |
| --------------------- | --------- | ----------- | ------------------------------------- | ------------------------------------------------------- |
| Dashboard Page        | Dashboard | Admin only  | Full admin pages                      | [DASHBOARD_PAGE.md](references/DASHBOARD_PAGE.md)       |
| Dashboard Modal       | Dashboard | Admin only  | Popup dialogs                         | [DASHBOARD_MODAL.md](references/DASHBOARD_MODAL.md)     |
| Dashboard Plugin      | Dashboard | Admin only  | Extend Wix app dashboards             | [DASHBOARD_PLUGIN.md](references/DASHBOARD_PLUGIN.md)   |
| Dashboard Menu Plugin | Dashboard | Admin only  | Add menu items to Wix app dashboards  | [DASHBOARD_MENU_PLUGIN.md](references/DASHBOARD_MENU_PLUGIN.md) |
| Service Plugin        | Backend   | Server-side | Customize business flows              | [SERVICE_PLUGIN.md](references/SERVICE_PLUGIN.md)       |
| Event Extension       | Backend   | Server-side | React to events                       | [BACKEND_EVENT.md](references/BACKEND_EVENT.md)         |
| Backend Endpoints     | Backend   | API         | Custom HTTP handlers                  | [BACKEND_API.md](references/BACKEND_API.md)             |
| Data Collection       | Backend   | Data        | CMS collections for app data          | [DATA_COLLECTION.md](references/DATA_COLLECTION.md)     |
| Site Component        | Site      | Public      | React components with editor manifests| [SITE_COMPONENT.md](references/SITE_COMPONENT.md)       |
| Site Widget           | Site      | Public      | Standalone widgets                    | [SITE_WIDGET.md](references/SITE_WIDGET.md)             |
| Site Plugin           | Site      | Public      | Extend Wix business solutions         | [SITE_PLUGIN.md](references/SITE_PLUGIN.md)             |
| Embedded Script       | Site      | Public      | Inject scripts/analytics              | [EMBEDDED_SCRIPT.md](references/EMBEDDED_SCRIPT.md)     |
**Key constraints:**
- Dashboard Page cannot use `<Modal />`; use a separate Dashboard Modal and `dashboard.openModal()`.

## Extension Comparison

| Site Widget vs Site Component vs Site Plugin | Dashboard Page vs Modal | Service Plugin vs Event |
| -------------------------------------------- | ----------------------- | ----------------------- |
| Widget: standalone interactive component. Component: React with editor manifest (CSS/data/elements). Plugin: fixed slot in Wix app page. | Page: full page. Modal: overlay; use for popups. | Service: during flow. Event: after event. |

---

## Cross-Cutting References

| Topic | Reference |
| --- | --- |
| Extension Registration | [EXTENSION_REGISTRATION.md](references/EXTENSION_REGISTRATION.md) |
| App Validation | [APP_VALIDATION.md](references/APP_VALIDATION.md) |
| App Identifiers (Namespace, Code ID) | [APP_IDENTIFIERS.md](references/APP_IDENTIFIERS.md) |
| Wix Stores Versioning (V1/V3) | [STORES_VERSIONING.md](references/STORES_VERSIONING.md) |
| Official Documentation Links | [DOCUMENTATION.md](references/DOCUMENTATION.md) |

---

## Data Collection Inference

**CRITICAL:** Data collections are often needed implicitly — don't wait for the user to explicitly say "create a CMS collection." Infer the need automatically.

**Skip this section if the user provides a collection ID directly** (e.g., an existing site-level collection). In that case, use the provided ID as-is — no Data Collection extension or namespace scoping needed.

**Always include a Data Collection extension when ANY of these are true:**

| Indicator | Example |
| --- | --- |
| User mentions saving/storing/persisting app-specific data | "save the fee amount", "store product recommendations" |
| A dashboard page will **manage** (CRUD) domain entities | "dashboard to manage fees", "admin page to edit rules" |
| A service plugin reads app-configured data at runtime | "fetch fee rules at checkout", "look up shipping rates" |
| User mentions "dedicated database/collection" | "save in a dedicated database collection" |
| Multiple extensions reference the same custom data | Dashboard manages fees + service plugin reads fees |

**Why this matters:** Without the Data Collection extension, the collection won't be created when the app is installed, the Wix Data APIs may not work (code editor not enabled), and collection IDs won't be properly scoped to the app namespace.

**If data collection is inferred, follow the [App Namespace Requirement](#app-namespace-requirement) to obtain the namespace before proceeding.**

### App Namespace Requirement

When creating a Data Collection, you MUST ask the user for their app namespace from Wix Dev Center. This is a required parameter that must be obtained from the user's Dev Center dashboard and cannot be recommended or guessed.

If the user hasn't provided their app namespace, read [APP_IDENTIFIERS.md](references/APP_IDENTIFIERS.md) and give the user the instructions to obtain it.

### Collection ID Coordination

**Applies ONLY when a Data Collection extension is being created.** If the user provides a collection ID directly, use it as-is — no namespace scoping, no Data Collection extension needed.

When a Data Collection is created alongside other extensions that reference the same collections:

1. **Get the app namespace** (see App Namespace Requirement above)
2. **Determine the `idSuffix`** for each collection (the Data Collection reference documents the full ID format)
3. **Use the full scoped collection ID** (`<app-namespace>/<idSuffix>`) in all extensions that reference the collection via Wix Data API calls

---

## Wix Stores Versioning Requirement

**Applies when ANY Wix Stores API is used** (products, inventory, orders, etc.):

1. **Read the Stores Versioning reference** — see [STORES_VERSIONING.md](references/STORES_VERSIONING.md)
2. **All Stores operations must check catalog version first** using `getCatalogVersion()`
3. **Use the correct module** based on version: `productsV3` (V3) vs `products` (V1)

This is non-negotiable — V1 and V3 are NOT backwards compatible.

---

## Implementation Workflow

### Step 1: Ask Clarifying Questions (if needed)

Only ask for configuration values when **absolutely necessary** for the implementation to proceed. If a value can be configured later or added as a manual step, don't block on it.

**Code Identifier Requirement:**
When creating a Site Component, you need the user's Code Identifier. If not provided, read [APP_IDENTIFIERS.md](references/APP_IDENTIFIERS.md) and give the user the instructions to obtain it.

If unclear on approach (placement, visibility, configuration, integration), ask clarifying questions. If the answer could change the extension type, wait for the response before proceeding. Otherwise, proceed with the best-fit extension type.

### Step 2: Make Your Recommendation

Use the Extension Types Reference Table and decision content above. State extension type and brief reasoning (placement, functionality, integration).

### Step 3: Read Extension Reference, Check API References, Then Discover (if needed)

**Workflow: Read extension reference → Check API references → Use MCP only for gaps.**

1. **Read the extension reference file** for the chosen extension type from the table above
2. **Identify required APIs** from user requirements
3. **Check relevant API reference files:**
   - Backend events → `references/backend-event/COMMON-EVENTS.md`
   - Wix Data → `references/dashboard-page/WIX_DATA.md`
   - Dashboard SDK → `references/dashboard-page/DASHBOARD_API.md`
   - Service Plugin SPIs → `references/service-plugin/*.md`
4. **Verify the specific method/event exists** in references
5. **ONLY use MCP discovery if NOT found** in reference files

**Platform APIs (never discover - in references):**
- Wix Data, Dashboard SDK, Event SDK (common events), Service Plugin SPIs

**Vertical APIs (discover if needed):**
- Wix Stores (**⚠️ MUST use Stores Versioning reference** — V1/V3 catalog check required), Wix Bookings, Wix Members, Wix Pricing Plans, third-party integrations

**Decision table:**

| User Requirement                     | Check References / Discovery Needed? | Reason / Reference File                             |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------- |
| "Display store products"             | ✅ YES (MCP discovery)               | Wix Stores API — **include Stores Versioning reference** |
| "Show booking calendar"              | ✅ YES (MCP discovery)               | Wix Bookings API not in reference files             |
| "Send emails to users"               | ✅ YES (MCP discovery)               | Wix Triggered Emails not in reference files         |
| "Get member info"                    | ✅ YES (MCP discovery)               | Wix Members API not in reference files              |
| "Listen for cart events"             | Check `COMMON-EVENTS.md`             | MCP discovery only if event missing in reference    |
| "Store data in collection"           | WIX_DATA.md ✅ Found                 | ❌ Skip discovery (covered by reference)             |
| "Create CMS collections for my app"  | Data Collection reference            | ❌ Skip discovery (covered by dedicated reference)   |
| "Show dashboard toast"               | DASHBOARD_API.md ✅ Found            | ❌ Skip discovery                                   |
| "Show toast / navigate"              | DASHBOARD_API.md ✅ Found            | ❌ Skip discovery                                   |
| "UI only (forms, inputs)"            | N/A (no external API)                | ❌ Skip discovery                                   |
| "Settings page with form inputs"     | N/A (UI only, no external API)       | ❌ Skip discovery                                   |
| "Dashboard page with local state"    | N/A (no external API)                | ❌ Skip discovery                                   |

**MCP Tools for discovery (when needed):**

- `SearchWixSDKDocumentation` - SDK methods and APIs (**Always use maxResults: 5**)
- `ReadFullDocsArticle` - Full documentation when needed (only if search results need more detail)

### Step 4: Implement Extensions

Follow the extension reference file to implement each extension. Key rules:

- ⚠️ MANDATORY when using WDS: Invoke the `wds-docs` skill FIRST to get correct imports (icons are from `@wix/wix-ui-icons-common`, NOT `@wix/design-system/icons`).
- ⚠️ MANDATORY when using Data Collections: Use EXACT collection ID from `idSuffix` (case-sensitive). Example: If `idSuffix` is "product-recommendations", use `<app-namespace>/product-recommendations` NOT `productRecommendations`.
- Register all extensions in `src/extensions.ts` (see [Extension Registration](#extension-registration)).

### Step 5: Run Validation

After all implementation is complete, you MUST run validation. See [APP_VALIDATION.md](references/APP_VALIDATION.md) for the complete validation workflow:

1. Package installation (detect package manager, run install)
2. TypeScript compilation check (`npx tsc --noEmit`)
3. Build validation (`npx wix build`)
4. Preview deployment (`npx wix preview`)

**Do NOT report completion to the user until validation passes.**

If validation fails, fix the errors and re-validate until it passes.

### Step 6: Report Completion

Only after validation passes, provide a **concise summary section** at the top of your response:

```markdown
## ✅ Implementation Complete

[1-2 sentence description of what was built]

**Extensions Created:**
- [Extension 1 Name] - [Brief purpose]
- [Extension 2 Name] - [Brief purpose]

**Build Status:**
- ✅ Dependencies: [Installed / status message]
- ✅ TypeScript: [No compilation errors / status]
- ✅ Build: [Completed successfully / status]
- ✅/⚠️ Preview: [Running at URL / Failed - reason]

**⚠️ IMPORTANT: [X] manual step(s) required to complete setup** (see "Manual Steps Required" section below)
```

- If there are NO manual steps, state: "✅ No manual steps required — you're ready to go!"

### Step 7: Surface Manual Action Items

Present any manual steps the user must perform (e.g., configuring settings in the Wix dashboard, enabling permissions, setting up external services).

**Format:**

```markdown
## 🔧 Manual Steps Required

The following actions need to be done manually by you:

### 1. [Action Category/Title]
[Detailed description with specific instructions]

### 2. [Action Category/Title]
[Detailed description]
```

---

## Extension Registration

After creating any extension file, you must update the main `src/extensions.ts` file to register the extension with the app. See [EXTENSION_REGISTRATION.md](references/EXTENSION_REGISTRATION.md) for the complete guide.

**Quick pattern:**

```typescript
import { app } from "@wix/astro/builders";
import { dashboardpageMyPage } from "./extensions/dashboard/pages/my-page/extensions.ts";
import { embeddedscriptMyScript } from "./extensions/site/embedded-scripts/my-script/extensions.ts";

export default app()
  .use(dashboardpageMyPage)
  .use(embeddedscriptMyScript);
```

Without registration, extensions will not appear or function in the Wix dashboard/editor/site.

---

## Validation

Execute these steps sequentially after all implementation is complete. See [APP_VALIDATION.md](references/APP_VALIDATION.md) for the complete guide.

1. **Package Installation** — Detect package manager, run install
2. **TypeScript Compilation** — `npx tsc --noEmit`
3. **Build** — `npx wix build`
4. **Preview** — `npx wix preview`

Stop and report errors if any step fails. Check `.wix/debug.log` on failures.

---

## Cost Optimization

- **Read extension reference first** — always read the relevant extension reference file before implementing
- **Check API references first** — read relevant API reference files before using MCP discovery
- **Skip discovery** when all required APIs are in reference files
- **maxResults: 5** for all MCP SDK searches
- **ReadFullDocsArticle** only when search results need more context
- **Invoke wds-docs** first when using WDS (prevents import errors)

## Documentation

For links to official Wix CLI documentation for all extension types, see [DOCUMENTATION.md](references/DOCUMENTATION.md).
