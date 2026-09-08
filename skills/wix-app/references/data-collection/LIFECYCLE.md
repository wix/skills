# Getting a Collection to Exist on a Site

> Split out of [DATA_COLLECTION.md](../DATA_COLLECTION.md). Scaffolding a collection is the easy
> half; this file is everything between "the file compiles" and "the rows are queryable on a real
> site". Every item here has cost a measured run a confused debugging session.

## Contents

- [Item access and collection management are different scopes](#item-access-and-collection-management-are-different-scopes)
- [The site must have CMS, or nothing is created at all](#the-site-must-have-cms-or-nothing-is-created-at-all)
- [The extension does not create the collection](#the-extension-does-not-create-the-collection)
- [App Version Updates](#app-version-updates)
- [Permissions](#permissions) — including the context rules that decide them

## Item access and collection management are different scopes

The data-collections extension gives your app read/write access to the **items** in its own
collections — `items.query/insert/update` work with no extra scope. It does **not** grant the
collection-*management* API: `collections.listDataCollections()` and friends answer 403 unless the
app holds a Data Collections management scope.

That asymmetry is worth knowing before you debug: a page whose table loads rows has proved its
collection exists, because Wix Data errors on a missing collection rather than returning empty. If
that same page cannot list collections, the app is missing a management scope — a separate fact
about tooling, not evidence about the collection.

## The site must have CMS, or nothing is created at all

**The installing site needs the CMS (Content Manager) app.** Per the extension's own docs:
"Without it, collections added by the extension won't appear after installation." Nothing warns
you — the release succeeds, the update succeeds, and the collection silently never exists. Bundle
CMS as an [app dependency](https://dev.wix.com/docs/build-apps/launch-your-app/market-listing/add-app-dependencies)
so installing your app brings it, and list "add CMS to the site" under
[Manual Steps Required](../../SKILL.md#-manual-steps-required) for any site that may not have it.

This is the first thing to check when a collection is missing after a correct release and update.

## The extension does not create the collection

Scaffolding the extension, compiling, and even releasing all leave the site's CMS unchanged.
A collection appears only when the app is **installed or updated on the site** with a version that
contains the extension — and any change under `data-collections/` needs a **major** version:

```bash
npx wix release --version-type major -c "<what changed>"
```

Releasing is only half of it. **Report both remaining browser steps under
[Manual Steps Required](../../SKILL.md#-manual-steps-required)** — they are the difference between a
page that works and one that shows an empty table:

1. Update the app on the site to the new version.
2. Wait up to 5 minutes for propagation.

A dev server running a version override does not create collections either, so "I ran `wix dev` and
the collection isn't in the CMS" is this step, not a bug.

## App Version Updates

Changes to your data collections extension require releasing a new major version of your app. When a user updates to the new major version, their collections are updated as follows:

- **Adding a new collection:** The new collection is created on the site.
- **Removing a collection:** If the old app version defined a collection and the new version doesn't, the collection is removed from the site.
- **Modifying a collection schema:** Field additions, removals, and type changes are applied to the collection. Existing data is preserved.

**Important notes:**

- Collection changes only affect users who update to the new major version. Users who don't update retain their current collections.
- Collection changes take up to 5 minutes to propagate after an update.
- **Initial data is only imported when a collection is first created.** If a collection already contains data, `initialData` is ignored during updates.

## Permissions

Access levels control who can read, create, update, and delete items in collections.

| Level                | Description                                        |
| -------------------- | -------------------------------------------------- |
| `UNDEFINED`          | Not set (inherits defaults)                        |
| `ANYONE`             | Public access (including visitors)                 |
| `SITE_MEMBER`        | Any signed-in user (members and collaborators)     |
| `SITE_MEMBER_AUTHOR` | Signed-in users, but members only access own items |
| `CMS_EDITOR`         | Site collaborators with CMS Access permission      |
| `PRIVILEGED`         | CMS administrators and privileged users            |

**Common patterns:**

- Public content (default, recommended): `read: ANYONE, write: PRIVILEGED`
- User-generated content: `read: SITE_MEMBER, write: SITE_MEMBER_AUTHOR`
- Editorial workflow: `read: ANYONE, write: CMS_EDITOR`
- Private/admin: `read: PRIVILEGED, write: PRIVILEGED`

**Permission hierarchy** (most to least restrictive): `PRIVILEGED` > `CMS_EDITOR` > `SITE_MEMBER_AUTHOR` > `SITE_MEMBER` > `ANYONE` > `UNDEFINED`

### Context-Based Permission Rules

**CRITICAL: Permissions must match where and how the data is accessed.** The consumer of the data determines the minimum permission level — setting permissions more restrictive than the access context will cause runtime failures (empty results or permission-denied errors).

**Determine permissions by asking: "Who interacts with this data, and from where?"**

| Access Context | Who Sees / Uses It | Implication |
|---|---|---|
| **Custom element widget** (`CUSTOM_ELEMENT_WIDGET`) | Any site visitor (public) | Reads must be `ANYONE`. If the widget accepts input (e.g., reviews, submissions), inserts must also be `ANYONE` or `SITE_MEMBER`. |
| **Embedded Script** | Any site visitor (public) | Same as custom element widget — reads must be `ANYONE`. Writes depend on whether visitors can submit data. |
| **Dashboard Page** (`DASHBOARD_PAGE`) | Site owner / collaborators only | Can use `CMS_EDITOR` or `PRIVILEGED` for all operations since only authorized users access the dashboard. |
| **Backend code (site-side)** | Runs in visitor context | If called from page code or site-side modules, the caller has visitor-level permissions — data must be readable/writable at the appropriate public level. |
| **Backend code (elevated)** | Runs with `auth.elevate()` from `@wix/essentials` | Can bypass permissions, but the collection still needs correct defaults for any non-elevated callers. |

Use `SITE_MEMBER_AUTHOR` on `itemUpdate` / `itemRemove` when members should only modify their **own** items (e.g., a member can edit only their own reviews).

**How to apply this:**

1. **Identify every place the collection is read or written** — custom element widgets, dashboard pages, embedded scripts, backend APIs.
2. **Use the least restrictive context as the floor.** If a custom element widget reads the data AND a dashboard page also reads it, `itemRead` must be `ANYONE` (because the widget is public).
3. **Apply per-operation.** A collection can have `itemRead: ANYONE` (widget displays it) but `itemInsert: CMS_EDITOR` (only dashboard users add items). Each operation is independent.
