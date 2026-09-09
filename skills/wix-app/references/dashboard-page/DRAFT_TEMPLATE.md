# Draft Template — the starting point for every dashboard page

**Start here for any Dashboard Page request, before writing a shell, provider, or router from scratch.** Pick the case below, copy its files, rename, and adapt fields/API calls/data source. Only leave this file for [WIX_PATTERNS_DOCS.md](../WIX_PATTERNS_DOCS.md), [COLLECTION_TOOLKIT.md](COLLECTION_TOOLKIT.md), [TABLE_STATE.md](TABLE_STATE.md), a component doc, or an MCP lookup when the request needs something no case shows.

Every snippet below was copied from the installed `dist/docs/*.md` and `dist/dts-bundle/*.d.ts`, not from memory — confirm props against your own installed version before deviating.

## Which case matches the request?

| The request needs… | Case | Router? |
| --- | --- | --- |
| Only a list/report — no create/edit form, maybe click a row for a quick look | **A — Collection only** | No |
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

**Cases B and D both need a router** — their entry file, app shell, and entity page are in [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md). The collection and settings files are shared by every case that uses them, B and D included; the router file links back rather than repeating them.

## File layout

```
src/extensions/dashboard/pages/{feature}/
  {feature}.extension.ts        # single wix generate scaffold — always exactly one route registered here
  {feature}.tsx                 # entry — Case A/C: see Section 1 below. Case B/D: see DRAFT_TEMPLATE_ROUTER.md
  {Feature}App.tsx              # Case B/D only — see DRAFT_TEMPLATE_ROUTER.md
  {Feature}CollectionPage.tsx   # Case A, B, D — see DRAFT_TEMPLATE_COLLECTION.md
  {Feature}EntityPage.tsx       # Case B, D only — see DRAFT_TEMPLATE_ROUTER.md
  {Feature}SettingsPage.tsx     # Case C, D only — see DRAFT_TEMPLATE_SETTINGS.md
  {feature}-api.ts              # fetch/save calls — keep these out of the components
```

Scaffold with a single call regardless of case — this is always one extension:

```bash
wix generate --params '{"extensionType":"DASHBOARD_PAGE","title":"<title>","route":"<route>"}'
```

## 1. Entry — Case A or C (router-free, no location plumbing)

The page component renders the shell directly — no `PatternsReactRouter`, so no manual `location` wiring either:

```tsx
// {feature}.tsx — Case A or C
import type { FC } from 'react';
import { withDashboard } from '@wix/patterns';
import { WixPatternsProvider } from '@wix/patterns/provider';
import { WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { {Feature}CollectionPage } from './{Feature}CollectionPage'; // or {Feature}SettingsPage for Case C — DRAFT_TEMPLATE_SETTINGS.md

const Page: FC = () => (
  <WixDesignSystemProvider>
    <WixPatternsProvider>
      <{Feature}CollectionPage />
    </WixPatternsProvider>
  </WixDesignSystemProvider>
);

export default withDashboard(Page);
```

Case B/D's entry file differs — it needs `location` supplied manually for `PatternsReactRouter`. See [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) rather than adding that plumbing here; it's dead code without a router underneath it.

## 2. Collection page — Case A, B, D

In [DRAFT_TEMPLATE_COLLECTION.md](DRAFT_TEMPLATE_COLLECTION.md) — `useTableCollection`, a working
filter, `SummaryBar` wired through `useSelector`, the four placeholder states, and the SidePanel
drill-in. Shared by Cases A, B and D.

## 3. Settings page — Case C, D

In [DRAFT_TEMPLATE_SETTINGS.md](DRAFT_TEMPLATE_SETTINGS.md) — `useSettingsPage` + `useForm`,
with the same field-controller patterns as the entity page.

## What to change vs. keep, per case

| Change per request | Keep as shown |
| --- | --- |
| Feature/entity names, fields, columns, API calls in `{feature}-api.ts` | Which case (A/B/C/D) — don't over-build D for a request that only named a list |
| Summary metrics, quick-view fields, form field types | `SidePanel`'s manual positioning — no built-in open state, in every case that uses it |
| Real data source (SDK-first per [SDK-First Rule](../../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms)) vs CMS | B/D wiring (provider/router nesting, `parentPath`, `location`): [DRAFT_TEMPLATE_ROUTER.md](DRAFT_TEMPLATE_ROUTER.md) |
