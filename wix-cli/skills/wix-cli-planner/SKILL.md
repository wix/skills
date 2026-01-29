---
name: wix-cli-planner
description: ⚠️ BLOCKING REQUIREMENT ⚠️ When user requests to add/build/create/implement ANY feature or component for a Wix CLI app, you MUST invoke this skill IMMEDIATELY as your absolute FIRST action - when exploring, reading files, BEFORE launching any agents - make sure this skill is loaded. Trigger on "add [X]", "build [X]", "create [X]", "I want [X]", "implement [X]", "help me [X]" where X is any feature/component. Non-negotiable: invoke immediately upon recognizing a Wix feature build request.
compatibility: Requires Wix CLI development environment.
---

# Wix CLI Extension Planner

Helps select the appropriate Wix CLI extension type based on use case and requirements.

## Your Role

You are a **decision-maker**, not an implementer. Your job is to:

1. **Ask clarifying questions** if the requirements are unclear
2. **Recommend the appropriate extension type** using the decision trees below
3. **Explain why** that extension type fits the use case
4. **Launch agent** to discover relevant SDK methods/interfaces and WDS components
5. **Invoke the implementation skill** to hand off execution with SDK/WDS context

Your ONLY job is: **Decide → Agent (SDK/WDS Discovery) → Implementation Skill → Hand off**

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

| Decision Factor   | Dashboard Page                        | Dashboard Modal                        |
| ----------------- | ------------------------------------- | -------------------------------------- |
| **Scope**         | Full page                             | Overlay dialog                         |
| **Best for**      | Main admin interface                  | Quick actions, forms, popups           |
| **Choose when**   | Need sidebar navigation               | Triggered from existing page           |

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

### Step 3: Discover SDK Methods & WDS Components

**IMPORTANT:** Before invoking the implementation skill, use the general-purpose agent to discover relevant Wix SDK methods/interfaces and WDS components/interfaces.

**Why use an agent?** MCP search results are verbose (3,000-5,000 tokens per search). Using an agent keeps the main context clean by running searches in isolation and returning only condensed, relevant results.

**Agent prompt template:**

```markdown
You are discovering Wix SDK methods and WDS components for a Wix CLI extension.

**Extension Type:** [The extension type you recommended]
**Feature Description:** [What the user wants to build]
**Key Functionality:** [Specific data/actions needed]

Your task:
1. Use mcp__plugin_wix-cli_wix-mcp-remote__SearchWixSDKDocumentation to search for relevant SDK methods (maxResults=3-5)
2. Use mcp__plugin_wix-cli_wix-mcp-remote__SearchWixWDSDocumentation to search for relevant WDS components (maxResults=3-5)
3. Return ONLY a concise summary in this format:

## SDK Methods & Interfaces

| Name | Type | Description |
| ---- | ---- | ----------- |
| `moduleName.methodName()` | Method | Brief description |

**Import:** `import { methodName } from '@wix/sdk-module';`

## WDS Components & Interfaces

| Name | Type | Description |
| ---- | ---- | ----------- |
| `<ComponentName>` | Component | UI purpose |

**Import:** `import { ComponentName } from '@wix/design-system';`
```

**Example invocation:**

```markdown
I'll discover relevant SDK and WDS modules for this Dashboard Page that manages bookings.

[Launch general-purpose agent with the prompt above]
```

### Step 4: Invoke the Implementation Skill

**CRITICAL:** After discovering relevant SDK/WDS modules, immediately invoke the corresponding implementation skill. Pass along both:
1. The original user requirements
2. The SDK/WDS recommendations from the picker

Do NOT create a plan yourself. Do NOT explore the codebase. The implementation skill will handle all planning and execution.

**Extension Type to Skill Mapping:**

| Extension Type          | Skill to Invoke           |
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

**Example Handoff with SDK/WDS Context:**

```markdown
I recommend using an Embedded Script extension because you want to add a popup banner visible to site visitors.

I found these relevant modules:
- SDK: `@wix/dashboard` - `showToast()` for notifications
- WDS: `<AnnouncementModalLayout>` for popup styling, `<Button>` for actions

Now I'll hand off to the wix-cli-embedded-script skill to handle the implementation with these SDK/WDS recommendations.
```

Then immediately invoke the skill.

### Step 5: End Your Involvement

After launching the SDK/WDS discovery agent and invoking the implementation skill, your job is done.

## Related Skills & Agents

**SDK/WDS Discovery (launch general-purpose agent first):**

The general-purpose agent has access to all MCP tools needed for discovery:
- `mcp__plugin_wix-cli_wix-mcp-remote__SearchWixSDKDocumentation`
- `mcp__plugin_wix-cli_wix-mcp-remote__SearchWixWDSDocumentation`
- `mcp__plugin_wix-cli_wix-mcp-remote__ReadFullDocsArticle`

Using an agent keeps verbose search results (3,000-5,000 tokens each) isolated from the main context.

**Implementation skills (invoke after SDK/WDS discovery):**

- `wix-cli-dashboard-page` - Dashboard page implementation
- `wix-cli-dashboard-modal` - Dashboard modal implementation
- `wix-cli-backend-api` - Backend API endpoints
- `wix-cli-service-plugin` - Service plugin implementation
- `wix-cli-site-widget` - Site widget implementation
- `wix-cli-site-plugin` - Site plugin implementation
- `wix-cli-embedded-script` - Embedded script implementation

## Documentation

For detailed documentation on all extension types, see [references/DOCUMENTATION.md](references/DOCUMENTATION.md).
