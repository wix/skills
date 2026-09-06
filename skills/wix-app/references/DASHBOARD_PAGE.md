# Wix Dashboard Page Builder

Dashboard pages appear in the site owner's Wix dashboard, where administrators manage data, configure settings, and perform admin tasks.

## Plan the Workflow Before the Components

A dashboard page is a workflow, not a screen. The site owner has to understand the situation, focus on what needs attention, investigate one record, act, and see the result confirmed — so translate the prompt into those needs before choosing any component: which view fits, which drill-in surface, which data sources have to line up.

Do this first because a bare filtered table answers "what are all the records" and none of "how many", "which one needs my attention", or "why did this happen" — and a table is what you get by default if the workflow was never named. Read [UX Success Model](dashboard-page/UX_SUCCESS_MODEL.md) now, and run its evaluation checklist before calling the page done. Which component serves each need: [Collection Toolkit](dashboard-page/COLLECTION_TOOLKIT.md).

## UI Libraries — Read Before Writing Any JSX

At Wix, dashboard pages are built from `@wix/patterns` and `@wix/design-system`, in that order of preference:

1. **`@wix/patterns` first** — page shells (`CollectionPage`, `EntityPage`, `SettingsPage`), tables/grids, collection state hooks, filters, sorting, row and bulk actions, in-extension routing. For the shell/provider/router themselves, start from [DRAFT_TEMPLATE.md](dashboard-page/DRAFT_TEMPLATE.md) rather than composing them from the docs — look an individual name up directly in `dist/dts-bundle/index.json` and `dist/docs/index.json` only for what the matching case doesn't already show. See [WIX_PATTERNS_DOCS.md](WIX_PATTERNS_DOCS.md).
2. **`@wix/design-system` second** — the leaf UI inside that shell (inputs, buttons, form fields, text, layout, cards, badges, icons). Choose components via the `wix-design-system` skill.
3. **Custom React last** — only when neither library has it.

Do not hand-write React for anything either library already provides, and do not decide a component is missing without checking. Full rule: [SKILL.md → Component Selection Order](../SKILL.md#component-selection-order).

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

**Before writing that UI:** pick the matching case in [DRAFT_TEMPLATE.md](dashboard-page/DRAFT_TEMPLATE.md#which-case-matches-the-request) and copy its files in over the generated stub — don't compose the shell from scratch. Then resolve the package root and `Read <pkgRoot>/dist/dts-bundle/index.json` once, per [Prerequisites](WIX_PATTERNS_DOCS.md#prerequisites), for whatever the template case doesn't already cover. Each Bash call is a fresh shell, so if you keep the path in a variable, set it again in every call.

## Capabilities

A dashboard page runs as the **Wix user** — see [Identity and Elevation Requirement](../SKILL.md#identity-and-elevation-requirement) before deciding where an SDK call runs.

### Data Operations (Wix Data SDK)

See [Wix Data Reference](data-collection/WIX_DATA.md) in the Data Collection reference for complete documentation.

- Read: `items.query('Collection').filter/sort.limit.find()` → `{ items, totalCount, hasNext }`
- Write: `items.insert | update | remove`. Ensure collection permissions allow the action

**Query methods:** `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `between`, `contains`, `startsWith`, `endsWith`, `hasSome`, `hasAll`, `isEmpty`, `isNotEmpty`, `and`, `or`, `not`, `ascending`, `descending`, `limit`, `skip`, `include`

### Dashboard APIs

See [Dashboard API Reference](dashboard-page/DASHBOARD_API.md) for complete documentation including all methods, page IDs, and examples.

**Key methods**, all on the `dashboard` object from `@wix/dashboard` (signatures, page IDs, and examples in the reference above):

- Navigation: `navigate()`, `navigateBack()`, `getPageUrl()`
- Feedback and chrome: `showToast()`, `setPageTitle()`
- Overlays: `openModal()` (see [Dashboard Modal reference](DASHBOARD_MODAL.md)), `openMediaManager()`
- State and lifecycle: `observeState()`, `onBeforeUnload()`, `onLayerStateChange()`
- Slots: `addSitePlugin()`

**CRITICAL: Using Modals in Dashboard Pages**

Dashboard Pages cannot use `<Modal />`. For a true dialog overlay you **MUST** use a dashboard modal extension — never a React modal, never the WDS `Modal` component. Reserve it for dialogs that neither write nor display a record this app lists (delete/discard confirmations, unsaved-changes prompts, informational notices), plus any dialog on a page that lists nothing (settings, config). They open via `dashboard.openModal()`, which integrates them with the dashboard lifecycle, state management, and navigation — implementation guide: [Dashboard Modal reference](DASHBOARD_MODAL.md).

> **🛑 The test — does the dialog create, update, or display one record this page lists?** If yes, it is an `EntityPage`, not a modal — whether those records come from a CMS collection or an existing Wix app's SDK. **A create / "add new" form is included**: it writes the record, so it is an `EntityPage` even though nothing is being edited yet. "It's a simple data-entry dialog, not an entity edit" is the wrong reading, and it is the single most common way the patterns-first rule gets dropped after the table is already correct.
>
> The `EntityPage` comes from `@wix/patterns`, reached via `usePatternsNavigate().navigateToEntityPage`, with `useEntityPage` owning fetch/save/validation and `@wix/patterns/form` owning form state. Its route is registered with `PatternsReactRoute` inside `PatternsReactRouter` — so do not hand-roll page location state to fake a second view (`useState<PageLocation>`, a `location` cast on `withDashboard`); that is the router's job, and needing the cast is the signal you skipped it.
>
> **If this page lists nothing** — a settings page, an embedded-script config page — the rule does not apply and a dashboard modal is a normal choice. But "I built the list without `@wix/patterns`" is not an exception: a page that lists records should be a `CollectionPage`.
>
> See [Entity create and edit](../SKILL.md#entity-create-and-edit) and [WIX_PATTERNS_DOCS.md](WIX_PATTERNS_DOCS.md); for the `useEntityPage` call itself, [Entity Page Toolkit](dashboard-page/ENTITY_PAGE_TOOLKIT.md).

**Ecom Navigation:** See [Ecom Navigation Reference](dashboard-page/ECOM_NAVIGATION.md) for ecom-specific navigation helpers.

### Embedded Script Configuration API

When building a dashboard page to configure an embedded script, see [Dynamic Parameters Reference](dashboard-page/DYNAMIC_PARAMETERS.md) for the implementation guide.

**Key points:**

- Use `embeddedScripts` from `@wix/app-management`
- Parameters cross the API as strings in both directions — convert on load, and convert booleans/numbers back to strings on save
- Use the `withProviders` wrapper when dynamic parameters are present

## Examples

Each starts from a case in [DRAFT_TEMPLATE.md](dashboard-page/DRAFT_TEMPLATE.md) — copy that case's files, then adapt. Only what differs per request is listed below; the wiring lives solely in the template.

| Request | Case | Adapt |
| --- | --- | --- |
| "Dashboard page to manage blog posts" | B | Columns for the post fields named; edit/delete from the collection's own APIs; `{feature}-api.ts` calls `@wix/blog` |
| "Settings page for notification preferences" | C | Form fields (`FormField`, `Input`, `ToggleSwitch`) per preference — no collection, no router |
| "Admin panel for customer orders" | B | Status `Badge` in a cell; data source is `@wix/ecom`, never CMS (see [SDK-First Rule](../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms)); Dashboard Modal only for delete confirmation, never for view/edit (see [Entity create and edit](../SKILL.md#entity-create-and-edit)) |
| "Settings page for the coupon popup embedded script" | C | Fields for headline, coupon code, min cart value, enable toggle; swap `fetch`/`onSave` for `embeddedScripts.getEmbeddedScript()`/`embedScript()`, string-converted both ways (see [Dynamic Parameters](dashboard-page/DYNAMIC_PARAMETERS.md)); use `withProviders` in place of the template's plain provider |
| "Admin page to manage fees, with an app settings section" | D | One extension, not several — fee fields/calls into all four route components. Skipping the router's `location` plumbing here passes `tsc`/`wix build` silently and fails only in a browser |


## API Spec Support

When an API specification is provided, you can call those endpoints — see [API Spec Reference](dashboard-page/API_SPEC.md).


## Layout Guidelines

Content layout inside the page shell — the 6px base unit, the 12-column grid, spacing tokens, form/display/marketing/wizard layouts: see [WDS Layout Reference](dashboard-page/WDS_LAYOUT.md).

Remember the split: `@wix/patterns` owns the page shell and anything collection-shaped; that reference covers only the content you place inside it.
