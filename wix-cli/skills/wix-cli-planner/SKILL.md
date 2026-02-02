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
  - [ ] Asked clarifying questions if requirements were unclear
  - [ ] Explained recommendation with reasoning
- [ ] **Step 2:** Spawned discovery sub-agent (SDK documentation only)
  - [ ] Sub-agent searched SDK documentation via MCP
- [ ] **Step 3:** Waited for discovery sub-agent to complete
  - [ ] Received SDK methods with imports
- [ ] **Step 4:** Spawned implementation sub-agent(s) with skill context
  - [ ] Included user requirements in prompt
  - [ ] Included SDK context from discovery
  - [ ] Instructed sub-agent to invoke `wds-docs` skill only when needed (e.g. WDS component props or examples)
  - [ ] Instructed sub-agent to write summary log
- [ ] **Step 5:** Waited for implementation sub-agent(s) to complete
  - [ ] All files created
  - [ ] Extension registered in extensions.ts
- [ ] **Step 6:** Invoked `wix-cli-app-validation` skill
- [ ] **Step 7:** Validation passed
  - [ ] Dependencies installed
  - [ ] TypeScript compiled
  - [ ] Build succeeded
  - [ ] Preview deployed

**🛑 STOP:** If any box is unchecked, do NOT proceed to the next step.

---

## Your Role

You are a **decision-maker and orchestrator**, not an implementer. **Decide → Discovery Sub-Agent → Implementation Sub-Agent(s) → Validation.** Ask clarifying questions if unclear; recommend extension type using the decision content below; spawn discovery then implementation sub-agents; run validation.

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

## Decision Flow (Not sure?)

- **Admin:** Need full-page UI? → Dashboard Page. Need popup/form? → Dashboard Modal. Extending Wix app dashboard? → Dashboard Plugin. **Modal constraint:** Dashboard Pages cannot use `<Modal />`; use a separate Dashboard Modal extension and `dashboard.openModal()`.
- **Backend:** During business flow (checkout/shipping/tax)? → Service Plugin. After event (webhooks/sync)? → Event Extension. Custom HTTP endpoints? → Backend Endpoints.
- **Site:** User places anywhere? → Site Widget. Fixed slot on Wix app page? → Site Plugin. Scripts/analytics only? → Embedded Script.

## Quick Reference Table

| Extension Type        | Category  | Visibility  | Use When                      | Skill                     |
| --------------------- | --------- | ----------- | ----------------------------- | ------------------------- |
| Dashboard Page        | Dashboard | Admin only  | Full admin pages              | `wix-cli-dashboard-page`   |
| Dashboard Modal       | Dashboard | Admin only  | Popup dialogs                 | `wix-cli-dashboard-modal` |
| Dashboard Plugin      | Dashboard | Admin only  | Extend Wix app dashboards     | (none yet)                |
| Dashboard Menu Plugin | Dashboard | Admin only  | Add menu items                | (none yet)                |
| Service Plugin        | Backend   | Server-side | Customize business flows      | `wix-cli-service-plugin`   |
| Event Extension       | Backend   | Server-side | React to events               | (none yet)                |
| Backend Endpoints     | Backend   | API         | Custom HTTP handlers          | `wix-cli-backend-api`     |
| Site Widget           | Site      | Public      | Standalone widgets            | `wix-cli-site-widget`     |
| Site Plugin           | Site      | Public      | Extend Wix business solutions | `wix-cli-site-plugin`     |
| Embedded Script       | Site      | Public      | Inject scripts/analytics      | `wix-cli-embedded-script` |

**Key constraint:** Dashboard Page cannot use `<Modal />`; use a separate Dashboard Modal and `dashboard.openModal()`. Site plugins (CLI) not supported on checkout; use Wix Blocks.

### Backend Extensions

Server-side logic, events, and integrations with Wix business solutions.

#### Service Plugins

## Extension Comparison

| Site Widget vs Site Plugin | Dashboard Page vs Modal | Service Plugin vs Event |
| -------------------------- | ----------------------- | ----------------------- |
| Widget: user places anywhere. Plugin: fixed slot in Wix app. | Page: full page. Modal: overlay; use for popups. | Service: during flow. Event: after event. |

## Decision & Handoff Workflow

Follow the checklist; steps below add detail.

### Step 1: Ask Clarifying Questions (if needed)

If unclear: placement, visibility, configuration, integration. Wait if the answer changes extension type; otherwise proceed and say you can add optional extension later.

### Step 2: Make Your Recommendation

Use Quick Reference Table and decision content above. State extension type and brief reasoning (placement, functionality, integration).

### Step 3: Spawn Discovery Sub-Agent

⚠️ **BLOCKING REQUIREMENT** ⚠️

You MUST spawn a dedicated sub-agent for discovery. This keeps verbose search results (3,000-5,000 tokens each) isolated from the main context.

The discovery sub-agent performs SDK discovery only (no WDS lookups in discovery phase):

1. **Search MCP for SDK methods** relevant to the extension type

**MCP Tools the sub-agent should use:**

- `mcp__wix-mcp-remote__SearchWixSDKDocumentation` - SDK methods and APIs (**Always use maxResults: 5**)
- `mcp__wix-mcp-remote__ReadFullDocsArticle` - Full documentation when needed (only if search results need more detail)

**Discovery sub-agent prompt template:**

```
Discover SDK methods for building [EXTENSION TYPE].

Search MCP documentation (use maxResults: 5):
- Search SDK documentation for relevant APIs with maxResults: 5
- Only use ReadFullDocsArticle if search results need more context

Return ONLY a concise summary in this format:

## SDK Methods & Interfaces

| Name                      | Type   | TypeScript Type                              | Description       |
| ------------------------- | ------ | -------------------------------------------- | ----------------- |
| `moduleName.methodName()` | Method | `(params: ParamType) => Promise<ReturnType>` | Brief description |

**Import:** `import { methodName } from '@wix/sdk-module';`

Also include any gotchas or constraints discovered.
```

**Do NOT proceed to Step 4 until this sub-agent completes.**

#### Discovery Search Reference (SDK only)

| Extension Type  | SDK Search                                |
| --------------- | ----------------------------------------- |
| Dashboard Page  | "Wix Data API", "dashboard SDK"           |
| Dashboard Modal | "dashboard openModal closeModal"          |
| Site Widget     | "Wix Data API", "site-window viewMode"    |
| Site Plugin     | "Wix Stores API", "Wix Bookings API"      |
| Embedded Script | "embeddedScripts API"                     |
| Service Plugin  | Specific SPI (e.g., "shipping rates SPI") |

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
3. The SDK context from the discovery sub-agent
4. Instruction to invoke the `wds-docs` skill only when needed (e.g. when looking up WDS component props or examples)

**Implementation sub-agent prompt MUST include:**

1. ✅ The skill to load (full path or name)
2. ✅ The user's original requirements (copy verbatim)
3. ✅ SDK methods discovered (with imports and types)
4. ✅ Instruction to invoke `wds-docs` skill only when needed for WDS component props or examples
5. ✅ Any constraints or gotchas discovered
6. ✅ Instruction to write a summary log file

**Implementation sub-agent prompt template:**

```
Load and follow the skill: wix-cli-[skill-name]

User Requirements:
[EXACT user request - copy verbatim]

SDK Context:
[Methods with imports from discovery]

When building UI that requires WDS component lookups (props, examples), invoke the wds-docs skill; otherwise omit.

Constraints:
[Any gotchas or limitations from discovery]

After implementation, write a summary log to: implementation-agent-{hash}.log
Include: files created, features implemented, verification results.

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

**Summary:** Discovery = SDK MCP only. Implementation = load extension skill; invoke `wds-docs` only when needed for WDS lookups. Validation = `wix-cli-app-validation`.

## Complete Workflow Example

User: "Create a survey app with dashboard and site widget" → [DECIDE] Dashboard Page + Site Widget → [DISCOVERY] Spawn sub-agent: "Discover SDK methods (maxResults: 5). Return methods with imports." → [WAIT] → [IMPLEMENT] Spawn two sub-agents (wix-cli-dashboard-page, wix-cli-site-widget) with SDK context; tell them to invoke wds-docs only when they need WDS component lookups → [VALIDATION] wix-cli-app-validation → [REPORT].

## Cost Optimization

- **maxResults: 5** for all MCP SDK searches.
- Discovery: focused API searches; use `ReadFullDocsArticle` only when needed.
- Implementation: pass only relevant SDK context; invoke `wds-docs` only when implementation needs WDS component lookups.
- Parallelize independent sub-agents; reuse discovery when modifying existing extensions.
- Targets: discovery output 500-1000 tokens; implementation prompt minimal; each search under 2000-3000 tokens.

## Documentation

For detailed documentation on all extension types, see [references/DOCUMENTATION.md](references/DOCUMENTATION.md).
