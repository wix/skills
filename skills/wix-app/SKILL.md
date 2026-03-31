---
name: wix-app
description: "Build Wix CLI app extensions — dashboard pages, modals, plugins, menu plugins, site widgets, site components, site plugins, embedded scripts, backend APIs, backend events, service plugins, data collections, context providers. Use when building ANY feature or extension for a Wix CLI app. Triggers on: add, build, create, implement, help me, dashboard, widget, plugin, backend, API, event, collection, embedded script, service plugin, site component, checkout, shipping, tax, discount, SPI, CMS, schema, tracking, popup, admin panel, menu item, modal, context provider, validate, test, verify, register extension."
compatibility: Requires Wix CLI development environment.
---

# Wix App Builder

Helps build extensions for Wix CLI applications. Covers all extension types: dashboard pages, modals, plugins, menu plugins, site widgets, site components, site plugins, embedded scripts, backend APIs, events, service plugins, data collections, and context providers.

## ⚠️ MANDATORY WORKFLOW CHECKLIST ⚠️

**Before reporting completion to the user, ALL boxes MUST be checked:**

- [ ] **Step 1:** Determined extension type(s) needed
  - [ ] Asked clarifying questions if requirements were unclear
  - [ ] Checked for implicit Data Collection need — unless user provided a collection ID directly (see [Data Collection Inference](#data-collection-inference))
  - [ ] Obtained app namespace if Data Collection extension is being created
  - [ ] Determined full scoped collection IDs if Data Collection extension is being created (see [Collection ID Coordination](#collection-id-coordination))
  - [ ] Explained recommendation with reasoning
- [ ] **Step 2:** Checked references, spawned discovery if needed
  - [ ] Checked relevant reference files for required APIs
  - [ ] Spawned discovery only if API not found in references
  - [ ] Skip if all APIs are in reference files or no external APIs needed
- [ ] **Step 3:** Waited for discovery sub-agent to complete (if spawned)
  - [ ] Received SDK methods with imports
- [ ] **Step 4:** Spawned implementation sub-agent(s) with extension reference context
  - [ ] Included user requirements in prompt
  - [ ] Included SDK context from discovery (if any)
  - [ ] Instructed sub-agent to invoke `wds-docs` skill FIRST when using @wix/design-system (for correct imports, especially icons)
- [ ] **Step 5:** Waited for implementation sub-agent(s) to complete
  - [ ] All files created
  - [ ] Extension registered in extensions.ts
- [ ] **Step 6:** Ran validation (see [Validation](#validation))
- [ ] **Step 7:** Validation passed
  - [ ] Dependencies installed
  - [ ] TypeScript compiled
  - [ ] Build succeeded
  - [ ] Preview deployed
- [ ] **Step 8:** Collected and presented ALL manual action items to user

**🛑 STOP:** If any box is unchecked, do NOT proceed to the next step.

---

## Your Role

You are a **decision-maker and orchestrator**, not an implementer. **Decide → Read Extension Reference → Check API References → Discovery (if needed) → Implementation Sub-Agent(s) → Validation → Surface Manual Actions.** Ask clarifying questions if unclear; recommend extension type; read the corresponding extension reference file; check API reference files first, spawn discovery only for missing SDK methods; spawn implementation sub-agents; run validation; aggregate and present all manual action items at the end.

---

## ❌ ANTI-PATTERNS (DO NOT DO)

| ❌ WRONG                                    | ✅ CORRECT                                     |
| ------------------------------------------- | ---------------------------------------------- |
| Writing implementation code yourself        | Spawning a sub-agent to implement              |
| Implementing without reading the extension reference | Always read the relevant reference file first |
| Discovering extension SDK (dashboard, etc.) | Extension SDK is in reference files            |
| Spawning discovery without checking refs    | Check reference files first                    |
| Reporting done without validation           | Always run validation at the end               |
| Reading/writing files after reading references | Let sub-agents handle ALL file operations    |
| Letting manual action items get buried      | Aggregate all manual steps at the very end     |
| Using site widget/plugin to consume context provider extensions | Only site components can consume context provider extensions |

**CRITICAL:** After this skill loads, you should ONLY:

- Read extension reference files (to include in sub-agent prompts)
- Spawn sub-agents (for discovery and implementation)
- Run validation at the end

You should NEVER: Read, Write, Edit files for implementation yourself.

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
| Context Provider      | Site      | Public      | Shared state for site components      | [CONTEXT_PROVIDER.md](references/CONTEXT_PROVIDER.md)   |

**Key constraints:**
- Dashboard Page cannot use `<Modal />`; use a separate Dashboard Modal and `dashboard.openModal()`.
- **Only Site Components can consume context provider extensions** — NOT site widgets or site plugins.

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

**Instructions to give the user:**

**If you don't have an app namespace yet:**
1. Go to [Wix Dev Center](https://manage.wix.com/studio/custom-apps/)
2. Select your app
3. In the left menu, select **Develop > Extensions**
4. Click **+ Create Extension** and find the **Data Collections** extension
5. Click **+ Create**
6. You will be prompted to create an app namespace - follow the prompts to set it up

**If you already have an app namespace:**
1. Go to [Wix Dev Center](https://manage.wix.com/studio/custom-apps/)
2. Open your app dashboard
3. Click the three dots (...) menu button in the top-right corner (next to "Test App" button)
4. Select "View ID & keys" from the dropdown menu
5. In the modal that opens, scroll to the bottom to find the "Namespace" field
6. Copy the Namespace value

### Collection ID Coordination

**Applies ONLY when a Data Collection extension is being created.** If the user provides a collection ID directly, use it as-is — no namespace scoping, no Data Collection extension needed.

When a Data Collection is created alongside other extensions that reference the same collections:

1. **Get the app namespace** (see App Namespace Requirement above)
2. **Determine the `idSuffix`** for each collection (the Data Collection reference documents the full ID format)
3. **Pass the full scoped collection ID** (`<app-namespace>/<idSuffix>`) to every other sub-agent (dashboard page, service plugin, etc.) so they use it in all Wix Data API calls

---

## Wix Stores Versioning Requirement

**Applies when ANY Wix Stores API is used** (products, inventory, orders, etc.):

1. **Include the Stores Versioning reference** in implementation sub-agent prompts — see [STORES_VERSIONING.md](references/STORES_VERSIONING.md)
2. **All Stores operations must check catalog version first** using `getCatalogVersion()`
3. **Use the correct module** based on version: `productsV3` (V3) vs `products` (V1)

This is non-negotiable — V1 and V3 are NOT backwards compatible.

---

## Decision & Handoff Workflow

### Step 1: Ask Clarifying Questions (if needed)

Only ask for configuration values when **absolutely necessary** for the implementation to proceed. If a value can be configured later or added as a manual step, don't block on it.

If unclear on approach (placement, visibility, configuration, integration), ask clarifying questions. If the answer could change the extension type, wait for the response before proceeding. Otherwise, proceed with the best-fit extension type.

### Step 2: Make Your Recommendation

Use the Extension Types Reference Table and decision content above. State extension type and brief reasoning (placement, functionality, integration).

### Step 3: Read Extension Reference, Check API References, Then Discover (if needed)

**Workflow: Read extension reference → Check API references → Search only for gaps.**

1. **Read the extension reference file** for the chosen extension type from the table above
2. **Identify required APIs** from user requirements
3. **Check relevant API reference files:**
   - Backend events → `references/backend-event/COMMON-EVENTS.md`
   - Wix Data → `references/dashboard-page/WIX_DATA.md`
   - Dashboard SDK → `references/dashboard-page/DASHBOARD_API.md`
   - Service Plugin SPIs → `references/service-plugin/*.md`
4. **Verify the specific method/event exists** in references
5. **ONLY spawn discovery if NOT found** in reference files

**Platform APIs (never discover - in references):**
- Wix Data, Dashboard SDK, Event SDK (common events), Service Plugin SPIs

**Vertical APIs (discover if needed):**
- Wix Stores (**⚠️ MUST use Stores Versioning reference** — V1/V3 catalog check required), Wix Bookings, Wix Members, Wix Pricing Plans, third-party integrations

**Decision table:**

| User Requirement                     | Check References / Discovery Needed? | Reason / Reference File                             |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------- |
| "Display store products"             | ✅ YES (Spawn discovery)             | Wix Stores API — **include Stores Versioning reference** |
| "Show booking calendar"              | ✅ YES (Spawn discovery)             | Wix Bookings API not in reference files             |
| "Send emails to users"               | ✅ YES (Spawn discovery)             | Wix Triggered Emails not in reference files         |
| "Get member info"                    | ✅ YES (Spawn discovery)             | Wix Members API not in reference files              |
| "Listen for cart events"             | Check `COMMON-EVENTS.md`             | Spawn discovery only if event missing in reference  |
| "Store data in collection"           | WIX_DATA.md ✅ Found                 | ❌ Skip discovery (covered by reference)             |
| "Create CMS collections for my app"  | Data Collection reference            | ❌ Skip discovery (covered by dedicated reference)   |
| "Show dashboard toast"               | DASHBOARD_API.md ✅ Found            | ❌ Skip discovery                                   |
| "Show toast / navigate"              | DASHBOARD_API.md ✅ Found            | ❌ Skip discovery                                   |
| "UI only (forms, inputs)"            | N/A (no external API)                | ❌ Skip discovery                                   |
| "Settings page with form inputs"     | N/A (UI only, no external API)       | ❌ Skip discovery                                   |
| "Dashboard page with local state"    | N/A (no external API)                | ❌ Skip discovery                                   |

**MCP Tools the sub-agent should use:**

- `SearchWixSDKDocumentation` - SDK methods and APIs (**Always use maxResults: 5**)
- `ReadFullDocsArticle` - Full documentation when needed (only if search results need more detail)

**Discovery sub-agent prompt template:**

```
Discover SDK methods for [SPECIFIC API/EVENT NOT IN REFERENCE FILES].

Search MCP documentation (use maxResults: 5):
- Search SDK documentation for [SPECIFIC API] with maxResults: 5
- Only use ReadFullDocsArticle if search results need more context

Return ONLY a concise summary in this format:

## SDK Methods & Interfaces

| Name                      | Type   | TypeScript Type                              | Description       |
| ------------------------- | ------ | -------------------------------------------- | ----------------- |
| `moduleName.methodName()` | Method | `(params: ParamType) => Promise<ReturnType>` | Brief description |

**Import:** `import { methodName } from '@wix/sdk-module';`

Include any gotchas or constraints discovered.

## Manual Action Items
List any manual steps the user must perform (e.g., configure dashboard settings, enable permissions). Write "None" if there are no manual steps.

**Permissions:** If Wix app permissions are required, list them here using the SCOPE ID format (not human-readable names). Examples:
- `@wix/data` read operations (query, get) require "SCOPE.DC-DATA.READ"
- `@wix/data` write operations (insert, update, remove) require "SCOPE.DC-DATA.WRITE"
- Embedded scripts require "SCOPE.DC-APPS.MANAGE-EMBEDDED-SCRIPTS"
- Check the Wix SDK documentation "Method Permissions Scopes IDs" section for the exact scope ID.
- IMPORTANT: Use scope IDs like "SCOPE.DC-DATA.READ", NOT human-readable names like "Read Data Items".
```

**If discovery is spawned, wait for it to complete before proceeding to Step 4.**

### Step 4: Spawn Implementation Sub-Agent(s)

⚠️ **BLOCKING REQUIREMENT** ⚠️

You MUST spawn sub-agent(s) for implementation. Do NOT write code yourself.

**Spawn an implementation sub-agent with the extension reference context:**

The sub-agent prompt should include:

1. The extension reference content (read from the appropriate reference file)
2. The user's requirements
3. The SDK context from the discovery sub-agent (if any)
4. Instruction to invoke the `wds-docs` skill only when needed (when using @wix/design-system)

**Implementation sub-agent prompt MUST include:**

1. ✅ The extension reference content (from the reference file you read)
2. ✅ The user's original requirements (copy verbatim)
3. ✅ SDK methods discovered (with imports and types) — **only if discovery was performed**
4. ✅ Instruction to invoke `wds-docs` skill FIRST when using @wix/design-system (critical for correct imports, especially icons)
5. ✅ Any constraints or gotchas discovered
6. ✅ Collection Context with full scoped collection IDs — **only if Data Collection is being created**
7. ✅ Instruction to return manual action items (see below)

**Implementation sub-agent prompt template:**

```
Follow this extension reference guide:

[PASTE EXTENSION REFERENCE CONTENT HERE]

Extension Registration Guide:
[PASTE EXTENSION_REGISTRATION.md CONTENT HERE]

User Requirements:
[EXACT user request - copy verbatim]

[ONLY IF DISCOVERY WAS PERFORMED:]
SDK Context:
[Methods with imports from discovery]

Constraints:
[Any gotchas or limitations from discovery]

⚠️ MANDATORY when using WDS: Invoke the wds-docs skill FIRST to get correct imports (icons are from @wix/wix-ui-icons-common, NOT @wix/design-system/icons).

⚠️ MANDATORY when using Data Collections: Use EXACT collection ID from `idSuffix` (case-sensitive). Example: If `idSuffix` is "product-recommendations", use "<app-namespace>/product-recommendations" NOT "productRecommendations".

⚠️ MANDATORY: At the END of your response, include a section titled "## Manual Action Items" listing ANY steps the user must perform manually (e.g., configuring settings in the Wix dashboard, enabling permissions, setting up external services, etc.). If there are no manual steps, write "None". This section MUST always be present in your final response.

Implement this extension following the reference guidelines.
```

**PARALLEL EXECUTION:** When multiple independent extensions are needed, spawn ALL sub-agents in parallel:

| Extension Combination            | Parallel? | Reason                              |
| -------------------------------- | --------- | ----------------------------------- |
| Dashboard Page + Site Widget     | ✅ YES    | Independent UI contexts             |
| Dashboard Page + Dashboard Modal | ✅ YES    | Modal code is independent from page |
| Dashboard Page + Backend API     | ✅ YES    | Frontend vs backend                 |
| Site Widget + Embedded Script    | ✅ YES    | Different rendering contexts        |
| Service Plugin + Event Extension | ✅ YES    | Independent backend handlers        |
| Data Collection + Dashboard Page | ✅ YES    | Data schema vs UI                   |
| Data Collection + Backend API    | ✅ YES    | Data schema vs HTTP handlers        |
| Data Collection + Site Widget    | ✅ YES    | Data schema vs site UI              |
| Context Provider + Site Component | ✅ YES   | Provider vs consumer                |

**Pre-spawn coordination required (then parallel is fine):**

- When a Data Collection + other extensions reference the same collections: determine the full scoped collection IDs (`<app-namespace>/<idSuffix>`) BEFORE spawning sub-agents, then pass the IDs to all sub-agents and run them in parallel

**Sequential execution required:**

- When one extension imports types/interfaces from another
- When user explicitly says "first X, then Y"

**Wait for sub-agents to complete before proceeding to Step 5.**

### Step 5: Run Validation

⚠️ **BLOCKING REQUIREMENT** ⚠️

After ALL implementation sub-agents complete, you MUST run validation. See [APP_VALIDATION.md](references/APP_VALIDATION.md) for the complete validation workflow:

1. Package installation (detect package manager, run install)
2. TypeScript compilation check (`npx tsc --noEmit`)
3. Build validation (`npx wix build`)
4. Preview deployment (`npx wix preview`)

**Do NOT report completion to the user until validation passes.**

If validation fails:

1. Review the errors
2. Spawn a new implementation sub-agent to fix the issues
3. Run validation again
4. Repeat until validation passes

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

**Critical rules:**
- The summary MUST explicitly state how many manual steps are required
- The summary MUST reference where to find the manual steps
- If there are NO manual steps, state: "✅ No manual steps required — you're ready to go!"
- Keep the summary concise (under 200 words)

### Step 7: Surface Manual Action Items

⚠️ **BLOCKING REQUIREMENT** ⚠️

After ALL sub-agents complete, you MUST:

1. **Review every sub-agent's output** for any "Manual Action Items" section
2. **Aggregate ALL manual action items** into a single, deduplicated list
3. **Reference them in the summary section** (Step 6) by stating how many manual steps exist
4. **Present them prominently** at the very end of your final message

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

- **Read extension reference first** — always read the relevant extension reference file before spawning sub-agents
- **Check API references first** — read relevant API reference files before spawning discovery
- **Skip discovery** when all required APIs are in reference files
- **maxResults: 5** for all MCP SDK searches
- **ReadFullDocsArticle** only when search results need more context
- **Implementation prompts:** include only relevant SDK context from discovery (if performed)
- **Parallelize** independent sub-agents when possible
- **Invoke wds-docs** first when using WDS (prevents import errors)
- **Targets:** discovery output 500-1000 tokens; implementation prompt minimal; each search under 2000-3000 tokens

## Documentation

For links to official Wix CLI documentation for all extension types, see [DOCUMENTATION.md](references/DOCUMENTATION.md).
