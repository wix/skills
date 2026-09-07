# Wix Dashboard Page Builder

Dashboard pages appear in the site owner's Wix dashboard, where admins manage data and configure settings.

## Plan the Workflow Before the Components

A dashboard page is a workflow, not a screen. The site owner has to understand the situation, focus on what needs attention, investigate one record, act, and see the result confirmed — so translate the prompt into those needs before choosing any component.

Do this first because a bare filtered table answers "what are all the records" and none of "how many", "which one needs my attention", or "why did this happen" — and a table is what you get by default if the workflow was never named. Read [UX Success Model](dashboard-page/UX_SUCCESS_MODEL.md) now, and run its evaluation checklist before calling the page done. Which component serves each need is the installed package's own answer — see [The Discovery Chain](WIX_PATTERNS_DOCS.md#the-discovery-chain).

## UI Libraries — Read Before Writing Any JSX

`@wix/patterns` first, `@wix/design-system` for the leaf UI inside its shell, custom React only when neither has it. Do not hand-write React for anything either library provides, and do not decide a component is missing without checking.

The order, what each library owns, and how to look a name up are stated once: [SKILL.md → Component Selection Order](../SKILL.md#component-selection-order).

## Scaffold

Use `wix generate --params` with all required fields:

```bash
wix generate --params '{"extensionType":"DASHBOARD_PAGE","title":"<title>","route":"<route>"}'
```

| Field | Constraint |
| --- | --- |
| `title` | Display name shown in the dashboard sidebar. |
| `route` | URL path segment (lowercase alphanumeric + hyphens). The page is served at `/dashboard/<route>`. The scaffold param is `route`; the builder file's runtime field is `routePath`. |

The CLI generates the folder, `page.tsx`, the builder file, the UUID, and the `src/extensions.ts` registration. After scaffolding, implement the page UI in the generated `page.tsx`.

**Never reuse `<route>` as a path prefix inside this page's `PatternsReactRouter`** — its location is already page-scoped, so a page scaffolded `route: "shifts"` still routes from `path="/"`, and `path="/shifts"` silently never matches. Page-relative paths: `<pkgRoot>/dist/docs/Collection to Entity Flow.md`.

**Then, before writing UI:** resolve the package root and `Read <pkgRoot>/dist/dts-bundle/index.json` once, per [Prerequisites](WIX_PATTERNS_DOCS.md#prerequisites). Each Bash call is a fresh shell — re-set the path variable in every call.

## Capabilities

A dashboard page runs as the **Wix user** — see [Identity and Elevation Requirement](../SKILL.md#identity-and-elevation-requirement) before deciding where an SDK call runs.

### Data Operations (Wix Data SDK)

See [Wix Data Reference](data-collection/WIX_DATA.md).

- Read: `items.query('Collection').filter/sort.limit.find()` → `{ items, totalCount, hasNext }`
- Write: `items.insert | update | remove`. Ensure collection permissions allow the action

**Query methods:** `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `between`, `contains`, `startsWith`, `endsWith`, `hasSome`, `hasAll`, `isEmpty`, `isNotEmpty`, `and`, `or`, `not`, `ascending`, `descending`, `limit`, `skip`, `include`

### Dashboard APIs

See [Dashboard API Reference](dashboard-page/DASHBOARD_API.md) for all methods, page IDs, and examples.

**Key methods**, all on the `dashboard` object from `@wix/dashboard` (signatures, page IDs, and examples in the reference above):

- Navigation: `navigate()`, `navigateBack()`, `getPageUrl()`
- Feedback and chrome: `showToast()`, `setPageTitle()`
- Overlays: `openModal()` (see [Dashboard Modal reference](DASHBOARD_MODAL.md)), `openMediaManager()`
- State and lifecycle: `observeState()`, `onBeforeUnload()`, `onLayerStateChange()`
- Slots: `addSitePlugin()`

**CRITICAL: Using Modals in Dashboard Pages**

Dashboard Pages cannot use `<Modal />`. For a true dialog overlay you **MUST** use a dashboard modal extension — never a React modal or the WDS `Modal` component. Reserve it for dialogs that neither write nor display a listed record (delete/discard confirmations, unsaved-changes prompts, notices), plus any dialog on a page that lists nothing (settings, config). They open via `dashboard.openModal()` — see [Dashboard Modal reference](DASHBOARD_MODAL.md).

> **🛑 The test — does the dialog create, update, or display one record this page lists?** If yes, it is an `EntityPage`, not a modal — whether those records come from a CMS collection or an existing Wix app's SDK. **A create / "add new" form is included**: it writes the record, so it is an `EntityPage` even though nothing is being edited yet. "It's a simple data-entry dialog, not an entity edit" is the wrong reading — the most common way the patterns-first rule gets dropped after the table is already correct.
>
> The `EntityPage` comes from `@wix/patterns`, reached via `usePatternsNavigate().navigateToEntityPage`, with `useEntityPage` owning fetch/save/validation and `@wix/patterns/form` owning form state. Its route is registered with `PatternsReactRoute` inside `PatternsReactRouter` — so do not hand-roll page location state to fake a second view (`useState<PageLocation>` as a stand-in for a route); that is the router's job, and needing it is the signal you skipped one.
>
> That's not a rule against `withDashboard`: the router **requires** it above itself and a `location` prop, which the page gets from `dashboard.observeState` (a Wix CLI app passes no props to dashboard pages). Skip it and `PatternsReactRouter` throws at open, though typecheck, bundling, and `wix preview` all pass. Read `<pkgRoot>/dist/docs/withDashboard.md` (ships from 1.465.0; on older installs, `PatternsReactRouter.md`'s **Requirements**).
>
> **If this page lists nothing** (settings, config) the rule doesn't apply. But "I built the list without `@wix/patterns`" is not an exception: a page that lists records should be a `CollectionPage`.
>
> See [Entity create and edit](../SKILL.md#entity-create-and-edit) and [WIX_PATTERNS_DOCS.md](WIX_PATTERNS_DOCS.md); for the `useEntityPage` call itself, `<pkgRoot>/dist/docs/useEntityPage.md`.

**Ecom Navigation:** See [Ecom Navigation Reference](dashboard-page/ECOM_NAVIGATION.md) for ecom-specific navigation helpers.

### Embedded Script Configuration API

When building a dashboard page to configure an embedded script, see [Dynamic Parameters Reference](dashboard-page/DYNAMIC_PARAMETERS.md).

**Key points:**

- Use `embeddedScripts` from `@wix/app-management`
- Parameters cross the API as strings in both directions — convert on load, and convert booleans/numbers back to strings on save
- Use the `withProviders` wrapper when dynamic parameters are present

## Examples

Each output below names the library that owns each part. Confirm every patterns component and prop by reading its doc from `dist/docs/index.json` before use — these examples name the shape, not a verified API.

### Data Management Table

**Request:** "Create a dashboard page to manage blog posts"

**Output:** A `@wix/patterns` `CollectionPage` wrapping a `Table` driven by `useTableCollection`, with search, row actions, and empty state from the collection's own APIs. Add and edit navigate to an `EntityPage`. WDS only for leaf UI inside cells and entity-page cards; the provider sits in a parent component, in its own file.

### Settings Form

**Request:** "Build a settings page for notification preferences"

**Output:** A `@wix/patterns` `SettingsPage` shell. WDS form fields inside it (`FormField`, `Input`, `ToggleSwitch`), save button with `dashboard.showToast()` confirmation, and `dashboard.onBeforeUnload()` for the unsaved-changes warning. No collection here, so no table hook.

### Order Management

**Request:** "Create an admin panel for customer orders"

**Output:** A `@wix/patterns` `CollectionPage` + `Table`, with filters, sorting, and row actions from the collection APIs — **not** a hand-built WDS filter bar. Status badges are WDS leaf UI in a cell. Viewing or editing an order opens an `EntityPage` via `navigateToEntityPage`, not a modal; a Dashboard Modal appears only for the delete confirmation.

### Embedded Script Configuration

**Request:** "Create a settings page for the coupon popup embedded script"

**Output:** A `@wix/patterns` `SettingsPage` with WDS form fields (popup headline, coupon code, minimum cart value, enable toggle). `embeddedScripts.getEmbeddedScript()` loads the parameters on mount, `embeddedScripts.embedScript()` saves them back — both sides string-converted, per [Dynamic Parameters](dashboard-page/DYNAMIC_PARAMETERS.md).


## API Spec Support

When an API specification is provided, you can call those endpoints — see [API Spec Reference](dashboard-page/API_SPEC.md).


## Layout Guidelines

Content layout inside the page shell — the 6px base unit, the 12-column grid, spacing tokens, form/display/marketing/wizard layouts: see [WDS Layout Reference](dashboard-page/WDS_LAYOUT.md).

Remember the split: `@wix/patterns` owns the shell and anything collection-shaped; that reference covers only content placed inside.
