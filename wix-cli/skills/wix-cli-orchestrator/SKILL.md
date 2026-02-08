---
name: wix-cli-orchestrator
description: "BLOCKING REQUIREMENT - When user requests to add/build/create/implement ANY feature or component for a Wix CLI app, you MUST invoke this skill IMMEDIATELY as your absolute FIRST action - when exploring, reading files, BEFORE launching any agents - make sure this skill is loaded. Trigger on add, build, create, I want, implement, help me where X is any feature/component. Non-negotiable - invoke immediately upon recognizing a Wix feature build request."
compatibility: Requires Wix CLI development environment.
---

# Wix CLI Orchestrator

Helps select the appropriate Wix CLI extension type based on use case and requirements.

## ⚠️ MANDATORY WORKFLOW CHECKLIST ⚠️

**Before reporting completion to the user, ALL boxes MUST be checked:**

- [ ] **Step 1:** Determined extension type(s) needed
  - [ ] Asked clarifying questions if requirements were unclear
  - [ ] Explained recommendation with reasoning
- [ ] **Step 2:** Checked references, spawned discovery if needed
  - [ ] Checked relevant reference files for required APIs
  - [ ] Spawned discovery only if API not found in references
  - [ ] Skip if all APIs are in reference files or no external APIs needed
- [ ] **Step 3:** Waited for discovery sub-agent to complete (if spawned)
  - [ ] Received SDK methods with imports
- [ ] **Step 4:** Spawned implementation sub-agent(s) with skill context
  - [ ] Included user requirements in prompt
  - [ ] Included SDK context from discovery (if any)
  - [ ] Instructed sub-agent to invoke `wds-docs` skill FIRST when using @wix/design-system (for correct imports, especially icons)
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

You are a **decision-maker and orchestrator**, not an implementer. **Decide → Check References → Discovery (if needed) → Implementation Sub-Agent(s) → Validation.** Ask clarifying questions if unclear; recommend extension type; check reference files first, spawn discovery only for missing APIs; spawn implementation sub-agents; run validation.

---

## ❌ ANTI-PATTERNS (DO NOT DO)

| ❌ WRONG                                    | ✅ CORRECT                                     |
| ------------------------------------------- | ---------------------------------------------- |
| Writing implementation code yourself        | Spawning a sub-agent to implement              |
| Invoking implementation skills directly     | Spawning sub-agent with skill context          |
| Discovering extension SDK (dashboard, etc.) | Extension SDK is in skill reference files      |
| Spawning discovery without checking refs    | Check skill refs first                         |
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
   - Data storage / CMS collections → Data Collection
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
- **Backend:** During business flow (checkout/shipping/tax)? → Service Plugin. After event (webhooks/sync)? → Event Extension. Custom HTTP endpoints? → Backend Endpoints. Need CMS collections for app data? → Data Collection.
- **Site:** User places anywhere? → Site Widget. Fixed slot on Wix app page? → Site Plugin. Scripts/analytics only? → Embedded Script.

## Quick Reference Table

| Extension Type        | Category  | Visibility  | Use When                      | Skill                     |
| --------------------- | --------- | ----------- | ----------------------------- | ------------------------- |
| Dashboard Page        | Dashboard | Admin only  | Full admin pages              | `wix-cli-dashboard-page`   |
| Dashboard Modal       | Dashboard | Admin only  | Popup dialogs                 | `wix-cli-dashboard-modal` |
| Dashboard Plugin      | Dashboard | Admin only  | Extend Wix app dashboards     | (none yet)                |
| Dashboard Menu Plugin | Dashboard | Admin only  | Add menu items                | (none yet)                |
| Service Plugin        | Backend   | Server-side | Customize business flows      | `wix-cli-service-plugin`   |
| Event Extension       | Backend   | Server-side | React to events               | `wix-cli-backend-event`   |
| Backend Endpoints     | Backend   | API         | Custom HTTP handlers          | `wix-cli-backend-api`     |
| Data Collection       | Backend   | Data        | CMS collections for app data  | `wix-cli-data-collection` |
| Site Widget           | Site      | Public      | Standalone widgets            | `wix-cli-site-widget`     |
| Site Plugin           | Site      | Public      | Extend Wix business solutions | `wix-cli-site-plugin`     |
| Embedded Script       | Site      | Public      | Inject scripts/analytics      | `wix-cli-embedded-script` |

**Key constraint:** Dashboard Page cannot use `<Modal />`; use a separate Dashboard Modal and `dashboard.openModal()`. Site plugins (CLI) not supported on checkout; use Wix Blocks.

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

### Step 3: Check References, Then Discover (if needed)

**Workflow: References first, search only for gaps.**

1. **Identify required APIs** from user requirements
2. **Check relevant reference files:**
   - Backend events → `wix-cli-backend-event/references/COMMON-EVENTS.md`
   - Wix Data → `wix-cli-dashboard-page/references/WIX_DATA.md`
   - Dashboard SDK → `wix-cli-dashboard-page/references/DASHBOARD_API.md`
   - Service Plugin SPIs → `wix-cli-service-plugin/references/*.md`
3. **Verify the specific method/event exists** in references
4. **ONLY spawn discovery if NOT found** in reference files

**Platform APIs (never discover - in references):**
- Wix Data, Dashboard SDK, Event SDK (common events), Service Plugin SPIs

**Vertical APIs (discover if needed):**
- Wix Stores, Wix Bookings, Wix Members, Wix Pricing Plans, third-party integrations

**Decision table:**

| User Requirement                     | Check References / Discovery Needed? | Reason / Reference File                             |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------- |
| "Display store products"             | ✅ YES (Spawn discovery)             | Wix Stores API not in reference files               |
| "Show booking calendar"              | ✅ YES (Spawn discovery)             | Wix Bookings API not in reference files             |
| "Send emails to users"               | ✅ YES (Spawn discovery)             | Wix Triggered Emails not in reference files         |
| "Get member info"                    | ✅ YES (Spawn discovery)             | Wix Members API not in reference files              |
| "Listen for cart events"             | Check `COMMON-EVENTS.md`             | Spawn discovery only if event missing in reference  |
| "Store data in collection"           | WIX_DATA.md ✅ Found                 | ❌ Skip discovery (covered by `WIX_DATA.md`)        |
| "Create CMS collections for my app"  | Reference: `wix-cli-data-collection` | ❌ Skip discovery (covered by dedicated skill)       |
| "Show dashboard toast"               | DASHBOARD_API.md ✅ Found            | ❌ Skip discovery                                   |
| "Show toast / navigate"              | DASHBOARD_API.md ✅ Found            | ❌ Skip discovery                                   |
| "UI only (forms, inputs)"            | N/A (no external API)                | ❌ Skip discovery                                   |
| "Settings page with form inputs"     | N/A (UI only, no external API)       | ❌ Skip discovery                                   |
| "Dashboard page with local state"    | N/A (no external API)                | ❌ Skip discovery                                   |

**MCP Tools the sub-agent should use:**

- `mcp__wix-mcp-remote__SearchWixSDKDocumentation` - SDK methods and APIs (**Always use maxResults: 5**)
- `mcp__wix-mcp-remote__ReadFullDocsArticle` - Full documentation when needed (only if search results need more detail)

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
```

**If discovery is spawned, wait for it to complete before proceeding to Step 4.**

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
3. ✅ SDK methods discovered (with imports and types) — **only if discovery was performed**
4. ✅ Instruction to invoke `wds-docs` skill FIRST when using @wix/design-system (critical for correct imports, especially icons)
5. ✅ Any constraints or gotchas discovered

**Implementation sub-agent prompt template:**

```
Load and follow the skill: wix-cli-[skill-name]

User Requirements:
[EXACT user request - copy verbatim]

[ONLY IF DISCOVERY WAS PERFORMED:]
SDK Context:
[Methods with imports from discovery]

Constraints:
[Any gotchas or limitations from discovery]

⚠️ MANDATORY when using WDS: Before using @wix/design-system components, invoke the wds-docs skill FIRST to get correct imports (icons are from @wix/wix-ui-icons-common, NOT @wix/design-system/icons).
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
| Data Collection + Dashboard Page | ✅ YES    | Data schema vs UI                   |
| Data Collection + Backend API    | ✅ YES    | Data schema vs HTTP handlers        |
| Data Collection + Site Widget    | ✅ YES    | Data schema vs site UI              |

**Sequential execution required:**

- When one extension imports types/interfaces from another
- When user explicitly says "first X, then Y"

**Extension Type to Skill Mapping:** See [Quick Reference Table](#quick-reference-table) above.

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

**Summary:** Discovery = business domain SDK only (Stores, Bookings, etc.) — skip for extension SDK and data collections. Implementation = load extension skill; invoke `wds-docs` FIRST when using WDS (for correct imports). Validation = `wix-cli-app-validation`.

## Cost Optimization

- **Check references first** — read relevant reference files before spawning discovery
- **Skip discovery** when all required APIs are in reference files
- **maxResults: 5** for all MCP SDK searches
- **ReadFullDocsArticle** only when search results need more context
- **Implementation prompts:** include only relevant SDK context from discovery (if performed)
- **Parallelize** independent sub-agents when possible
- **Invoke wds-docs** first when using WDS (prevents import errors)
- **Targets:** discovery output 500-1000 tokens; implementation prompt minimal; each search under 2000-3000 tokens

## Documentation

For detailed documentation on all extension types, see [references/DOCUMENTATION.md](references/DOCUMENTATION.md).
