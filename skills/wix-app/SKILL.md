---
name: wix-app
description: "Build and review Wix CLI app extensions — dashboard pages, modals, plugins, menu plugins, custom element widgets, Editor React components, site plugins, embedded scripts, backend APIs, backend events, service plugins, data collections, and App Market readiness. Use when building ANY feature or extension for a Wix CLI app or preparing a Wix app for App Market review. Triggers on: add, build, create, implement, help me, dashboard, widget, plugin, backend, API, event, collection, embedded script, service plugin, Editor React component, checkout, shipping, tax, discount, SPI, CMS, schema, tracking, popup, admin panel, menu item, modal, validate, test, verify, register extension, App Market, app review, submission readiness."
compatibility: requires `@wix/cli` >= 1.1.192.
---

# Wix App Builder

Helps build extensions for Wix CLI applications. Covers all extension types: dashboard pages, modals, plugins, menu plugins, custom element widgets, Editor React components, site plugins, embedded scripts, backend APIs, events, service plugins, and data collections.

**Scaffolding is owned by the Wix CLI.** Use `wix generate --params` for every supported type. It generates files and, where applicable, builder boilerplate, UUIDs, and `src/extensions.ts` registration. HTTP endpoints are discovered from files and need no registration. This skill provides the decision logic, API guidance, configuration semantics, and business-logic patterns that fill in the generated stubs.

## ⚠️ MANDATORY WORKFLOW CHECKLIST ⚠️

**Before reporting completion to the user, ALL boxes MUST be checked:**

- [ ] **Step 1:** Determined extension type(s) needed
  - [ ] Asked clarifying questions if requirements were unclear
  - [ ] **🛑 SDK-First Gate (MANDATORY before any Data Collection):** Confirmed the data is NOT owned by an existing Wix app — if it is, use its SDK module, never CMS (see [SDK-First Rule](#sdk-first-rule-existing-wix-app-data-is-never-cms))
  - [ ] Checked for implicit Data Collection need — unless user provided a collection ID directly (see [Data Collection Inference](#data-collection-inference))
  - [ ] Obtained app namespace if Data Collection extension is being created
  - [ ] Determined full scoped collection IDs if Data Collection extension is being created (see [Collection ID Coordination](#collection-id-coordination))
  - [ ] Explained recommendation with reasoning
- [ ] **Step 2:** Read extension reference file(s) for the chosen type(s) and the project-wide [CODE_QUALITY.md](references/CODE_QUALITY.md)
  - [ ] **Dashboard page UI:** Translated the prompt into a workflow before choosing components — what the user must understand, focus on, investigate, act on, and see confirmed. See [UX Success Model](references/dashboard-page/UX_SUCCESS_MODEL.md), and the installed package's own `Collection Toolkit.md` guide for which component serves each need ([The Discovery Chain](references/WIX_PATTERNS_DOCS.md#the-discovery-chain)).
    - [ ] **No `SummaryBar` unless the request asked for one** — a named total, count, or "how many / how much" figure in the prompt. Not "the page seems like it wants one": an uninvited bar pushes the rows down and puts a number on screen nobody asked to be right about. When the request did ask, the number has to come from something that counts ([QUERY_AND_PAGING.md](references/dashboard-page/QUERY_AND_PAGING.md#what-fetchtotal-is-allowed-to-call)) and be read through `useSelector`, because the state is MobX ([TABLE_STATE.md](references/dashboard-page/TABLE_STATE.md#reading-state-outside-the-table-it-is-mobx)).
    - [ ] **A row the user can open, as a page — editable by default** — `navigateToEntityPage` to an `EntityPage` with a working form and save, for CMS and vertical SDK data alike; the three read-only cases are in [DRAFT_TEMPLATE.md](references/dashboard-page/DRAFT_TEMPLATE.md#2-choose-then-read-the-chosen-templates-page). Unless the prompt is explicitly a report or an export. **Never a `SidePanel`**: in Cairo that hosts a page's own panels.
    - [ ] **Every filter reaches the query**: declared in the collection hook's `filters` and read inside `fetchData`. Filter UI that never narrows the rows is a defect that looks like a feature.

    A filtered table with no drill-in and no working filters is what gets built when nobody states the requirement — the most common way a generated dashboard disappoints. The aggregate is the judgment call; the drill-in and the filters are not.
  - [ ] **🛑 Template-First Gate (MANDATORY, dashboard UI only, comes before writing any shell/provider/router):** Followed [DRAFT_TEMPLATE.md](references/dashboard-page/DRAFT_TEMPLATE.md): found the page templates the installed `@wix/patterns` ships, chose one with its `Page Templates.md` guide — which pages the workflow above needs, **and where the rows come from** (your own fetch, or a CMS collection) — read that template's page, and copied every file in its `templateFiles`. Composing the page shell, provider nesting, or router wiring from scratch when a template already shows it is the failure mode this gate exists to prevent — the Patterns/Component Docs gates below are for what the template doesn't cover, not a replacement for starting there. The reverse holds too: a template replaces composing the shell, never the discovery chain, so every symbol it doesn't show still goes through the next gate.
  - [ ] **🛑 Patterns Docs Gate (MANDATORY for any dashboard page UI):** Read [WIX_PATTERNS_DOCS.md](references/WIX_PATTERNS_DOCS.md) **before the first command that touches `node_modules/@wix/patterns`** — its discovery chain (`pkg-root.cjs`, the index, `Composition and Providers.md` once, `Collection Toolkit.md` for which component serves a need) lives only in that file, and this line is a summary of its step 1, not a substitute for opening it. Then **probe** `dist/docs/index.json` with `grep`/`python3` — never a whole-file `Read`, which truncates it silently. It is the one file that says, per symbol, where to import it from (`importPath`), whether its props live in the doc or in a `.d.ts` (`bundle`), and which worked examples exist (`examples`). Upgrade `@wix/patterns` if that file is missing. Patterns API facts come only from the published `dist/docs/` (pages), `dist/examples/` (worked calls), `dist/dts-bundle/` (types) and `dist/templates/` (whole pages) trees — never from `src/`, `dist/esm/`, or any other path inside the package, with one named exception: `dist/types/` when a bundle has stubbed the prop you need (WIX_PATTERNS_DOCS.md step 5).
  - [ ] **🛑 Component Docs Gate (MANDATORY, dashboard UI only):** For each patterns symbol you are about to write, decided **from the index** which single artifact answers the question you actually have — `importPath`, `examples`, or `bundle` — and read only that one, per [Component Selection Order](#component-selection-order)'s "the short version". State which artifact you read per symbol, and why, before the first line of JSX. Reading a doc *and* its bundle for the same symbol, or opening a page for an `importPath` the index already gave you, is the failure this gate exists to prevent.

    For the object `useTableCollection()` returns, read [TABLE_STATE.md](references/dashboard-page/TABLE_STATE.md) — a state object you receive rather than construct, whose members are unobvious and several plausible ones absent.
- [ ] **Step 3:** Checked API references; used MCP discovery only for gaps
  - [ ] **Dashboard page over Wix data:** located the method and verified every mapped field against the installed SDK's own declaration first — see [DATA_SOURCES.md](references/dashboard-page/DATA_SOURCES.md), and [QUERY_AND_PAGING.md](references/dashboard-page/QUERY_AND_PAGING.md) before writing `fetchData`. A field marked `@deprecated` still compiles and renders something plausible and wrong.
  - [ ] **Vertical SDK prerequisites — for every `@wix/*` vertical the page touches, including one added later:** confirmed the package is actually a dependency (installed it if not), and noted the Dev Center permission scope the read needs — a missing scope produces a page that builds, mounts and shows nothing. Both in [DATA_SOURCES.md](references/dashboard-page/DATA_SOURCES.md#two-things-to-settle-before-you-write-the-page); the scope goes under [Manual Steps Required](#-manual-steps-required). **A second vertical added during Step 4b needs this check too, and its failure must not take down the page** — see [A second vertical is a second scope](references/dashboard-page/DATA_SOURCES.md#a-second-vertical-is-a-second-scope).
  - [ ] **Modelled the call on the SDK, not the REST page:** namespace name, `_id` vs `id`, no `ReturnType` on overloaded methods, no `hasNext` on `PagingMetadataV2` — see [The SDK is not the REST API](references/dashboard-page/DATA_SOURCES.md#the-sdk-is-not-the-rest-api).
  - [ ] Site/editor extensions only: kept SDK calls in the extension by default, routing out only business-wide methods a visitor genuinely cannot call (see [Identity and Elevation Requirement](#identity-and-elevation-requirement))
- [ ] **Step 4a:** Scaffolded each CLI-supported extension via `wix generate --params`
- [ ] **Step 4b:** Filled in business logic in the generated files
  - [ ] **Compile as you go:** ran `npx tsc --noEmit` after the first file that imports `@wix/patterns`, not only at Step 5. Patterns' state and filter APIs are the most common source of errors, and finding twenty of them in one batch after the page is written costs far more than finding two early.
  - [ ] **🛑 Component Selection Gate (MANDATORY, dashboard UI only):** For every UI element on a Dashboard Page, resolved it against `@wix/patterns` BEFORE reaching for `@wix/design-system` — and never hand-rolled a component either library already provides. See [Component Selection Order](#component-selection-order).
  - [ ] Invoked `wix-design-system` skill ONLY before editing the first `.tsx`/`.jsx` file that imports `@wix/design-system`. Skip for backend-only or data-only extensions.
  - [ ] WDS: the design-system stylesheets are imported in exactly one place per app — `BusinessManagerTheme.tsx` for a dashboard surface (see the next item), or the main component entry file for a site/editor extension. Never in child, tab or helper files, and never twice.
  - [ ] **🛑 Business Manager theme (every dashboard surface — page, modal AND plugin):** wrote `BusinessManagerTheme.tsx` once (both stylesheets, including `themes/odeditor.global.css`, plus `WixDesignSystemProvider` → `WixDesignSystemIconThemeProvider` → `IconThemeProvider theme="odeditor"` → `WixDesignSystemDefaultPropsProvider`), and wrapped **each** extension's root in it — above `WixPatternsProvider` and above `CustomModalLayout`. Every extension is a separate iframe that inherits none of the redesign, so theming the page does nothing for a modal it opens or a plugin in a slot; each one needs its own wrapper. Also: every icon from `@wix/wix-ui-icons-common/lazy`, and `--wds-*` tokens or `skin`/`size` props rather than hardcoded colours, font sizes or inline `style` ([BUSINESS_MANAGER_TOKENS.md](references/BUSINESS_MANAGER_TOKENS.md) — note the theme rebases the `SP*` spacing unit from 6px to 4px). `tsc`, `wix build` and `wix preview` all pass on an unthemed surface — only looking at it catches this. See [BUSINESS_MANAGER_THEME.md](references/BUSINESS_MANAGER_THEME.md).
- [ ] **Step 4c (dashboard page UI only):** Re-opened and read the page file(s) just written — not recalled intent — and confirmed against the actual code: no `SummaryBar` unless the request asked for one, a routed drill-in (`navigateToEntityPage`) for every row and no `SidePanel` used as one, every declared filter name also appearing inside `fetchData`, and — for every template with a router — the entry file both passes and guards `location`. See [UX Completeness Self-Audit](#step-4c-ux-completeness-self-audit).
- [ ] **Step 5:** Ran validation (see [Validation](#validation))
  - [ ] Dependencies installed
  - [ ] TypeScript compiled
  - [ ] Build succeeded
  - [ ] Preview deployed
- [ ] **Step 6:** Collected and presented ALL manual action items to user

**🛑 STOP:** If any box is unchecked, do NOT proceed to the next step.

---

## Quick Decision Helper

1. **What are you trying to build?**
   - Admin interface → Dashboard Extensions
   - Backend logic → Backend Extensions
   - Data storage / CMS collections → Data Collection (app-owned data only — see [SDK-First Rule](#sdk-first-rule-existing-wix-app-data-is-never-cms))
   - Editor React component → Site Extensions (app projects only)

2. **Who will see it?**
   - Admin users only → Dashboard Extensions
   - Site visitors → Site Extensions
   - Server-side only → Backend Extensions

3. **Where will it appear?**
   - Dashboard sidebar/page →
     - Full admin screen: Dashboard Page — UI built with `@wix/patterns` + `@wix/design-system` (see [Component Selection Order](#component-selection-order)). **Cannot use `<Modal />`** — use a separate Dashboard Modal extension and `dashboard.openModal()` instead.
     - Popup/form: Dashboard Modal
   - Existing Wix app dashboard (widget) → Dashboard Plugin
   - Existing Wix app dashboard (menu item, more-actions/bulk-actions menu) → Dashboard Menu Plugin
   - Anywhere on site, standalone → custom element widget
   - Anywhere on site, with editor manifest (styling/content/elements) → Editor React component
   - Fixed slot on a Wix business solution page → Site Plugin
   - Scripts/analytics only, no UI → Embedded Script
   - During business flow (checkout/shipping/tax) → Service Plugin
   - Exposing tools to the Wix AI assistant → App Tools (requires both `APP_TOOLS` declaration + `TOOLS_PROVIDER_CONFIG` handler — see [APP_TOOLS.md](references/APP_TOOLS.md))
   - After event occurs (webhooks/sync) → Backend Event Extension
   - Custom HTTP endpoint → Backend API

---

## Component Selection Order

**For the page shell, provider nesting, and routing — the part every dashboard page needs — start from [DRAFT_TEMPLATE.md](references/dashboard-page/DRAFT_TEMPLATE.md), not this section.** It finds the page templates the installed `@wix/patterns` ships (read-only list, list with create/edit, settings only, and a CMS collection on its schema); copy the one the request matches and adapt it. What follows here is for individual UI elements the template doesn't already show — a filter type, a column renderer, a component the request needs that isn't in it.

Dashboard pages at Wix are built from two libraries. For **every** UI element not already covered by the template, resolve in this order and stop at the first hit. Never skip a step, and never decide a component is missing from memory — check.

### 1. `@wix/patterns` — page structure and data collections

Patterns owns the page shell and everything collection-shaped: page shells and their header /
content / footer sub-parts, tables and grids and the switch between them, folder views,
collection state (paging, sorting, selection, loading), filters, search, view presets, row and
bulk actions, drag-and-drop, in-extension routing, the overlays tied to a collection, and the
add / edit / view page for one listed item. If you need one of those, it is patterns' — look it
up rather than assembling it from WDS parts.

**Which component serves a given need is the library's own answer, not this skill's.** It ships
that answer as guides inside the installed package, with every component name in them checked
against the real package at build time. Walk them: [The Discovery Chain](references/WIX_PATTERNS_DOCS.md#the-discovery-chain).

Whole pages are the package's too: the router wiring for a multi-page extension, and a
**collection whose fields the CMS owns** — `useCmsSchemaSource` from `@wix/patterns-cms`, with
`@wix/patterns/schema`, where the schema supplies fetch, filters, columns and the form — both ship
as page templates. See [DRAFT_TEMPLATE.md](references/dashboard-page/DRAFT_TEMPLATE.md).

The short version — probe `<pkgRoot>/dist/docs/index.json` first (`grep`/`python3`, not a
whole-file `Read`), then the guides it lists. From
there the index answers per symbol: `importPath` is the import line (no read needed), `examples`
names the worked call, and `bundle` says whether props live in a `.d.ts` or in the doc's own
table. Read the one artifact your open question needs. Resolve `<pkgRoot>` once per session
([Prerequisites](references/WIX_PATTERNS_DOCS.md#prerequisites)) and reuse it.

**Opening one item from a collection uses an editable `EntityPage` by default; create/edit flows also use `EntityPage`, never a dashboard modal** — see
[Entity create and edit](#entity-create-and-edit), and `Collection to Entity Flow.md` in the
package for the flow itself.

**Falling through to step 2 because a lookup was inconvenient is the single most common way a
dashboard page ends up built entirely from WDS.** A missing index means the lookup has not
happened yet, not that patterns lacks the component.

### 2. `@wix/design-system` — everything inside the shell

The leaf-level UI patterns does not own: inputs, buttons, form fields, text, layout primitives, cards, badges, tooltips, toasts, icons. Pick the component by lookup, not recall — invoke the **`wix-design-system` skill**, whose bundled helper reads the installed package:

```bash
node <wix-design-system-skill-dir>/scripts/wds.cjs search <keyword>
node <wix-design-system-skill-dir>/scripts/wds.cjs component <Name>
```

**If that skill is not installed** — it is a separate skill, and some hosts ship `wix-app` without
it — do **not** fall through to writing WDS from memory, and do not treat the missing skill as
permission to hand-roll the component. Read the installed package instead, which is where the skill
would have read from anyway:

```bash
ls node_modules/@wix/design-system/dist/types/            # the component inventory
cat node_modules/@wix/design-system/dist/types/<Name>/<Name>.d.ts   # its real props
```

Name the file you read before using the component, exactly as the Component Docs Gate requires for
patterns. A missing skill lowers the convenience, not the bar.

### 3. Custom React — only after both came back empty

Compose from WDS layout primitives (`Box`, `Card`, `Text`). Do not add a third UI dependency, and do not restyle patterns or WDS internals.

### Overlaps and scope

- When both libraries ship the same concept (page header, page container), the **patterns** one wins inside a patterns page — it is the piece wired into the shell's layout and collection state. Use the WDS equivalent only outside a patterns page shell.
- **Patterns has its own overlays.** `PickerModal` / `usePickerModal` and `bulkActionModal` cover collection-related overlays. "It's a modal" is not a reason to leave patterns.
- **Dashboard Plugins** render outside a patterns page shell, so WDS is the default there. Patterns collection components still apply when such a surface displays a data collection.

### Entity create and edit

**Opening a record listed by a collection page uses an editable `EntityPage` by default, whether the records come from CMS or a vertical SDK.** A request for a table or list is enough; the user does not need to ask for editing separately. The three read-only cases are in [DRAFT_TEMPLATE.md](references/dashboard-page/DRAFT_TEMPLATE.md#2-choose-then-read-the-chosen-templates-page); a read-only detail page still opens as a route, never a Dashboard Modal or side panel.

**Any create or edit form for a listed record is an `EntityPage`, not a Dashboard Modal.** A create / "add new" form is included: it writes the record, so it is an `EntityPage` even though nothing is being edited yet. "It's a simple data-entry dialog, not an entity edit" is the wrong reading of this rule.

A page that lists nothing — a settings page, an embedded-script config page — carries no `EntityPage` obligation. But "I built the list without `@wix/patterns`" is not an exception: a page that lists records should be a `CollectionPage`.

This is the most common place the selection order gets dropped: the collection gets built correctly with patterns, then the "add item" flow is hand-built as a WDS form in a modal.

The documented flow:

1. From the collection page's action cell or primary action, call `navigateToEntityPage({ path, entity })` from `usePatternsNavigate()`. (The patterns docs give this exact use case — "navigate to an entity page on an action cell click on a collection page" — and it renders the entity header immediately, before the fetch resolves.) On the **create** route there is no record to pass: omit `entity` and read the **Create route** section of `<pkgRoot>/dist/docs/useEntityPage.md`, which is what the whole "add new" flow turns on.
2. Register the route with `PatternsReactRoute` inside `PatternsReactRouter`.
3. Follow the selected template's entity hook: for SDK/API data, `useEntityPage({ fetch, onSave })` owns fetching, saving, validation, dirty state, loading skeletons, and error states; for CMS, the schema variant derives reads and writes from the source. Form state comes from `@wix/patterns/form`. Use the chosen template's documented signature, and wire saves to the real source rather than local state or a no-op.
4. Compose the body from `EntityPage.Header`, `EntityPage.MainContent`, `EntityPage.AdditionalContent`, and `EntityPage.Card`. **WDS goes inside those cards** — `FormField`, `Input`, `Text` for the individual fields.

Use a Dashboard Modal for dialogs that neither write nor display a listed record: a delete or discard confirmation, an unsaved-changes prompt, an informational notice, or any dialog on a page that lists nothing. Dialog size and field count are not exceptions — a one-field create form over a listed record is still an `EntityPage`. Reach for a modal because the interaction persists nothing, never because "the form should open in a modal."

---

## Extension Types Reference Table

| Extension Type | Category | `extensionType` (for `wix generate --params`) | Reference File |
| --- | --- | --- | --- |
| Dashboard Page | Dashboard | `DASHBOARD_PAGE` | [DASHBOARD_PAGE.md](references/DASHBOARD_PAGE.md) |
| Dashboard Modal | Dashboard | `DASHBOARD_MODAL` | [DASHBOARD_MODAL.md](references/DASHBOARD_MODAL.md) |
| Dashboard Plugin | Dashboard | `DASHBOARD_PLUGIN` | [DASHBOARD_PLUGIN.md](references/DASHBOARD_PLUGIN.md) |
| Dashboard Menu Plugin | Dashboard | `DASHBOARD_MENU_PLUGIN` | [DASHBOARD_MENU_PLUGIN.md](references/DASHBOARD_MENU_PLUGIN.md) |
| Service Plugin | Backend | `SERVICE_PLUGIN` | [SERVICE_PLUGIN.md](references/SERVICE_PLUGIN.md) |
| App Tools (AI assistant tools) | Backend | `APP_TOOLS`, then `SERVICE_PLUGIN` with `pluginType: TOOLS_PROVIDER_CONFIG` | [APP_TOOLS.md](references/APP_TOOLS.md) |
| Backend Event Extension | Backend | `EVENT` | [BACKEND_EVENT.md](references/BACKEND_EVENT.md) |
| Backend API (HTTP endpoint) | Backend | `HTTP_ENDPOINT` | [BACKEND_API.md](references/BACKEND_API.md) |
| Data Collection | Backend | `DATA_COLLECTION` | [DATA_COLLECTION.md](references/DATA_COLLECTION.md) |
| Editor React component | Site | `EDITOR_REACT_COMPONENT` | [EDITOR_REACT_COMPONENT.md](references/EDITOR_REACT_COMPONENT.md) |
| Custom element widget | Site | `CUSTOM_ELEMENT` | [CUSTOM_ELEMENT_WIDGET.md](references/CUSTOM_ELEMENT_WIDGET.md) |
| Site Plugin | Site | `SITE_PLUGIN` | [SITE_PLUGIN.md](references/SITE_PLUGIN.md) |
| Embedded Script | Site | `EMBEDDED_SCRIPT` | [EMBEDDED_SCRIPT.md](references/EMBEDDED_SCRIPT.md) |

**Key constraints:**
- Dashboard Page cannot use `<Modal />`; use a separate Dashboard Modal and `dashboard.openModal()`.

> **HTTP endpoints:** Generate with `extensionType: "HTTP_ENDPOINT"` (not `BACKEND_API`). See [BACKEND_API.md](references/BACKEND_API.md) for project-specific directories, handler types, and frontend URLs.

## Cross-Cutting References

| Topic | Reference |
| --- | --- |
| Code Quality Requirements (applies to all generated code) | [CODE_QUALITY.md](references/CODE_QUALITY.md) |
| Extension Registration | [EXTENSION_REGISTRATION.md](references/EXTENSION_REGISTRATION.md) |
| App Validation | [APP_VALIDATION.md](references/APP_VALIDATION.md) |
| App Market Review | [APP_MARKET_REVIEW.md](references/APP_MARKET_REVIEW.md) |
| App Identifiers (Namespace, Code ID) | [APP_IDENTIFIERS.md](references/APP_IDENTIFIERS.md) |
| Wix Stores Versioning (V1/V3) | [STORES_VERSIONING.md](references/STORES_VERSIONING.md) |
| Official Documentation Links | [DOCUMENTATION.md](references/DOCUMENTATION.md) |
| Wix Patterns Dashboard Pages | [WIX_PATTERNS_DOCS.md](references/WIX_PATTERNS_DOCS.md) |
| Business Manager theme — the wrapper every dashboard page, modal and plugin needs | [BUSINESS_MANAGER_THEME.md](references/BUSINESS_MANAGER_THEME.md) |
| Business Manager tokens — `--wds-*` replacements, the rebased spacing unit, per-component adjustments | [BUSINESS_MANAGER_TOKENS.md](references/BUSINESS_MANAGER_TOKENS.md) |
| Dashboard UX Success Model (what a good dashboard contains) | [UX_SUCCESS_MODEL.md](references/dashboard-page/UX_SUCCESS_MODEL.md) |
| Draft template — start here for any dashboard page: finding, copying and adapting the package's page templates | [DRAFT_TEMPLATE.md](references/dashboard-page/DRAFT_TEMPLATE.md) |
| The state object `useTableCollection()` returns | [TABLE_STATE.md](references/dashboard-page/TABLE_STATE.md) |
| Finding the SDK method and field names behind a page | [DATA_SOURCES.md](references/dashboard-page/DATA_SOURCES.md) |
| Filter paths, WQL operators and cursor paging | [QUERY_AND_PAGING.md](references/dashboard-page/QUERY_AND_PAGING.md) |

---

## SDK-First Rule (Existing Wix App Data Is Never CMS)

**CRITICAL:** Data owned by an existing Wix business app is read and written through that app's SDK module — NEVER modeled as a new CMS Data Collection. A custom collection for such data starts empty and stays disconnected from the real records (e.g., a "refunds dashboard" built on CMS shows an empty state while refunded orders exist in Wix eCommerce).

Find the entity the user mentioned in the [entity → SDK module map](references/SDK_MODULE_MAP.md) and use that package. If the entity isn't listed or you're unsure, run `SearchWixSDKDocumentation` for it — **never conclude CMS with zero MCP calls**. CMS is only for data your app itself introduces (configuration, rules, app-specific records) that no Wix app manages.

**SDK types:** access them through the namespace you import, as `<namespace>.<TypeName>`, using any type name shown in the docs — never import a type by name from the `@wix/<pkg>` root.

```ts
import { orders } from '@wix/ecom';
const rows: orders.Order[] = [];              // ✅
// import type { Order } from '@wix/ecom';    // ❌ has no exported member 'Order'
```

---

## Data Collection Inference

**CRITICAL:** Data collections are often needed implicitly — don't wait for the user to explicitly say "create a CMS collection." Infer the need automatically.

**⚠️ Apply the [SDK-First Rule](#sdk-first-rule-existing-wix-app-data-is-never-cms) first** — the indicators below only apply to data your app itself owns, not to entities a Wix app already manages.

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

1. **Read the Stores Versioning reference** — see [STORES_VERSIONING.md](references/STORES_VERSIONING.md). It contains the module map, permissions cheatsheet, copy-paste dual-catalog recipes (list/get/create/update/delete products, inventory, categories), the V1→V3 field map, webhook mapping, and the major V3 gotchas. **Use it before searching SDK docs** — it covers the common 80%.
2. **All Stores operations must check catalog version first** using `getCatalogVersion()`
3. **Use the correct module** based on version: `productsV3` (V3) vs `products` (V1)
4. **Apps MUST support both V1 and V3** — single-version apps cannot list in the App Market and break on new sites
5. **Request both V1 and V3 permission scopes** for every Stores operation

This is non-negotiable — V1 and V3 are NOT backwards compatible.

---

## Identity and Elevation Requirement

**Applies whenever an extension calls a Wix SDK method.** Decide where the call runs before writing it.

Who the extension runs as decides everything below — the Category column in [Extension Types Reference Table](#extension-types-reference-table) tells you which one you have:

- **Site and editor extensions** — custom element widgets, site plugins, Editor React components, embedded scripts — run as the site visitor or member, never as the app.
- **Dashboard extensions** run as the Wix user — not as a site visitor, and not as the app.
- **Backend extensions** — Backend API, Backend Event, Service Plugin — run as the app.

**`auth.elevate` works only in backend code.** In a site, editor, or dashboard extension it doesn't work at all.

**Default: call the SDK directly from the extension.** Routing a call that didn't need it is not a harmless extra hop — it is how working features break. Sort by who the call acts for, never by its scope name:

- **Acts for the current visitor or member** — their cart, checkout, booking, order, reservation, or profile: `currentCartV2.*`, `cartV2.placeOrder`, `bookings.createBooking`, `members.getMyMember`, and anything else operating on "my" or "the current" entity. These resolve the actor from the caller's session, so elevating runs them as the app and detaches the result from the person who asked — an order with no buyer, a booking with no attendee.
- **The platform filters the result by caller** — an elevated call returns what the direct call withheld, so a "fix" for a sparse result becomes a leak. Wix Data `items.*` follows the collection's `dataPermissions` (scaffolded default: `itemRead: 'ANYONE'`, writes `'PRIVILEGED'` — fix writes with permissions, not routing; see [DATA_COLLECTION.md](references/DATA_COLLECTION.md)). Catalog reads return base fields to anyone, withholding `MERCHANT_DATA` and non-visible products unless the app holds `SCOPE.STORES.PRODUCT_READ_ADMIN`. `members.getMember`/`queryMembers` withhold `PRIVATE` members from visitor and member callers.

**Route out only when the method acts on the business as a whole**, which a visitor or member genuinely cannot do: `archiveLocation`, `queryLocations`, catalog and inventory writes, `bookings.confirmBooking`, order management. **When the method's docs show the call elevated, route it out and elevate there** — from any host, dashboard included, because `auth.elevate` only works in backend code, so the endpoint is the only place the documented pattern can run.

**When you're unsure, call it directly and let it fail.** A method a site extension may not call returns a permission error you see immediately; a method wrongly routed and elevated *succeeds* and silently returns the wrong data or acts for the wrong person. Some method pages carry a prose note that settles it — `get-my-member`: "This method requires visitor or member authentication." Authoritative when present, but only a minority of pages have one, so its absence decides nothing.

Two signals never settle it: the scope name — `locations.queryLocations` is `SCOPE.DC-MULTILOCATION.READ-LOCATIONS` yet admin-only, while `currentCartV2.addLineItemsToCurrentCart` carries `SCOPE.ECOM.MANAGE-ADMIN` yet is visitor-callable and breaks if elevated — and the SDK schema line's client prefix, which varies by docs channel for the same method, so carries nothing and isn't worth re-deriving.

Routing out means a Backend API endpoint that elevates and is reached with `httpClient.fetchWithAuth()`. Elevation bypasses Wix's permission check, so the endpoint must re-check the caller itself — see [Identity and Authorization](references/BACKEND_API.md#identity-and-authorization) for what each host can actually verify, and why an owner-only operation belongs in a dashboard extension instead.

**Some extensions or SDK calls require a permission scope that `wix generate` doesn't add automatically.** Adding one is a Dev Center account change, not something the agent does — tell the user which scope to add: open their app at `https://manage.wix.com/apps/<appId>/home`, select **Develop > Permissions** in the left menu, then **Add Permissions**, then report it under [Manual Steps Required](#-manual-steps-required). If the app is already installed on a site, the owner must also re-approve it via the install/update flow — revisit that same app page's "Test App" flow (or the release output's install links) and accept "Agree & Update" — before the scope takes effect there.

---

## App Market Review

**Applies when a user wants to submit their app to the Wix App Market, list it publicly, prepare for App Market review, audit decline risk, or fix App Market review feedback.** Not needed for private apps or routine version releases.

Read [APP_MARKET_REVIEW.md](references/APP_MARKET_REVIEW.md) — it contains the full technical checklist, implementation notes with Wix doc links, and the review taxonomy IDs for traceability.

---

## Implementation Workflow

### Step 1: Ask Clarifying Questions (if needed)

Only ask for configuration values when **absolutely necessary** for the implementation to proceed. If a value can be configured later or added as a manual step, don't block on it.

If unclear on approach (placement, visibility, configuration, integration), ask clarifying questions. If the answer could change the extension type, wait for the response before proceeding. Otherwise, proceed with the best-fit extension type.

### Step 2: Make Your Recommendation

Use the Extension Types Reference Table and decision content above. State extension type and brief reasoning (placement, functionality, integration).

### Step 3: Read Extension Reference, Check API References, Then Discover (if needed)

**Workflow: Read extension reference → Check API references → Use MCP only for gaps.**

1. **Read the extension reference file** for the chosen extension type from the table above
2. **Identify required APIs** from user requirements
3. **Check relevant API reference files:**
   - Backend events → `references/backend-event/COMMON-EVENTS.md`
   - Wix Data → `references/data-collection/WIX_DATA.md`
   - Dashboard SDK → `references/dashboard-page/DASHBOARD_API.md`
   - Service Plugin SPIs → read `references/SERVICE_PLUGIN.md` together with the matching `references/service-plugin/<NAME>.md` leaf
   - App Tools (AI assistant tools) → read `references/APP_TOOLS.md`; it links to `references/app-tools/TOOLS.md` (declaration) and `references/service-plugin/TOOLS_PROVIDER.md` (handler)
4. **Verify the specific method/event exists** in references
5. **ONLY use MCP discovery if NOT found** in reference files

**Platform APIs (never discover - in references):**
- Wix Data, Dashboard SDK, Event SDK (common events), Service Plugin SPIs

**Vertical APIs (discover if needed):**
- Wix Stores (**⚠️ MUST use Stores Versioning reference** — V1/V3 catalog check required), Wix eCommerce, Wix Bookings, Wix Members, Wix Pricing Plans, third-party integrations — find the right `@wix/*` package in the [SDK-First Rule](#sdk-first-rule-existing-wix-app-data-is-never-cms) module map first, then discover methods via MCP

**Decision table:**

| User Requirement                     | Check References / Discovery Needed? | Reason / Reference File                             |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------- |
| "Display store products"             | ✅ YES (MCP discovery)               | Wix Stores API — **include Stores Versioning reference** |
| "Dashboard for orders / refunds"     | ✅ YES (MCP discovery)               | Wix eCommerce API (`@wix/ecom`) — **NEVER a CMS collection** |
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
- `ReadFullDocsMethodSchema` - Full type schema for a specific SDK method (parameters, return type, permissions)
- `ReadFullDocsArticle` - Prose guides and conceptual articles only (not for SDK method signatures)

### Step 4a: Scaffold via the CLI

For each supported type, including HTTP endpoints, run `npx wix generate --params '<json>'`. The command returns `{"success":true,"extensionType":"...","newFiles":[...]}` on success.

If the command fails because of unknown or invalid params, run `npx wix schema generate --type <extensionType>` to print the JSON Schema for that extension type, fix the `--params` payload, and retry. Do not fall back to manual scaffolding. The one exception is `HTTP_ENDPOINT` on a CLI older than 1.1.243, which predates the generator but still supports the extension: create the endpoint file by hand as described in [BACKEND_API.md](references/BACKEND_API.md#generate-for-the-project-type).

**What the CLI does automatically:**
- Creates folders and stub files
- For registered extensions, generates a fresh UUID and updates `src/extensions.ts` with the import and `.use()` call
- For HTTP endpoints, creates the route file without changing `src/extensions.ts`
- Enforces naming rules (kebab-case, hyphen-required custom elements, etc.)

**HTTP endpoints:** Run `npx wix generate --params '{"extensionType":"HTTP_ENDPOINT","name":"hello"}'`, then implement the handler in the returned file. Follow [BACKEND_API.md](references/BACKEND_API.md); if the route does not respond, its troubleshooting hint shows how to confirm discovery from the build output.

### Step 4b: Fill in business logic

Open every path returned in `newFiles` and replace stubbed handler bodies / UI / queries with the user's actual logic, guided by the extension reference file's API and configuration sections.

- ⚠️ MANDATORY when using WDS: Invoke the `wix-design-system` skill **before editing your first `.tsx`/`.jsx` file that imports `@wix/design-system`**. Do NOT invoke it preemptively for backend-only or data-only jobs — it adds large content to context that you won't use.
- ⚠️ MANDATORY when using Data Collections: Use the EXACT collection ID from `idSuffix` (case-sensitive). If `idSuffix` is `"product-recommendations"`, use `<app-namespace>/product-recommendations` NOT `productRecommendations`.

### Step 4c: UX Completeness Self-Audit

**Dashboard page UI only.** `tsc`, `wix build`, and `wix preview` all check that the code compiles and runs — none of them check that it's the dashboard the [UX Success Model](references/dashboard-page/UX_SUCCESS_MODEL.md) describes. A page with a bare, un-summarized, un-openable table compiles cleanly and still fails the requirement — that gap is exactly how a generated dashboard passes every technical check and still disappoints. Measured runs confirm it: a page can compile clean and still ship with none of the three items below, because the earlier checklist entries were a stated intention rather than something re-checked against the code that actually landed.

Before moving to Step 5, re-open every page file you just wrote and check the actual code — not what you intended to include:

- [ ] **The page has a `SummaryBar` only if the request asked for one.** Grep for it: an uninvited bar is a defect, not a bonus, and deleting it is the fix. If the request *did* ask, every metric earns its place and the headline counts what **matches the filters** (`state.collection.total`, fed by `fetchTotal`), not what has been paged in — any metric derived from `keyedItems` is labelled as such.
- [ ] **If a `SummaryBar` number is fed by `fetchTotal`, follow that function to the call it makes and confirm the call counts.** A `fetchTotal` that resolves `undefined` — the usual cause being `pagingMetadata.total`, which a cursor-paged response does not carry — makes the bar report `0` beside a table full of rows, and it compiles, runs and passes every other check on this list. It must resolve a number from a count endpoint (`items.query(id)…count()`, a vertical's own count, or offset paging with `returnTotalCount: true`); if the API has none, delete `fetchTotal` and label the metric as loaded rows. See [TABLE_STATE.md](references/dashboard-page/TABLE_STATE.md#a-fetchtotal-that-resolves-undefined-shows-0-not-the-rows).
- [ ] **Every row opens an editable entity page by default**: `onRowClick` calls `navigateToEntityPage`, and the destination has an `EntityPage`, a working form, and a real save operation. A read-only route is justified by one of the three cases in [DRAFT_TEMPLATE.md](references/dashboard-page/DRAFT_TEMPLATE.md#2-choose-then-read-the-chosen-templates-page), and the final response names which one; report-only/export-only requests need no drill-in. The save calls the source's real update method and lets a failed call throw, so the page shows its error — no no-op, local-state-only save, or `catch` that swallows the failure. If Preview is available, change one field, reload to confirm it saved, and change it back; otherwise report the save as unverified. A `SidePanel` in a collection page file is the defect this replaces. `grep -n "<SidePanel" <page files>` should return nothing — match the JSX tag, not the bare word, or the templates' own "never a SidePanel" comments fail the check and invite someone to "fix" correct code.
- [ ] Every filter name declared in the toolbar also appears inside `fetchData`'s query construction — grep for the name in both places if unsure.
- [ ] The table wires `errorState` — without it a failed query is indistinguishable from a slow one, and the page you just shipped cannot tell you which it is.
- [ ] **Routed templates only (all but the settings one) — the entry file both passes and guards `location`.** `PatternsReactRouter` throws at open when `location` is missing *or* still `undefined` on the first render, and `tsc`, `wix build` and even a green build all pass regardless. Both halves are required — the `location={location}` prop **and** the `location ? … : null` guard around it, since `observeState` has not fired yet on the first render. Grep the entry file rather than trusting recall:

  ```bash
  grep -n "observeState\|location={location}\|location ?" src/extensions/dashboard/pages/<page>/<page>.tsx  # the file the builder's `component` points at
  ```

  Three hits is correct. A missing guard is the failure mode that has actually shipped: a measured run produced a page whose plumbing looked present and still crashed on open, while a re-run of the same prompt produced a working one — so this is intermittent, and re-running is not a check.
- [ ] Every `@wix/*` vertical imported by the page's api module is a declared dependency, and each one's scope is listed under Manual Steps. Any call to a **secondary** vertical (an enrichment lookup, a filter's options, a search term resolved to ids) is wrapped so its failure degrades that feature instead of failing the page.

If a box fails and no exception applies, add the missing piece now. Do not let "it compiles" stand in for "it satisfies the checklist" — Step 5 checks the former, this step checks the latter, and they are independent.

### Step 5: Run Validation

Run the four steps in [Validation](#validation) below. **Do NOT report completion to the user until validation passes** — if it fails, fix the errors and re-validate until it does.

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
- ✅/⚠️ Preview: [Created — Dashboard URL / Failed - reason]

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

`wix generate --params` updates `src/extensions.ts` automatically for registered extensions. HTTP endpoints require no import or `.use()` call; the runtime discovers their files. For background, troubleshooting, and the manual recovery pattern when `src/extensions.ts` drifts, see [EXTENSION_REGISTRATION.md](references/EXTENSION_REGISTRATION.md).

---

## Validation

Execute these steps sequentially after all implementation is complete. See [APP_VALIDATION.md](references/APP_VALIDATION.md) for the complete guide. Dashboard page UI: run [Step 4c's UX Completeness Self-Audit](#step-4c-ux-completeness-self-audit) first — the checks below verify the code runs, not that it's the dashboard the prompt asked for.

1. **Package Installation** — Detect package manager, run install
2. **TypeScript Compilation** — `npx tsc --noEmit -p .`
3. **Build** — `npx wix build`
4. **Preview** — `npx wix preview`, in the foreground: it uploads, prints the preview URLs and exits on its own, so no `timeout`, backgrounding or `sleep`

Stop and report errors if any step fails. Check `.wix/debug.log` on failures.

---

## Documentation

For links to official Wix CLI documentation for all extension types, see [DOCUMENTATION.md](references/DOCUMENTATION.md).
