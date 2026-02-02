---
name: wix-cli-planner
description: ⚠️ BLOCKING REQUIREMENT ⚠️ When user requests to add/build/create/implement ANY feature or component for a Wix CLI app, you MUST invoke this skill IMMEDIATELY as your absolute FIRST action - when exploring, reading files, BEFORE launching any agents - make sure this skill is loaded. Trigger on "add [X]", "build [X]", "create [X]", "I want [X]", "implement [X]", "help me [X]" where X is any feature/component. Non-negotiable: invoke immediately upon recognizing a Wix feature build request.
compatibility: Requires Wix CLI development environment.
---

# Wix CLI Extension Planner

Helps select the appropriate Wix CLI extension type based on use case and requirements.

## ⚠️ MANDATORY WORKFLOW CHECKLIST ⚠️

**Before reporting completion to the user, ALL boxes MUST be checked:**

- [ ] **Step 1:** Determined extension type(s) needed
- [ ] **Step 2:** Spawned discovery sub-agent (MCP searches + WDS component query)
- [ ] **Step 3:** Waited for discovery sub-agent to complete
- [ ] **Step 4:** Spawned implementation sub-agent(s) with skill context
- [ ] **Step 5:** Waited for implementation sub-agent(s) to complete
- [ ] **Step 6:** Invoked `wix-cli-app-validation` skill
- [ ] **Step 7:** Validation passed

**🛑 STOP:** If any box is unchecked, do NOT proceed to the next step.

---

## Your Role

You are a **decision-maker and orchestrator**, not an implementer. Your job is to:

1. **Ask clarifying questions** if the requirements are unclear
2. **Recommend the appropriate extension type** using the decision trees below
3. **Explain why** that extension type fits the use case
4. **Spawn a discovery sub-agent** to find relevant SDK methods and WDS best practices
5. **Spawn implementation sub-agent(s)** to hand off execution
6. **Run validation** after implementation completes

Your ONLY job is: **Decide → Discovery Sub-Agent → Implementation Sub-Agent(s) → Validation**

---

## ❌ ANTI-PATTERNS (DO NOT DO)

| ❌ WRONG                                    | ✅ CORRECT                                     |
| ------------------------------------------- | ---------------------------------------------- |
| Writing implementation code yourself        | Spawning a sub-agent to implement              |
| Invoking implementation skills directly     | Spawning sub-agent with skill context          |
| Skipping MCP discovery                      | Always spawn discovery sub-agent first         |
| Reporting done without validation           | Always run `wix-cli-app-validation` at the end |
| Reading/writing files after invoking skills | Let sub-agents handle ALL file operations      |

**CRITICAL:** After this planner skill loads, you should ONLY:

- Spawn sub-agents (for discovery and implementation)
- Run shell commands (ONLY for WDS component queries)
- Invoke `wix-cli-app-validation` skill at the end

You should NEVER: Read, Write, Edit files for implementation yourself

## Quick Decision Helper

Answer these questions to find the right extension:

1. **What are you trying to build?**
   - Admin interface → Dashboard Extensions
   - Backend logic → Backend Extensions
   - Site component → Site Extensions (app projects only)

2. **Who will see it?**
   - Admin users only → Dashboard Extensions
   - Site visitors → Site Extensions
   - Server-side only → Backend Extensions

3. **Where will it appear?**
   - Dashboard sidebar/page → Dashboard Page or Modal
   - Existing Wix app dashboard → Dashboard Plugin
   - Anywhere on site → Site Widget
   - Wix business solution page → Site Plugin
   - During business flow → Service Plugin
   - After event occurs → Event Extension

## Decision Flow

### Need to build an admin interface?

1. **Full page with sidebar navigation?** → Dashboard Page
2. **Popup dialog triggered from a page?** → Dashboard Modal
3. **Extend existing Wix app dashboard (Stores, Bookings, etc.)?** → Dashboard Plugin or Dashboard Menu Plugin

**Not sure?**

- Need custom routes and full-page UI? → Dashboard Page
- Need quick form or confirmation? → Dashboard Modal
- Extending Wix's built-in dashboards? → Dashboard Plugin

**⚠️ Modal Constraint:** Dashboard Pages cannot use `<Modal />` directly. If your page needs popups, you need BOTH a Dashboard Page AND a Dashboard Modal extension.

### Need to handle backend logic?

1. **React to events after they occur (webhooks)?** → Event Extension
2. **Customize Wix business solution flows (shipping, fees, taxes)?** → Service Plugin
3. **Create custom REST API endpoints?** → Backend Endpoints

**Not sure?**

- Need to modify checkout/shipping/tax calculation? → Service Plugin
- Need to sync data when something happens? → Event Extension
- Need custom HTTP endpoints? → Backend Endpoints

### Need to add frontend components?

1. **Standalone widget, placeable anywhere?** → Site Widget
2. **Extend Wix business solution page (product page, booking page)?** → Site Plugin
3. **Inject script/analytics/tracking?** → Embedded Script

**Not sure?**

- User chooses where to place it? → Site Widget
- Must go in specific slot on Wix app page? → Site Plugin
- Just need to add tracking code? → Embedded Script

## Extension Types

### Dashboard Extensions

Admin interfaces for managing sites and business data. Not visible to site visitors.

#### Dashboard Pages

**Use when:**

- Creating full admin pages for managing app data, settings, or business logic
- Building data management interfaces (CRUD operations)
- Implementing custom dashboard navigation and workflows

**Don't use when:**

- Need a popup dialog → Use Dashboard Modal
- Extending existing Wix app dashboard → Use Dashboard Plugin

**Key constraints:**

- Appears in dashboard sidebar navigation
- Full-page dashboard interfaces
- **CRITICAL: Cannot use `<Modal />` component directly** - WDS Modal components don't work in dashboard pages. To show popups/dialogs, you MUST create a separate Dashboard Modal extension and open it via `dashboard.openModal()`

**Examples:**

- Product management interface
- Order tracking dashboard
- Settings configuration page
- Analytics dashboard

#### Dashboard Modals

**Use when:**

- Creating popup dialogs triggered from dashboard pages
- Confirmation dialogs
- Quick data entry forms
- Detail views for records
- **Any time you need a modal/popup inside a Dashboard Page** (since `<Modal />` doesn't work in dashboard pages)

**Don't use when:**

- Need full page with navigation → Use Dashboard Page
- Extending Wix app dashboard → Use Dashboard Plugin

**Key constraints:**

- **Required for any popup/modal in dashboard pages** - This is the ONLY way to show modals in dashboard pages
- Overlay dialogs on top of dashboard pages
- Controlled via Dashboard SDK `openModal()` and `closeModal()`
- Can receive data from parent dashboard page
- Must be a separate extension (cannot be inline in dashboard page code)

**Examples:**

- "Add new item" form modal
- Confirmation dialogs for destructive actions
- Quick edit forms
- Detail view popups

#### Dashboard Plugins

**Use when:**

- Extending functionality of existing Wix app dashboard pages
- Adding custom components to predefined slots in Wix app dashboards
- Enhancing built-in Wix app pages with custom features

**Don't use when:**

- Creating your own dashboard page → Use Dashboard Page
- Adding menu items → Use Dashboard Menu Plugin

**Key constraints:**

- Plug into predefined slots in Wix app dashboard pages
- Extend apps made by Wix (not your own dashboard pages)
- Can observe and interact with dashboard page state

**Examples:**

- Adding custom analytics widget to Wix Stores dashboard
- Extending Wix Bookings dashboard with custom features
- Adding custom components to Wix Events dashboard

#### Dashboard Menu Plugins

**Use when:**

- Adding menu items to existing Wix app dashboard pages
- Creating navigation to dashboard modals or other dashboard pages
- Extending menu functionality in Wix app dashboards

**Don't use when:**

- Adding components to dashboard page → Use Dashboard Plugin
- Creating your own dashboard page → Use Dashboard Page

**Key constraints:**

- Add menu items to pre-configured slots
- Can navigate to dashboard modals or pages
- Simple configuration-based extension
- Extend apps made by Wix

**Examples:**

- Adding "Export Data" menu item
- Creating shortcut to custom dashboard modal
- Adding navigation to external dashboard

### Backend Extensions

Server-side logic, events, and integrations with Wix business solutions.

#### Service Plugins

**Use when:**

- Injecting custom logic into Wix business solution flows
- Customizing eCommerce flows (shipping, fees, taxes, validations)
- Extending checkout behavior
- Adding custom business rules to Wix apps

**Don't use when:**

- Reacting to events after they occur → Use Event Extension
- Creating custom API endpoints → Use Backend Endpoints

**Key constraints:**

- Set of APIs defined by Wix for specific flows
- Called by Wix during specific business solution operations
- Can modify or extend existing Wix flows

**Common service plugin types:**

- **Shipping Rates** - Calculate custom shipping costs
- **Additional Fees** - Add handling fees, rush delivery, etc.
- **Tax Calculation** - Custom tax computation logic
- **Cart/Checkout Validations** - Validate orders before completion
- **Gift Cards** - Integrate gift card systems
- **Discount Triggers** - Custom discount logic

**Examples:**

- Calculate shipping based on custom carrier API
- Add packaging fees to orders
- Validate minimum order amounts
- Apply custom discount rules

#### Event Extensions

**Use when:**

- Reacting to specific conditions or events in your project
- Handling webhooks for Wix business solutions
- Implementing event-driven workflows
- Syncing data with external systems when events occur

**Don't use when:**

- Modifying business flows during execution → Use Service Plugin
- Creating custom API endpoints → Use Backend Endpoints

**Key constraints:**

- Triggered when specific conditions are met
- One handler per event type (cannot have 2 extensions listening to same event)
- Asynchronous execution

**Examples:**

- Send notification when booking is confirmed
- Sync order data to external CRM
- Trigger email campaigns on purchase
- Update inventory when product is sold

#### Backend Endpoints

**Use when:**

- Creating REST API endpoints
- Building custom HTTP handlers
- Implementing server-side data processing
- Creating webhooks for external services

**Don't use when:**

- Customizing Wix business flows → Use Service Plugin
- Reacting to Wix events → Use Event Extension

**Key constraints:**

- Support all HTTP methods (GET, POST, PUT, DELETE, PATCH)
- Dynamic route parameters
- Full control over request/response handling

**Note:** Astro endpoints replace HTTP functions and Web Methods from previous CLI versions.

### Site Extensions

Frontend components visible to site visitors. Only relevant for app projects (not headless projects).

#### Site Widgets

**Use when:**

- Creating standalone, draggable UI components
- Building configurable widgets for site pages
- Creating components that can be placed anywhere on a site
- Building interactive widgets with settings panels

**Don't use when:**

- Extending Wix business solution pages → Use Site Plugin
- Injecting scripts/analytics → Use Embedded Script

**Key constraints:**

- Draggable in Wix Editor
- Built-in settings panel for customization
- Can be placed anywhere on site pages

**Examples:**

- Countdown timer widget
- Calculator widget
- Custom form widget
- Interactive map widget
- Social media feed widget

#### Site Plugins

**Use when:**

- Extending Wix business solutions (Stores, Bookings, Events, etc.)
- Adding components to predefined slots in Wix apps
- Integrating with Wix business solution pages
- Creating components that enhance Wix app functionality

**Don't use when:**

- Standalone widget placeable anywhere → Use Site Widget
- Injecting scripts → Use Embedded Script
- Building for checkout page → Use Wix Blocks (CLI not supported)

**Key constraints:**

- Placed in predefined slots within Wix business solutions
- Integrated into Wix app pages (product pages, booking pages, etc.)
- Available via plugin explorer in Wix editors

**Examples:**

- Add review widget to product page
- Custom booking form component
- Event registration enhancement
- Product recommendation component

**Note:** Currently, site plugins built with CLI aren't supported on the checkout page. Use Wix Blocks for checkout plugins.

#### Embedded Scripts

**Use when:**

- Injecting HTML/JavaScript code into site pages
- Adding analytics tracking pixels
- Integrating third-party services
- Customizing site behavior with scripts
- Adding popups or overlays

**Don't use when:**

- Building interactive UI components → Use Site Widget or Site Plugin
- Need React components → Use Site Widget

**Key constraints:**

- Consent-aware script types (Essential, Functional, Analytics, Advertising)
- Configurable placement (HEAD, BODY_START, BODY_END)
- Dynamic parameters via dashboard configuration

**Examples:**

- Google Analytics tracking
- Facebook Pixel integration
- Custom popup scripts
- Third-party chat widgets
- A/B testing scripts

## Extension Comparison

### Site Widget vs Site Plugin

| Decision Factor | Site Widget                   | Site Plugin                           |
| --------------- | ----------------------------- | ------------------------------------- |
| **Placement**   | User chooses anywhere on site | Fixed slots in Wix business solutions |
| **Best for**    | Standalone widgets            | Extend Wix business solutions         |
| **Choose when** | Need flexible placement       | Must integrate with Wix app pages     |

### Dashboard Page vs Dashboard Modal

| Decision Factor | Dashboard Page          | Dashboard Modal              |
| --------------- | ----------------------- | ---------------------------- |
| **Scope**       | Full page               | Overlay dialog               |
| **Best for**    | Main admin interface    | Quick actions, forms, popups |
| **Choose when** | Need sidebar navigation | Triggered from existing page |

**Important:** If your Dashboard Page needs to show any popup/modal, you MUST also create a Dashboard Modal extension. Use `dashboard.openModal()` from the page to open it.

### Service Plugin vs Event Extension

| Decision Factor | Service Plugin              | Event Extension       |
| --------------- | --------------------------- | --------------------- |
| **Timing**      | During business flow        | After condition met   |
| **Best for**    | Modify/extend flow          | React to event        |
| **Choose when** | Customize checkout/shipping | Sync external systems |

## Quick Reference Table

| Extension Type        | Category  | Visibility  | Use When                      |
| --------------------- | --------- | ----------- | ----------------------------- |
| Dashboard Page        | Dashboard | Admin only  | Full admin pages              |
| Dashboard Modal       | Dashboard | Admin only  | Popup dialogs                 |
| Dashboard Plugin      | Dashboard | Admin only  | Extend Wix app dashboards     |
| Dashboard Menu Plugin | Dashboard | Admin only  | Add menu items                |
| Service Plugin        | Backend   | Server-side | Customize business flows      |
| Event Extension       | Backend   | Server-side | React to events               |
| Backend Endpoints     | Backend   | API         | Custom HTTP handlers          |
| Site Widget           | Site      | Public      | Standalone widgets            |
| Site Plugin           | Site      | Public      | Extend Wix business solutions |
| Embedded Script       | Site      | Public      | Inject scripts/analytics      |

## Decision & Handoff Workflow

After determining the correct extension type, follow this workflow:

### Step 1: Ask Clarifying Questions (if needed)

If the user's requirements are unclear, ask about:

- **Placement**: Where should this appear? (dashboard, site, backend)
- **Visibility**: Who will see it? (admin users, site visitors, server-side only)
- **Configuration**: Does it need customization by the site owner?
- **Integration**: Does it extend an existing Wix app or business solution?

### Step 2: Make Your Recommendation

Use the decision trees above to determine the appropriate extension type. Explain your reasoning briefly:

```
Based on your requirements, I recommend using [EXTENSION TYPE] because:
- [Reason 1 related to placement/visibility]
- [Reason 2 related to functionality]
- [Reason 3 related to integration needs]
```

### Step 3: Spawn Discovery Sub-Agent

⚠️ **BLOCKING REQUIREMENT** ⚠️

You MUST spawn a dedicated sub-agent for discovery. This keeps verbose search results (3,000-5,000 tokens each) isolated from the main context.

The discovery sub-agent performs ALL discovery tasks:

1. **First:** Search MCP for SDK methods and WDS best practices
2. **Then:** Run the local WDS component query script

**MCP Tools the sub-agent should use:**

- `mcp__wix-mcp-remote__SearchWixSDKDocumentation` - SDK methods and APIs
- `mcp__wix-mcp-remote__SearchWixWDSDocumentation` - WDS best practices and patterns
- `mcp__wix-mcp-remote__ReadFullDocsArticle` - Full documentation when needed

**WDS Component Query Script (run AFTER MCP searches):**

```bash
node .claude/skills/wix-cli-planner/scripts/query-wds-components.js <ComponentName> [<ComponentName> ...]

# Examples:
node .claude/skills/wix-cli-planner/scripts/query-wds-components.js Button Table Card
node .claude/skills/wix-cli-planner/scripts/query-wds-components.js ColorInput FormField Input
node .claude/skills/wix-cli-planner/scripts/query-wds-components.js Page Page.Header EmptyState
```

**Discovery sub-agent prompt template:**

```
Discover SDK methods, WDS best practices, and component details for building [EXTENSION TYPE].

STEP 1: Search MCP documentation
- Search WDS documentation for "[extension type] best practices" (e.g., "dashboard page best practices")
- Search SDK documentation for relevant APIs

STEP 2: Query WDS components
Run the local script to get component details:
node .claude/skills/wix-cli-planner/scripts/query-wds-components.js [ComponentName1] [ComponentName2] ...

Return ONLY a concise summary in this format:

## SDK Methods & Interfaces

| Name                      | Type   | TypeScript Type                              | Description       |
| ------------------------- | ------ | -------------------------------------------- | ----------------- |
| `moduleName.methodName()` | Method | `(params: ParamType) => Promise<ReturnType>` | Brief description |

**Import:** `import { methodName } from '@wix/sdk-module';`

## WDS Components & Interfaces

| Name              | Type      | TypeScript Type            | Description |
| ----------------- | --------- | -------------------------- | ----------- |
| `<ComponentName>` | Component | `React.FC<ComponentProps>` | UI purpose  |

**Import:** `import { ComponentName } from '@wix/design-system';`

Also include:
- WDS best practices for this extension type
- WDS component do's and don'ts from the script output
- UI/UX patterns and recommendations
- Any gotchas or constraints
```

**Do NOT proceed to Step 4 until this sub-agent completes.**

#### Discovery Search Reference

| Extension Type  | WDS Best Practices Search                                     | SDK Search                                |
| --------------- | ------------------------------------------------------------- | ----------------------------------------- |
| Dashboard Page  | "dashboard page best practices"                               | "Wix Data API", "dashboard SDK"           |
| Dashboard Modal | "dashboard modal best practices"                              | "dashboard openModal closeModal"          |
| Site Widget     | "site widget best practices", "custom element best practices" | "Wix Data API", "site-window viewMode"    |
| Site Plugin     | "site plugin best practices"                                  | "Wix Stores API", "Wix Bookings API"      |
| Embedded Script | "embedded script best practices"                              | "embeddedScripts API"                     |
| Service Plugin  | "service plugin best practices"                               | Specific SPI (e.g., "shipping rates SPI") |

**Implementation skills also include static reference files:**

- Wix Data SDK (`references/WIX_DATA.md`) - CRUD operations
- Dashboard API (`references/DASHBOARD_API.md`) - navigation, toasts, modals

### Step 4: Spawn Implementation Sub-Agent(s)

⚠️ **BLOCKING REQUIREMENT** ⚠️

You MUST spawn sub-agent(s) for implementation. Do NOT invoke implementation skills directly. Do NOT write code yourself.

**Spawn an implementation sub-agent with the skill context:**

The sub-agent prompt should include:

1. The skill to load (e.g., `wix-cli-dashboard-page`)
2. The user's requirements
3. The SDK/WDS context from the discovery sub-agent

**Implementation sub-agent prompt template:**

```
Load and follow the skill: wix-cli-[skill-name]

User Requirements:
[Include the user's requirements here]

SDK/WDS Context from Discovery:
[Paste relevant findings from discovery sub-agent]

Implement this extension following the skill guidelines.
```

**PARALLEL EXECUTION:** When multiple independent extensions are needed, spawn ALL sub-agents in parallel:

| Extension Combination            | Parallel? | Reason                              |
| -------------------------------- | --------- | ----------------------------------- |
| Dashboard Page + Site Widget     | ✅ YES    | Independent UI contexts             |
| Dashboard Page + Dashboard Modal | ✅ YES    | Modal code is independent from page |
| Dashboard Page + Backend API     | ✅ YES    | Frontend vs backend                 |
| Site Widget + Embedded Script    | ✅ YES    | Different rendering contexts        |
| Service Plugin + Event Extension | ✅ YES    | Independent backend handlers        |

**Sequential execution required:**

- When one extension imports types/interfaces from another
- When user explicitly says "first X, then Y"

**Extension Type to Skill Mapping:**

| Extension Type          | Skill to Load             |
| ----------------------- | ------------------------- |
| Dashboard Page          | `wix-cli-dashboard-page`  |
| Dashboard Modal         | `wix-cli-dashboard-modal` |
| Dashboard Plugin        | No skill available yet    |
| Dashboard Menu Plugin   | No skill available yet    |
| Service Plugin          | `wix-cli-service-plugin`  |
| Event Extension         | No skill available yet    |
| Backend API / Endpoints | `wix-cli-backend-api`     |
| Site Widget             | `wix-cli-site-widget`     |
| Site Plugin             | `wix-cli-site-plugin`     |
| Embedded Script         | `wix-cli-embedded-script` |

**Wait for sub-agents to complete before proceeding to Step 5.**

### Step 5: Run Validation

⚠️ **BLOCKING REQUIREMENT** ⚠️

After ALL implementation sub-agents complete, you MUST run validation by invoking the `wix-cli-app-validation` skill.

**Do NOT report completion to the user until validation passes.**

If validation fails:

1. Review the errors
2. Spawn a new implementation sub-agent to fix the issues
3. Run validation again
4. Repeat until validation passes

### Step 6: Report Completion

Only after validation passes, report to the user:

- What was created
- How to test it (preview commands)
- Any next steps

## Related Skills & Sub-Agents

**Discovery Sub-Agent:**

Spawn a sub-agent to perform ALL discovery tasks:

1. **First:** Search MCP for best practices and SDK methods:
   - `mcp__wix-mcp-remote__SearchWixSDKDocumentation`
   - `mcp__wix-mcp-remote__SearchWixWDSDocumentation`
   - `mcp__wix-mcp-remote__ReadFullDocsArticle`

2. **Then:** Run the WDS component query script:
   ```bash
   node .claude/skills/wix-cli-planner/scripts/query-wds-components.js [ComponentNames...]
   ```

Using a sub-agent keeps verbose search results (3,000-5,000 tokens each) isolated from the main context.

**Implementation Sub-Agents:**

Spawn sub-agents with skill context for implementation:

| Extension Type  | Skill to Load             |
| --------------- | ------------------------- |
| Dashboard Page  | `wix-cli-dashboard-page`  |
| Dashboard Modal | `wix-cli-dashboard-modal` |
| Backend API     | `wix-cli-backend-api`     |
| Service Plugin  | `wix-cli-service-plugin`  |
| Site Widget     | `wix-cli-site-widget`     |
| Site Plugin     | `wix-cli-site-plugin`     |
| Embedded Script | `wix-cli-embedded-script` |

**Validation:**

Invoke the `wix-cli-app-validation` skill after implementation completes.

## Complete Workflow Example

```
User: "Create a survey app with dashboard management and site widget"

1. [DECIDE] Recommend: Dashboard Page + Site Widget

2. [DISCOVERY SUB-AGENT]
   Spawn sub-agent with prompt:
   "Discover SDK methods, WDS best practices, and component details for Dashboard Page and Site Widget.

   STEP 1: Search MCP documentation
   - Search WDS docs for 'dashboard page best practices' and 'site widget best practices'
   - Search SDK docs for 'Wix Data API'

   STEP 2: Query WDS components (AFTER MCP searches)
   Run: node .claude/skills/wix-cli-planner/scripts/query-wds-components.js Table Card Button Input FormField

   Return best practices, patterns, component do's/don'ts, and relevant methods."

3. [WAIT] Wait for discovery sub-agent to complete

4. [IMPLEMENTATION SUB-AGENTS - PARALLEL]
   Spawn sub-agent: "Load skill: wix-cli-dashboard-page. Create survey manager with [requirements]. Context: [discovery findings]"
   Spawn sub-agent: "Load skill: wix-cli-site-widget. Create survey widget with [requirements]. Context: [discovery findings]"

5. [WAIT] Wait for both implementation sub-agents to complete

6. [VALIDATION]
   Invoke: wix-cli-app-validation skill

7. [REPORT] Tell user what was created and how to test
```

## Documentation

For detailed documentation on all extension types, see [references/DOCUMENTATION.md](references/DOCUMENTATION.md).
