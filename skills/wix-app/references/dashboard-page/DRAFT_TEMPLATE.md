# Draft Template — the starting point for every dashboard page

**Start here for any Dashboard Page request, before writing a shell, provider, or router from scratch.** The templates themselves ship inside the installed `@wix/patterns`: whole, working pages that the package type-checks against its own release, so they never drift from the version your code compiles against. This file says how to find one, where its files go in a Wix CLI app, and what this skill adds on top. Which template fits, and the wiring each one must keep, is the package's answer — read it there.

Go through [WIX_PATTERNS_DOCS.md § Prerequisites](../WIX_PATTERNS_DOCS.md#prerequisites) first for `<pkgRoot>`; every path below is relative to it.

## 1. Find the templates

Templates are docs-index entries with `category: "Templates"`, and each lists every file of its page in `templateFiles` (relative to `dist/templates/`). One probe lists them all with the guide that chooses between them:

```bash
python3 -c "
import json; i = json.load(open('<pkgRoot>/dist/docs/index.json'))
for k, e in i.items():
    if e.get('category') == 'Templates' or e.get('relatedTemplates'):
        print(k, '|', e.get('templateFiles') or e.get('relatedTemplates'), '|', e.get('summary', '')[:200])
"
```

**No `Templates` entries means the install predates them — upgrade `@wix/patterns`.** Do not rebuild a page from memory or from an older copy of this skill instead: the templates exist so the shell, provider nesting and router wiring come from the package.

## 2. Choose, then read the chosen template's page

1. `Read <pkgRoot>/dist/docs/Page Templates.md` — choose the editable collection template by default, then account for the three read-only cases below, settings, and where the rows come from (your own fetch, or a CMS collection).
2. `Read` the chosen template's page (`dist/docs/<entry file>`) — its files, and the wiring to keep. Most of that wiring passes `tsc` and `wix build` when wrong and fails only in the browser, which is why [Step 5's Preview](../../SKILL.md#validation) is not optional for a routed page.

**Editing existing records is the default.** A site owner who opens a record from a dashboard table expects to fix what they see; a read-only page they never asked for sends them to a follow-up prompt. So every collection row opens an editable `EntityPage` with a working form and save operation, for CMS and SDK data alike. "Table", "list", "show" or "view" alone do not mean read-only. Apply this choice to each collection when a page contains several.

Use the `Collection and Read-Only Detail Template` instead in exactly three cases:

- **The user explicitly asks for read-only** — "view only", "do not allow changes".
- **The source is verified to support no edits** — the schema or the documented update API leaves no editable field, or it is a CMS collection that can never be updated (owned by a Wix app other than Members and Forms, shared from another site, or without an update operation). Otherwise keep immutable fields read-only and edit the rest. When editing only needs setup (a permission, a role, an elevated backend call), keep the editable page and name the setup. Never ship a form whose save always fails, and never invent an update method or a no-op save handler to satisfy the default.
- **The records are a log your app writes** — a backend event handler or job records something that happened elsewhere (a payment, a submission, an audit entry). Editing such a record falsifies history without changing what it describes, so it opens read-only unless the user asks to edit it.

An explicit report-only or export-only request needs no detail page at all.

An existing read-only page in the project shows how to call the data, not what to build; start from the template.

Add create, delete or settings only when the workflow needs them; otherwise remove the template's create action and `/new` route. For a read-only CMS page, keep the schema-driven collection and adapt its detail route to the read-only layout rather than exposing the entity form.

## 3. Copy it into the extension

Scaffold once — every template is one extension, however many routes it has:

```bash
wix generate --params '{"extensionType":"DASHBOARD_PAGE","title":"<title>","route":"<route>"}'
```

`route` takes no leading slash — `support-tickets`, not `/support-tickets`. See [Dashboard Page → Scaffold](../DASHBOARD_PAGE.md#scaffold).

Then copy **every** file in `templateFiles` into the generated folder (`src/extensions/dashboard/pages/<feature>/`). They import one another by relative path, so keep their names relative to each other; one file on its own does not compile.

- The template's `page.tsx` is the entry file, and the CLI generated none by that name: put its contents into the component file the builder's `component` path points at (e.g. `employee-shifts.tsx`), and add no separate `page.tsx`, which nothing loads. Leave the builder file and the `src/extensions.ts` registration as the CLI wrote them.
- Rename `Items` / `Item` to your feature and entity, in file names and identifiers alike.
- Route paths stay page-relative (`/`, `/:id`, `/new`) — never prefix them with `<route>` ([DASHBOARD_PAGE.md](../DASHBOARD_PAGE.md)).

- **Theme the entry file.** In it, replace the template's `WixDesignSystemProvider` and its `@wix/design-system/styles.global.css` import with the app's `BusinessManagerTheme` — written once per app ([BUSINESS_MANAGER_THEME.md § 2](../BUSINESS_MANAGER_THEME.md#2-the-wrapper--write-this-file-once-per-app)), kept in the entry file so it sits above `WixPatternsProvider`. **Business Manager passes none of the redesign through the extension's iframe**, so the bare provider renders the pre-redesign look while `tsc`, `wix build` and `wix preview` all pass.

## 4. Replace the data file

Each template's data file (`items-api.ts`, `settings-api.ts`) is an in-memory stand-in with the signatures the pages call. Replace the bodies, keep the signatures:

- **Whose data it is decides the call.** Data an existing Wix app owns comes from that app's SDK, never a CMS collection ([SDK-First Rule](../../SKILL.md#sdk-first-rule-existing-wix-app-data-is-never-cms)). The method and field names: [DATA_SOURCES.md](DATA_SOURCES.md). Filter paths, operators and cursor paging: [QUERY_AND_PAGING.md](QUERY_AND_PAGING.md).
- **A CMS collection uses the CMS template, which has no data file** — its `collection.ts` takes the full scoped id, `<app-namespace>/<idSuffix>` for a collection your extension ships ([DATA_COLLECTION.md](../DATA_COLLECTION.md)). The collection does not exist until the app is released ([LIFECYCLE.md](../data-collection/LIFECYCLE.md#the-extension-does-not-create-the-collection)).
- **On a CMS collection, the prompt's fields are the collection's fields** — every one a column, none hand-written. For a collection your extension ships, create exactly those fields; an existing site collection shows all its fields, and the user hides the rest in the column picker. A stated column list decides the columns only on the hand-wired path.

### Installing the CMS pair

`@wix/patterns-cms` pins one exact `@wix/patterns` version, and the template's page says why a second copy breaks the page silently.

**Already in `package.json`** (some app templates ship both): don't install it again — go straight to the check. **Not there:** install it, then align `@wix/patterns` to its pin:

```bash
npm install @wix/patterns-cms
npm install @wix/patterns@$(node -p "require('@wix/patterns-cms/package.json').dependencies['@wix/patterns']")
```

**Either way, confirm a single copy:**

```bash
npm dedupe
find node_modules -path '*@wix/patterns/package.json' -not -path '*/dist/*'
```

More than one line is a bug that `tsc` and `wix build` both pass. Declared ranges produce it when `@wix/patterns` ships ahead of `@wix/patterns-cms`, or a lockfile holds an older one. Run the second `npm install` line above, then the check again.

### Turning `query.search` into a query

On the hand-wired path the data file turns one search term into a filter over *several* fields — an OR. **This is where search ships broken**: it renders, it reaches the query, and still returns every row. (The CMS template's source does this itself.)

There is no shared free-text operator; the shape differs per endpoint. Read its *Supported Filters* page ([QUERY_AND_PAGING.md](QUERY_AND_PAGING.md#the-filterable-fields-are-a-closed-list-published-per-endpoint)), then `$or` one clause per identity field it lists. Never route the term to a single field by its shape — a measured run shipped this, and one branch is always dead:

```ts
query = term.includes('@')
  ? query.startsWith('loginEmail', term)
  : query.startsWith('contact.firstName', term);  // a surname matches nothing, ever
```

`startsWith` is prefix-only too — "Smith" never finds "John Smith" — so prefer the containment operator when the endpoint declares one, and say which you used in `noResultsState`.

**Whatever the shape, prove it narrows.** Run one term you expect to hit a known row and one you expect to hit nothing, and check the row count changes for both.

## 5. What this skill adds to every template

- **No `SummaryBar` unless the request asked for one** — a named total, count or "how many / how much" figure. The templates ship without one on purpose ([SKILL.md § Step 2](../../SKILL.md)).
- **The state is MobX.** Deriving anything from the collection state in your own component — a header figure, a badge — goes through `useSelector` ([TABLE_STATE.md](TABLE_STATE.md#reading-state-outside-the-table-it-is-mobx)).
- **Anything the template does not show** — another filter type, a column renderer, a component the request needs — goes through [The Discovery Chain](../WIX_PATTERNS_DOCS.md#the-discovery-chain). A template replaces composing the shell, never the lookup for a symbol it does not contain.
