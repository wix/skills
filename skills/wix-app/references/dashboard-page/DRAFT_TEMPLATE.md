# Draft Template — the starting point for every dashboard page

**Start here for any Dashboard Page request, before writing a shell, provider, or router from scratch.** Pick the case below, copy its files, rename, and adapt fields/API calls/data source. Only leave this file for [WIX_PATTERNS_DOCS.md](../WIX_PATTERNS_DOCS.md), the package's own `Collection Toolkit.md` guide, [TABLE_STATE.md](TABLE_STATE.md), a component doc, or an MCP lookup when the request needs something no case shows.

Every snippet below was copied from the installed `dist/docs/*.md` and `dist/dts-bundle/*.d.ts`, not from memory — confirm props against your own installed version before deviating.

## Which case matches the request?

| The request needs… | Case | Router? |
| --- | --- | --- |
| A list/report whose rows are read-only — no create/edit form | **A — Collection + read-only detail** | Yes |
| A list **and** create/edit for each record (no separate app-settings area) | **B — Collection + Entity** | Yes |
| Only app-wide settings/config — no list at all | **C — Settings only** | No |
| A list, create/edit, **and** an app-settings area, all in one extension | **D — Collection + Entity + Settings** | Yes |

Don't default to D because it's the most complete — [Step 4c's checklist](../../SKILL.md#step-4c-ux-completeness-self-audit) doesn't ask for a settings or entity page unless the request needs one. If unsure between B and D, re-read the prompt for "settings," "configure," "preferences" — their absence means B.

## Then: which data path?

Case tells you how many pages. This tells you how they're built, and it is the other half of the
decision — the two paths share almost no code:

| The rows come from | Path |
| --- | --- |
| A vertical SDK (`@wix/bookings`, `@wix/ecom`, …) or any API you call yourself | **Hand-wired** — [DRAFT_TEMPLATE_COLLECTION.md](DRAFT_TEMPLATE_COLLECTION.md), below |
| A **CMS collection** — one your Data Collection extension ships, or an existing site collection | **Schema-driven** — [DRAFT_TEMPLATE_CMS_COLLECTION.md](DRAFT_TEMPLATE_CMS_COLLECTION.md) |

A CMS collection built the hand-wired way compiles and runs while silently losing schema-driven
columns, field management and the generated entity form. Decide this before writing the page, not
after — converting means rewriting both the collection page and the entity page.

**The one carve-out: a prompt that names an exact column subset.** The schema path renders *every*
field the schema has. `SchemaTableProps.columns` is "columns beyond the source's fields" — it adds
an action column, it cannot remove a data one — a `Field` carries no hidden/visible flag, and the
initial selection is set internally to all columns (`ToolbarCollectionState`). The only way to drop
one is `customColumns={<CustomColumns />}`, a picker the **end user** operates. So "the table shows
name, tier and date — email and notes are not columns" is a requirement this path cannot express:
you would ship all five and leave two for the reader to hide.

When the prompt names the columns and the list is narrower than the collection, hand-wire the CMS
collection and say why in a comment — `fetchData` calls `@wix/data` `items.query()`
([WIX_DATA.md](../data-collection/WIX_DATA.md)), and free-text search becomes yours to build, so
read [DRAFT_TEMPLATE_COLLECTION.md § Turning `query.search` into a query](DRAFT_TEMPLATE_COLLECTION.md#turning-querysearch-into-a-query)
before writing the filter. Anything short of a stated column subset stays schema-driven.

**Cases B and D both need a router** — their entry file, app shell, and entity page are in [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md). The collection and settings files are shared by every case that uses them, B and D included; the router file links back rather than repeating them.

## File layout

```
src/extensions/dashboard/pages/{feature}/
  {feature}.extension.ts        # single wix generate scaffold — always exactly one route registered here
  {feature}.tsx                 # entry — Case C: Section 1 below. Cases A/B/D: DRAFT_TEMPLATE_ROUTER.md
  {Feature}App.tsx              # Case A/B/D only — see DRAFT_TEMPLATE_ROUTER.md
  {Feature}CollectionPage.tsx   # Case A, B, D — see DRAFT_TEMPLATE_COLLECTION.md
  {Feature}DetailPage.tsx       # Case A only — read-only detail route, DRAFT_TEMPLATE_ROUTER.md §4
  {Feature}EntityPage.tsx       # Case B, D only — see DRAFT_TEMPLATE_ROUTER.md
  {Feature}SettingsPage.tsx     # Case C, D only — see DRAFT_TEMPLATE_SETTINGS.md
  {feature}-api.ts              # fetch/save calls — keep these out of the components
```

Scaffold with a single call regardless of case — this is always one extension:

```bash
wix generate --params '{"extensionType":"DASHBOARD_PAGE","title":"<title>","route":"<route>"}'
```

## 1. Entry — Case C only (router-free, no location plumbing)

Case C has one page and no rows to open, so it needs no router and no manual `location` wiring. **Cases A, B and D all route** — a row opens a page of its own in every one of them — so their entry file is [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) §1:

```tsx
// {feature}.tsx — Case C
import type { FC } from 'react';
import { withDashboard } from '@wix/patterns';
import { WixPatternsProvider } from '@wix/patterns/provider';
import { WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { {Feature}SettingsPage } from './{Feature}SettingsPage'; // DRAFT_TEMPLATE_SETTINGS.md

const Page: FC = () => (
  <WixDesignSystemProvider>
    <WixPatternsProvider>
      <{Feature}SettingsPage />
    </WixPatternsProvider>
  </WixDesignSystemProvider>
);

export default withDashboard(Page);
```

Cases A, B and D differ — they need `location` supplied manually for `PatternsReactRouter`. See [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) rather than adding that plumbing here; it's dead code without a router underneath it.

## 2. Collection page — Case A, B, D

In [DRAFT_TEMPLATE_COLLECTION.md](DRAFT_TEMPLATE_COLLECTION.md) — `useTableCollection`, a working
filter, the four placeholder states, and a row that opens. Shared by Cases A, B and D. No
`SummaryBar` unless the request asked for one, and the drill-in is always a route — never a side
panel.

## 3. Settings page — Case C, D

In [DRAFT_TEMPLATE_SETTINGS.md](DRAFT_TEMPLATE_SETTINGS.md) — `useSettingsPage` + `useForm`,
with the same field-controller patterns as the entity page.

## What to change vs. keep, per case

| Change per request | Keep as shown |
| --- | --- |
| Feature/entity names, fields, columns, API calls in `{feature}-api.ts` | Which case (A/B/C/D) — don't over-build D for a request that only named a list |
| Detail fields, form field types, columns | The drill-in being a route, and the absence of a `SummaryBar` the request never asked for |
| Real data source (SDK-first per [SDK-First Rule](../../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms)) vs CMS | B/D wiring (provider/router nesting, `parentPath`, `location`): [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) |
