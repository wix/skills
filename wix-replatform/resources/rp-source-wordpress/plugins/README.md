# WordPress Plugin Profiles

Declarative, machine-readable profiles describing how to **detect** one WordPress /
WooCommerce plugin and **how to read** its durable business data.

Profile files are the source of truth. `index.json` is generated from them and checked in so
runtime lookups stay token-cheap. `lib/plugin-knowledge.js` is the authority on a profile's
shape; the field reference below documents it.

## What a profile is, and is not

- **It is** detection signals, per-entity read channels, route scope, and pointers to Wix
  target refs.
- **It is not** authoritative about what a route returns. The live `OPTIONS` + sample `GET`
  in `scripts/wp-discovery.js` always is. A profile is *advisory*: a stale one can only make
  detection less complete — it can never cause a wrong read.
- **It does not** hold Wix target behavior. That lives in
  `replatform/resources/rp-target-wix/domains/`. A profile only points at target refs
  (`candidateTargetRefs`) and declares its `capabilities`.

## Recognized or not

A plugin does not need a profile to migrate; it needs one to migrate *natively*.

| Population | What it means |
| --- | --- |
| recognized | a profile matched — named entities, channels, and target refs are known; the mapping is `confirmed` |
| derived | no profile, but the data is REST-visible; the mapping is `proposed` (CMS, or native when the domain KB confirms the proposed capability) |
| named only | detected with no readable channel — lands in *Pending* or on the no-migration-needed list, reported, never silent |

The invariant: **every installed plugin lands in exactly one of the four statuses**
(migration-planned · no-need-to-migrate · pending · requires-development). Authoring a
profile is always an upgrade from a working baseline, never the difference between working
and broken.

### Two states automation may assign, and one only a human may

**By default every plugin is either profiled or pending.** A capability with no resolved Wix
target is *pending*, not impossible.

| State | Means | Assigned by |
| --- | --- | --- |
| migration planned / no need to migrate | resolved to a Wix target — native or CMS — or nothing to move | automation |
| **pending** | we do not know how to migrate this yet | automation — **the default** |
| **requires development** | Wix genuinely has no surface for this | **a named human, only** |

**Why the restriction.** An agent concluded twice that Wix had no target — gift cards and
events — and was wrong both times, because Wix splits capabilities across doc trees and a
service plugin reads like an absent write API. A wrong impossibility is the most expensive
error in this system: it tells a customer to abandon data that could have moved. So automation
is capped at *pending*, and the impossibility verdict needs a name against it.

**Recording pending** — `capabilities-pending-decision.json`, optional but useful: `reason`,
the `searched` evidence, and `suspected` (`target-exists` with a `plannedTarget` to author, or
`no-target` if we think Wix cannot). `suspected` carries **no authority** — a `no-target`
suspicion is still pending until signed.

**Recording a verdict** — `requires-development.json` requires `decidedBy` and
`decidedOn` alongside the search. Validation rejects an entry without them, and rejects any
entry once a target entity claims that capability, so a verdict cannot outlive its truth.

**Recording "nothing to move" for a capability of a profiled plugin** — the `capabilities[]`
register in `no-migration-needed.json`: `capability`, `reason` (`platform-does-it` /
`not-needed` / `reconfigure-in-wix`), `replacedBy`, `rationale`, `decidedBy`, `decidedOn`. The
slug list below cannot carry this (a slug with a profile is rejected there) and
*requires-development* is the wrong verdict when Wix covers the outcome natively — so this is
the third register, and the only way a profiled capability reaches *No need to migrate*
(`basis: decision`). It is not an impossibility verdict, so no recorded search is required,
but it is still signed: unsigned entries fail validation and are ignored at runtime. Mutually
exclusive with the other two registers, and rejected once a target entity claims the
capability.

Unresolved capabilities are deliberately **not** a validation error. Blocking there would push
authors to invent a verdict just to make the build pass — which is the failure this rule exists
to prevent. The coverage report surfaces pending rows and asks a human instead.

### Promotion paths into the recognized population

Two triggers, three possible destinations. Adding a plugin is a data change: no classifier,
discovery, mapper or codegen edit.

| Trigger | Destination | Cost |
| --- | --- | --- |
| **Research phase** — we investigate a plugin we expect to matter | full profile | research doc → profile → target entity → area entry |
| **After a run** — telemetry flags it unresolved, a human reviews it | full profile | same four |
| Either, and it turns out to need **no** data migration | one `no-migration-needed.json` line | one line |

**Order matters: author the target entity before the profile that points at it**, or record the
capability as awaiting a target. Validation enforces this rather than leaving it to memory.

## Read channels

| `channel` | Reads from | Needs |
| --- | --- | --- |
| `plugin-rest` | the plugin's own namespace | sometimes plugin-specific credentials |
| `core-cpt` | `/wp/v2/<rest_base>` | nothing extra |
| `core-embedded` | properties injected into core/Woo records | sometimes `context=edit` |
| `core-meta` | registered meta (`show_in_rest`) | auth for edit-context meta |
| `plugin-rest-child` | a `{parentId}`-templated sub-resource on an already-sampled parent (`route` + `parentRoute`) | nothing extra, but only a representative sample — see SKILL.md |
| `export-file` | a user-supplied WXR / CSV / JSON export | the file |
| `db-only` | plugin custom tables | see "Resolving a db-only capability" below |
| `admin-page-only` | a wp-admin settings page with no REST route at all (config, not records) | human transcription — see below |

**Resolving a `db-only` capability -- try this order, do not default straight to a user file:**

1. **Check whether the plugin exposes a REST route at all.** Confirm live against
   `GET /wp/v2/plugins` and the REST index -- do not assume from the plugin's name or
   marketing copy.
2. **If there is no REST route, check the plugin's own admin UI for a built-in export
   first.** Two `db-only` guesses on this project turned out to have one (Discount Rules'
   CSV export, MailPoet's own REST API) and needed no bridge at all -- an existing native
   export is simpler than authoring a new fulfillment.
3. **Research the plugin's actual storage mechanism** before assuming a bridge can reach
   it: check the plugin's public docs/WordPress.org page, or clone its public GitHub
   source (many WordPress.org plugins are mirrored) and grep for `CREATE TABLE` /
   `dbDelta` (a real custom table) versus `get_option`/`update_option` (`wp_options`) or
   `add_post_meta`/`add_user_meta` (postmeta/usermeta). This determines which of the next
   two steps applies -- guessing wrong wastes a whole fulfillment-authoring attempt.
4. **A genuine custom database table is reachable, with zero user effort, via
   wix-wp-plugin-v2's `structure-bridge-plugin` fulfillment kind (spec 0101/0102) -- try
   this BEFORE falling back to a user-supplied export.** wix-wp-plugin-v2 is this skill
   bundle's own bridge plugin (unlike the retired Wix Migration Helper below, it ships
   with this skill and is meant to be installed on every source site this adapter
   targets). Its `/structure` route describes any live table's real columns; its `/query`
   route reads it with a safe, validated query. Author the profile entity's `blocked[]` as
   `{"kind": "structure-bridge-plugin", "resolution": "<what/why, cite live evidence>",
   "declined": false, "fulfillment": {"kind": "structure-bridge-plugin", "handlerId":
   "wix-wp-plugin-v2", "table": "<bare_table_name>"}}` -- `handlerId`/`table` (and the
   optional `sampleStructureRequest` below) live nested under `fulfillment`, not flattened
   onto the `blocked[]` entry itself; `resolution` and `declined` are required on every
   `blocked[]` entry regardless of kind (see the field reference below). Add
   `sampleStructureRequest` when a raw "every column" read would expose something that needs
   filtering or aggregating -- see `pw-woocommerce-gift-cards.json`'s gift-card-balance
   aggregate for a full worked example of the complete shape.
   See `lib/wix-wp-plugin-v2-client.js`, `scripts/wp-discovery.js`'s
   `sampleStructureBridgeEntities`, and spec 0102's Appendix A for the full contract.

   **Credential split, decided by whether the source site has WooCommerce.** The bridge's
   routes register two ways: an Application Password path gated on
   `current_user_can('manage_woocommerce')`, and a signed migration-key JWT path gated only
   on the signature/request-binding. `manage_woocommerce` does not exist on a WordPress
   site with no WooCommerce installed, not even for an administrator -- on such a site the
   Application Password bridge routes are structurally unusable for every user, so do not
   offer an Application Password as the bridge credential on a content-only/blog/marketing
   WordPress site; collect the migration key (`WMH2_MIGRATION_KEY`) instead. An Application
   Password may still be required separately for private `wp/v2` reads. When a migration
   key is configured, `wp-discovery.js` prefers the signed bridge route; otherwise it uses
   the Application Password route when WooCommerce supplies the required capability.
   Standard private `wp/v2`/`wc/v3` reads still require their own WordPress REST credential;
   the migration key is never a substitute for that scope.
5. **Know which tables the bridge can and cannot reach -- the answer changed with spec 0122.**

   | Table | Reachable? |
   | --- | --- |
   | `wp_options`, `wp_usermeta`, `wp_links`, multisite globals | **No, never.** No unlock path; pinning `option_name` does not help |
   | `wp_postmeta`, `wp_commentmeta`, `wp_termmeta`, `wc_orders_meta`, any `*meta` table, or any table whose live schema carries a recognized key/value column pair | **Yes -- key-scoped.** Key names and counts are freely listable; a value is readable by naming its key (max 50 per request) |
   | A table NAMED like a meta table whose key/value columns are *not* one of the six recognized pairs | **No.** No key column to pin means nothing to scope |
   | Everything else | Yes, in full, minus the named credential columns in `COLUMN_DENYLIST` |

   Row 2 is the one that changed. `wp_postmeta` **is** reachable now, via a two-step read
   (discover key names, then read the keys you want) -- see `rp-source-wordpress/SKILL.md`'s
   "Reading key/value tables through the bridge" for the request shapes. So Flamingo's message
   data, which this list previously called permanently unreachable, is reachable: it is
   `wp_postmeta` on a `flamingo_inbound` CPT. Checkout Field Editor's is not: it is a single
   `wp_options` row (`thwcfe_sections`), and row 1 is unchanged.

   **Do not declare a `user-file` blocker or accept a gap for a `wp_postmeta`-shaped entity
   without checking this first.** Asking a site owner to hand-export data the bridge can read
   is a real cost, and a profile that hard-codes "unreachable" outlives the reason it was
   written. When research in step 3 lands on rows 1 or 3, then yes -- stop, and the remaining
   options are `user-file` or accepting the gap.

The retired Wix Migration Helper plugin (spec 0040/0057) used the same idea -- a
site-installed bridge exposing specifically-named read-only REST routes for `db-only`
data -- but was a bespoke, per-capability plugin the site owner had to install
separately. wix-wp-plugin-v2 replaces it with one generic bridge covering any table,
subject only to the reachability table in step 5; do not author a new profile against the retired
`bridge-plugin` fulfillment kind.

**`admin-page-only` is not the same limitation as `db-only`.** `admin-page-only` means the
*configuration itself* renders only inside an authenticated wp-admin page (e.g.
`wp-admin/admin.php?page=<slug>`), and **WordPress Application Passwords do not
authenticate wp-admin page loads at all** — only REST API requests. VERIFIED against a
live WordPress installation (Discount Rules for WooCommerce's `woo_discount_rules`
settings page): a Basic-Auth request with a valid Application Password 302-redirects to
`wp-login.php?reauth=1`, the standard unauthenticated-session response, identical to what
an anonymous request gets. There is no scrapeable path here — WordPress core does not
extend Application Password auth to admin page rendering, by design.

### Blocked source data and fulfillment

An entity may declare `blocked[]` only for a concrete, evidenced access gap. Every entry needs a
`kind` (`user-file` or `structure-bridge-plugin`), a `resolution` (what/why, citing live
evidence), and a `declined` boolean (whether the user has already declined this ask at
run time -- always `false` at authoring time). `user-file` means the owner must supply or
transcribe data; it does not imply a machine-readable import path. `structure-bridge-plugin`
means wix-wp-plugin-v2 (this skill bundle's own generic bridge -- see "Resolving a `db-only`
capability" above) can read the table directly; its optional `fulfillment` names the
registered `handlerId` and the bare `table` to read (plus an optional `sampleStructureRequest`
-- see the field reference below). A future file handoff uses `fulfillment.kind:
"csv-upload"` with a registered `handlerId` and `expectedInputPath`.

wix-wp-plugin-v2 has no manifest or case registry of its own to check a fulfillment's
readiness against -- unlike the retired, per-capability Wix Migration Helper bridge (spec
0040/0057), which did (`manifestCaseId`, `expectedNamespace`, `extractionRoute`,
`productionReady: true` -- do not author against that retired shape). Authorization for
`structure-bridge-plugin` is a live core-table denylist plus a live `DESCRIBE` check at
request time, not a build-time readiness flag. Markdown specs are never runtime readiness
authorities.

Do not ask the user for their real WordPress account password to work around this — that is a
materially more sensitive credential than an Application Password and outside this pipeline's
secrets model. The correct escalation is the same one already established for other
structurally-invisible config (Checkout Field Editor's custom fields, PW Gift Cards' DB-only
balances): surface it as a `blocked: [{kind: "user-file"}]`-style row at the mapping review
gate and ask the site owner to transcribe or screenshot the specific admin page, since they can
view it directly with their own login.

`core-embedded` matters more than it looks: several major WooCommerce extensions add **no
REST route at all** and only widen `wc/v3/products` / `wc/v3/orders` payloads. Those plugins
are detectable solely from sampled record keys, which is why detection runs a second pass
after sampling.

`plugin-rest-child` is for a sub-resource that needs a known parent id first (e.g.
`/wc/v3/orders/{parentId}/notes`) and so can never be listed as its own flat collection.
`route` carries the literal `{parentId}` placeholder; `parentRoute` names the collection route
(already in scope and sampled) that supplies real ids. See SKILL.md's "Read channels" section
for how presence is checked and why a live per-parent sample is a representative check, not a
completeness claim.

## Adding a plugin

1. Read the vendor's REST documentation and record its URL in `sourceOfTruth`.
2. Create `plugins/<slug>.json` following the field reference below. The filename slug must
   equal `plugin`.
3. Declare detection signals. Prefer `pluginFileIds` and `routes` (high confidence) over
   `restNamespaces` and `assetPathSlugs` (low confidence — `wc/v3` is shared by dozens of
   plugins).
4. Declare one entity per durable record type, each with a `channel` and
   `candidateTargetRefs`. An entity with no target refs must carry a `pitfall` explaining the
   gap.
5. Put helper, runtime, and configuration routes in `excludeRoutes` so the plugin's data
   routes can be opted in without widening scope.
6. Add a fixture: extend `test-fixtures/rest-index-plugins.json` and, if relevant,
   `test-fixtures/wp-plugin-signals.json`, then assert detection in
   `scripts/wp-plugin-contract-test.js`.
7. Regenerate and validate:

```bash
node scripts/plugin-knowledge-validate.js --write-index
node scripts/wp-plugin-contract-test.js
node scripts/wp-discovery-classifier-test.js
```

## Profile field reference

`lib/plugin-knowledge.js` is the **authority** on this shape — there is no `schema.json`, on
purpose: a second non-enforcing definition of the same contract only drifts out of sync.

**Required:** `schemaVersion` (1) · `plugin` (must equal the filename slug) · `displayName` ·
`profileVersion` (bump when the plugin's API changes) · `sourceOfTruth` (vendor docs URL) ·
`capabilities[]` · `detect` · `entities[]`.

**`detect`** — at least one signal required:

| Field | Confidence | Notes |
| --- | --- | --- |
| `pluginFileIds[]` | high | `plugin` values from `GET /wp/v2/plugins`. Matched on the directory too, because the main-file basename often differs (`wordpress-seo/wp-seo`). |
| `routes[]` | high | routes whose presence in the REST index identifies this plugin |
| `restBases[]` | medium | `rest_base` from `/wp/v2/types` or `/wp/v2/taxonomies` |
| `recordProperties[]` | medium | keys this plugin injects into core/Woo payloads; the only way to see route-less extensions |
| `restNamespaces[]` | low | **shared platform namespaces are rejected** — `wc/v3` identifies WooCommerce, not your plugin |
| `assetPathSlugs[]` | low | `/wp-content/plugins/<slug>/`, works with no credentials |
| `minVersion` | — | below it, detection reports `api-below-min-version` rather than assuming the API |

**`entities[]`** — each requires `entity`, `channel`, `candidateTargetRefs[]`. `capability` is
optional for backward compatibility, but required on every entity once any entity in that profile
uses it; it must name one of the profile's `capabilities[]`. This attribution prevents a
multi-capability profile's entities and target refs from leaking into each other's coverage rows.
Then:
**The FIRST `blocker`-severity pitfall across a capability's entities is what the merchant
reads.** `classifyCoverage` uses it verbatim as the coverage row's `userImpact`, and
`buildDispositionRows` joins those into the plugin's `consequence` line. So lead that one with
the consequence in plain words and put the internal instruction after it — an authoring note or
a cross-reference in first position becomes the customer-facing sentence.

`route` (route-bearing channels; a `{parentId}`-templated path for `plugin-rest-child`) ·
`parentRoute` (`plugin-rest-child` only — the already-sampled collection route parent ids come
from) · `responseEnvelope` (route-bearing channels only — `{itemsPath, countPath}` for a
non-standard wrapped response; see below) · `embeddedIn[]` + `propertyPath` (`core-embedded`) ·
`context` (`view`/`edit`/`both`, when the two differ) · `requiresParent` (sub-collection
ordering) · `hierarchical` · `recordKeyField` · `relations[]` · `pitfalls[]`
(`code`/`severity`/`summary`) · `blocked[]` (an evidenced access gap; `kind`, `resolution`,
`declined`, and optional executable `fulfillment`) · `overridesCoreRule`.

**`responseEnvelope`** — for a plugin whose REST route does not return a flat array (or a
single object), and does not advertise `X-WP-Total`/`X-WP-TotalPages` headers. `itemsPath` is
the dot-path to the array of records inside the response body (e.g. MailPoet's
`"data.items"`); `countPath` is the optional dot-path to the true total count when the header
is absent (e.g. `"data.meta.count"` — without it, `recordCount` reflects only the sampled
page, same as a headerless flat array). Sampling and counting otherwise behave exactly as they
would for a flat array once unwrapped — this only changes *where in the response* the sampler
looks.

**Optional top level:** `distribution` · `credentials[]` (plugin-specific keys) ·
`dataRoutePatterns[]` (wholly data-bearing namespaces) · `excludeRoutes[]` ·
`quirks[]`. (`dispositionHint` is retired — a plugin either has a profile or a `no-migration-needed.json` entry, never both.)

## Rules the validator enforces

- `plugin` matches the filename; `schemaVersion` is 1; `profileVersion` and `sourceOfTruth`
  are present (drift provenance).
- Every `candidateTargetRefs` entry resolves in `rp-target-wix/domains/index.json`.
- Every `capability` is claimed by a Wix target entity's `capability` field **or** listed in
  `requires-development.json` with a reason.
- Route-bearing channels declare `route`; `core-embedded` declares `embeddedIn` +
  `propertyPath`.
- A wildcard route pattern keeps at least **two concrete leading segments**: `/ssp/v1/*` is
  allowed, `/yoast/*` is not. This is what stops a profile from silently reopening an
  excluded route family.
- No two profiles claim the same route, and no profile shadows a classifier core rule
  without `"overridesCoreRule": true`.

## Route precedence

Highest to lowest:

1. operator `--exclude-route`
2. profile `excludeRoutes`
3. profile entity routes and `dataRoutePatterns`
4. the classifier's own category rules
5. generic collection-shape acceptance
6. unsupported by default

Profile data routes outrank exclusion families because an explicitly listed route *is* the
per-capability opt-in — bounded by the wildcard rule above.

## Maintenance

- Keep long analysis separate from the profile; profiles carry compact facts and a `sourceOfTruth` link.
- Bump `profileVersion` when a plugin's API changes.
- A capability that keeps resolving as `proposed` across real runs is the signal to
  write a profile for it.
