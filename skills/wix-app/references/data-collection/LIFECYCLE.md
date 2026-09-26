# Data Collection — getting it onto the site

> Split out of [DATA_COLLECTION.md](../DATA_COLLECTION.md). Declaring a collection is not the same
> as creating one: releasing, updating the site, and the CMS prerequisite all sit here, plus what
> access the extension actually grants.

## Item access and collection management are different scopes

The data-collections extension gives your app read/write access to the **items** in its own
collections — `items.query/insert/update` work with no extra scope. It does **not** grant the
collection-*management* API: `collections.listDataCollections()` and friends answer 403 unless the
app holds a Data Collections management scope.

That asymmetry is worth knowing before you debug: a page whose table loads rows has proved its
collection exists, because Wix Data errors on a missing collection rather than returning empty. If
that same page cannot list collections, the app is missing a management scope — a separate fact
about tooling, not evidence about the collection.

## Reading the collection from a dashboard page

A page over a CMS collection uses the **schema-driven** template, not the hand-wired one — the CMS
already owns the field list, so `useCmsSchemaSource` supplies fetch, filters, columns and the
entity form from it. See
[DRAFT_TEMPLATE_CMS_COLLECTION.md](../dashboard-page/DRAFT_TEMPLATE_CMS_COLLECTION.md). Wiring
`items.query()` and hand-written columns by hand still compiles, and quietly gives up everything the
schema would have provided.

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
