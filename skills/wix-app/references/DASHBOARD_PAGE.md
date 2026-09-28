# Wix Dashboard Page Builder

Dashboard pages appear in the site owner's Wix dashboard, where admins manage data and configure settings.

## Plan the Workflow Before the Components

A dashboard page is a workflow, not a screen. The site owner has to understand the situation, focus on what needs attention, investigate one record, act, and see the result confirmed — so translate the prompt into those needs before choosing any component.

Do this first because a bare filtered table answers "what are all the records" and neither "which one needs my attention" nor "why did this happen" — and a table is what you get by default if the workflow was never named. Read [UX Success Model](dashboard-page/UX_SUCCESS_MODEL.md) now, and run its evaluation checklist before calling the page done. Which component serves each need is the installed package's own answer — see [The Discovery Chain](WIX_PATTERNS_DOCS.md#the-discovery-chain).

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

**Before writing that UI:** pick the matching case in [DRAFT_TEMPLATE.md](dashboard-page/DRAFT_TEMPLATE.md#which-case-matches-the-request) and copy its files in over the generated stub — don't compose the shell from scratch.

**Then, for whatever the template case doesn't already cover:** resolve the package root and probe `<pkgRoot>/dist/docs/index.json` once with `grep`/`python3` — not a whole-file `Read`, which truncates it silently — per [Prerequisites](WIX_PATTERNS_DOCS.md#prerequisites). That index carries each symbol's `importPath`, `examples` and `bundle`, which is what decides whether you need to open anything else at all. Each Bash call is a fresh shell — re-set the path variable in every call.

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

Each starts from a case in [DRAFT_TEMPLATE.md](dashboard-page/DRAFT_TEMPLATE.md) — copy that case's files, then adapt. Only what differs per request is listed below; the wiring lives solely in the template.

| Request | Case | Adapt |
| --- | --- | --- |
| "Dashboard page to manage blog posts" | B | Columns for the post fields named; search, row actions and empty state from the collection's own APIs; add/edit navigate to the `EntityPage`; `{feature}-api.ts` calls `@wix/blog` |
| "Settings page for notification preferences" | C | `SettingsPage` shell with a WDS field per preference (`FormField`, `Input`, `ToggleSwitch`); save confirms with `dashboard.showToast()`, and `dashboard.onBeforeUnload()` warns on unsaved changes — no collection, no table hook, no router |
| "Admin panel for customer orders" | B | Filters, sorting and row actions from the collection APIs — **not** a hand-built WDS filter bar; status `Badge` is leaf UI in a cell; data source is `@wix/ecom`, never CMS (see [SDK-First Rule](../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms)); viewing or editing opens the `EntityPage`, and a Dashboard Modal appears only for the delete confirmation (see [Entity create and edit](../SKILL.md#entity-create-and-edit)) |
| "Settings page for the coupon popup embedded script" | C | Fields for headline, coupon code, min cart value, enable toggle; swap `fetch`/`onSave` for `embeddedScripts.getEmbeddedScript()`/`embedScript()`, string-converted both ways (see [Dynamic Parameters](dashboard-page/DYNAMIC_PARAMETERS.md)); use `withProviders` in place of the template's plain provider |
| "Admin page to manage fees, with an app settings section" | D | One extension, not several — fee fields/calls into all four route components. Skipping the router's `location` plumbing here passes `tsc`/`wix build` silently and fails only in a browser |


## API Spec Support

When an API specification is provided, you can call those endpoints — see [API Spec Reference](dashboard-page/API_SPEC.md).


## Layout Guidelines

Content layout inside the page shell — the 6px base unit, the 12-column grid, spacing tokens, form/display/marketing/wizard layouts: see [WDS Layout Reference](dashboard-page/WDS_LAYOUT.md).

Remember the split: `@wix/patterns` owns the shell and anything collection-shaped; that reference covers only content placed inside.
