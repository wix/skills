---
name: rp-source-wordpress
description: >-
  WordPress and WooCommerce source adapter: REST capture, auth, pagination, and read
  contract for codegen. Use when the source platform is WordPress or WooCommerce.
---

# rp-source-wordpress

WordPress / WooCommerce **source adapter**. Owns every WordPress-specific detail the
platform-agnostic skills must not hardcode: how to capture the schema, how to read the
data, auth models, pagination, and REST quirks.

## When this skill is used

This is not a stage in the migration flow — it is a reference consulted by two stages:

- **`rp-discovery`** consults the *Capture* section to sample the source and produce the
  canonical `source-profile.md` + `source-schema.json`.
- **`rp-import-codegen`** consults the *Read contract* section to generate a reader that
  bulk-extracts WordPress data correctly (auth, pagination, `wc/v3` vs `wp/v2`) into
  durable project-local files for the later import step.

`rp-execute-import` never consults this skill — by the time execution runs, the
WordPress-specific knowledge is already baked into the generated reader code. Keeping the
WordPress knowledge here is what lets the rest of the workflow stay platform-agnostic.

## Platform identity

- Source platform: WordPress (core REST `wp/v2`), optionally WooCommerce (`wc/v3`).
- Detect by hitting `<base-url>/wp-json/` — the REST index lists advertised namespaces.
- Set `"platform": "wordpress"` (and note WooCommerce presence in `sourceMeta`) in the
  emitted `source-schema.json`.

## Capture (discovery-time)

Sampling the source to learn its shape — **not** a bulk export.

The Wix domain knowledge base may be used as a classifier supplement during synthesis,
but not as a sampling mandate. When a discovered WordPress/WooCommerce route matches a
known alias, annotate the emitted entity with `sourceMeta.candidateTargetRefs[]`; do not
turn that hint into a target decision here. Keep frontend, theme, runtime, admin, and
transient routes skipped by default even if a knowledge entry exists for a related
setup/config target.

Before capture, verify `migrations/<project>/config/source.wordpress.env`. Create it if
missing with empty values:

```bash
WP_BASE_URL=
WP_USERNAME=
WP_APPLICATION_PASSWORD=
WP_MEDIA_URL_REWRITE_FROM=
WP_MEDIA_URL_REWRITE_TO=
WC_CONSUMER_KEY=
WC_CONSUMER_SECRET=
```

Before requesting any WordPress / WooCommerce credentials for a URL-based migration, ask
the user which data scope they want:

- `public content only`
- `also include private/authenticated data`

This choice is mandatory and must be explicit. Do not ask for `WP_USERNAME`,
`WP_APPLICATION_PASSWORD`, or WooCommerce keys until the user chooses `also include
private/authenticated data`. After that choice, collect sensitive values through
the secure Secrets Manager flow; do not ask the user to paste them into chat.

Key sensitivity is predefined and does not change at runtime. Requiredness is separate
and may depend on the selected acquisition mode or source behavior.

| Key | Sensitivity | Requiredness |
|---|---|---|
| `WP_BASE_URL` | non-sensitive | Required for URL-based capture |
| `WP_USERNAME` | sensitive | Required for private/authenticated WordPress capture |
| `WP_APPLICATION_PASSWORD` | sensitive | Required for private/authenticated WordPress capture |
| `WP_MEDIA_URL_REWRITE_FROM` | non-sensitive | Optional |
| `WP_MEDIA_URL_REWRITE_TO` | non-sensitive | Optional |
| `WC_CONSUMER_KEY` | sensitive | Optional unless WooCommerce rejects the WordPress Application Password for `wc/v3` reads |
| `WC_CONSUMER_SECRET` | sensitive | Optional unless WooCommerce rejects the WordPress Application Password for `wc/v3` reads |

Required for a complete WordPress/WooCommerce capture:

- `WP_BASE_URL`
- `WP_USERNAME`
- `WP_APPLICATION_PASSWORD`

`WC_CONSUMER_KEY` and `WC_CONSUMER_SECRET` are optional when WooCommerce accepts the
WordPress Application Password for `wc/v3` reads; ask for them only if WooCommerce routes
return 401/403 with the WordPress Application Password.

`WP_MEDIA_URL_REWRITE_FROM` and `WP_MEDIA_URL_REWRITE_TO` are optional. Use them when the
WordPress API is reached through a public tunnel but media/file URLs inside records still
point at `localhost` or another private origin. If they are blank, generated readers may
rewrite localhost/private origins to `WP_BASE_URL` when `WP_BASE_URL` is public.

`config/source.wordpress.env` is a secret-bearing file once it may contain real values.
Do not read it with whole-file commands that print its contents into tool output. Check
only whether the file exists and whether each required key is present/blank/missing; when
describing status, name keys only and never echo values.

1. Run the deterministic capture script **from this skill's directory** (the folder
   containing this `SKILL.md`; see `CONVENTIONS.md`):

   ```
   node scripts/wp-discovery.js --env-file <migrations-root>/<project>/config/source.wordpress.env --out-dir <migrations-root>/<project>/data/wp-discovery
   ```

   It walks the REST index, runs one `OPTIONS` + a small `GET` sample per entity, and
   writes per-entity markdown (routes, schemas, sample records, record counts,
   relationships). `--env-file` is the preferred launch path for project-local
   credential-bearing config because it avoids shell sourcing of secret-bearing files.
   Pass direct auth options only when there is no project-local config yet.
   For long runs, pass `--progress-log <path>` and poll it per
   `CONVENTIONS.md#progress-log-polling`.

2. If the user chose `public content only`, run unauthenticated and keep the scope framed
   as public-only. Do not pivot into asking for credentials unless the user changes scope.

3. **Credentials are required for a complete capture.** Without auth, only published
   public content is reachable; drafts, WooCommerce (`wc/v3`), user PII, and private
   fields return 401/403, making their `recordCount`/`inUse` unreliable. The script flags
   this in its README under "Incomplete Capture (Authentication)" — do not treat an
   unauthenticated run as authoritative.

   **Author identity is a specific casualty of public-only capture.** Public
   `/wp/v2/users` lists only users who authored public posts and exposes **no `roles`
   and no emails** — admin vs editor vs contributor vs subscriber is indistinguishable.
   Roles/capabilities require `context=edit` (App Password with `list_users`) or a DB
   dump (`wp_usermeta` → `wp_capabilities`); WXR exports carry author login/email/display
   name but no roles either. Vanilla WP has no guest-byline concept (every byline is a
   user); plugin guest authors (Co-Authors Plus `guest-author` entities) are separate
   non-user records. Record author capture mode in the source profile — it determines the
   blog `authorAttributionMode` downstream (public-only → fallback/owner attribution;
   authenticated → per-author mapping: administrators → owner user-member,
   content roles → per-author members; subscribers/customers → **Wix contacts by
   default** — a contact is the no-login CRM person entity and Contacts V5 upserts in
   bulk — promote to full site members (MEM-01: 1/sec serial, re-registration) only when
   member-gated features are in scope. Every Wix member auto-creates its contact, so
   member-first ordering: never pre-create a contact for someone who will become a
   member. Note contacts cannot author blog posts or comments — bylines need members).

4. Distinguish **supported** entities (advertised by the REST index) from **used**
   entities (those with `recordCount > 0`). Entities advertised but empty should be
   flagged, not mapped as if they hold data.

5. **Backend data scope.** The capture script classifies REST routes before per-route
   `OPTIONS` or sample `GET` requests. By default it samples backend data routes and skips
   frontend, theme/editor, runtime session, admin dashboard, diagnostics, marketplace
   setup, and integration/helper APIs. It writes the skipped-route audit trail to
   `skipped-routes.json`.

   For WooCommerce, prefer canonical durable data APIs such as `wc/v3` over duplicated
   `wc/v2`/`wc/v1` routes for authenticated/private commerce reads. For `public content only`
   discovery, probe public Store API catalog routes before declaring commerce deferred:
   `wc/store/v1/products` and `wc/store/v1/products/categories` are in-scope public
   commerce data when present. Cart and checkout Store API routes remain out of scope as
   runtime session state.

6. **Plugin coverage runs automatically.** Plugin handling is a deterministic pre-pass plus
   declarative profiles, not prose guesswork — see "Plugin coverage" below. The capture
   script writes `plugin-inventory.json` and `plugin-coverage.json` alongside the per-entity
   files. Never hand-map a plugin from memory; consult the profiles through
   `scripts/plugin-knowledge.js`.

7. **Localhost sources and media URLs.** A source at `localhost`, `127.0.0.1`, or another
   private-only host is valid for discovery and source reads from the user's machine.
   However, Wix Media import fetches files from the URL using Wix servers, so media URLs
   like `http://localhost:8090/wp-content/uploads/...` are not reachable by Wix during a
   live import. This is optional setup and, as far as we know today, only affects media
   import:
   - Prefer exposing the local source through a temporary public HTTPS tunnel such as
     ngrok before live media import.
   - Or explicitly skip/defer media import and continue with non-media entities.
   - If using ngrok on macOS:
     1. Install: `brew install ngrok`
     2. Add an authtoken from the ngrok dashboard:
        `ngrok config add-authtoken "<YOUR_AUTHTOKEN>"`
     3. Expose the local source port, for example: `ngrok http 8090`
     4. Set the source base URL to the HTTPS forwarding URL:
        `export WP_BASE_URL=https://<id>.ngrok-free.app`
   Record this in `source-profile.md` when the captured source URL is localhost, and note
   whether media will use the tunnel or be skipped/deferred.

The raw capture is evidence, not a hand-off artifact. `rp-discovery` synthesizes it into
the canonical artifacts and records traceability pointers (`rawDiscovery`, per-entity
`rawFile`).

## Plugin coverage

A real WooCommerce site is mostly plugins. Handling them is deterministic and has its own
knowledge base: `plugins/` (profiles + `no-migration-needed.json` + `README.md`), read through
`scripts/plugin-knowledge.js`, detected by `scripts/wp-plugin-inventory.js`.

**Every installed plugin lands in exactly one of the four statuses, and every status
produces a row the user sees. Nothing is silently ignored.**

| Population | Evidence | Result |
| --- | --- | --- |
| recognized | a profile matched | named entities, declared read channels, Wix target refs; mapping `confirmed` |
| derived | no profile, data is REST-visible | derived from `wp/v2/types` + `wp/v2/taxonomies`, mapping `proposed` (CMS, or native on a domain-KB match) |
| named only | detected, no read channel | *Pending* with its reason, resolved by the no-migration-needed list or at the review gate |

A plugin therefore does not need a profile to migrate — it needs one to migrate *natively*.

### Detection

Runs before route classification so profile-declared routes are already in scope. Signals,
strongest first:

1. `GET /wp/v2/plugins` — the authoritative installed list (`plugin`, `status`, `name`,
   `version`). **Administrator credential required.** On 401/403 the run continues and
   records `pluginListAvailable: false`; say so plainly rather than implying full coverage.
   Without it, installed-but-unprofiled plugins cannot be enumerated at all — this is the
   concrete argument for the authenticated acquisition mode.
2. Declared routes present in the REST index.
3. `GET /wp/v2/types` / `GET /wp/v2/taxonomies` entries matching a profile's `restBases`.
4. **Record payload keys from the samples** — a second pass after sampling. This is not
   optional polish: several major WooCommerce extensions (Product Bundles, Composite
   Products, Product Add-Ons, ACF, Yoast) add **no REST route at all** and only widen
   `wc/v3/products` / `wc/v3/orders` payloads. Route-based discovery cannot see them.
5. REST namespaces and public `/wp-content/plugins/<slug>/` asset paths (low confidence,
   but they work with no credentials).

A plugin version below a profile's `detect.minVersion` is reported as
`api-below-min-version`, not read as if the documented API were present.

### Read channels

`plugin-rest`, `core-cpt`, `core-embedded`, `core-meta`, `plugin-rest-child`, `export-file`,
`db-only` — see `plugins/README.md`. Two consequences worth stating to the user:

- **Unregistered post meta is invisible.** WordPress exposes meta only when the plugin
  registered it with `show_in_rest` (and, for a CPT, declared `custom-fields` support). A
  plugin can keep its entire per-record state in `postmeta` and expose none of it. That data
  is reachable only from a WXR export or the database.
- **WXR cannot be fetched.** Application Passwords authenticate the REST API and XML-RPC
  only, never `wp-admin`, so an export file is something the **user produces and supplies**.
  Treat `export-file` as a request to the user, never as a download.
- **Parent-scoped sub-resources (`plugin-rest-child`, fixed 2026-08-11).** WooCommerce order
  *notes* (`/wc/v3/orders/{id}/notes`) and similar per-parent sub-collections cannot be listed
  on their own — the base classifier only samples flat collection routes (`page`/`per_page`
  shape). This is why a plugin that writes real data via `$order->add_order_note(...)` (e.g.
  Custom Payment Gateway for WooCommerce's payment-note field) used to report as
  `pending · cannot-tell` even though the data is real and REST-reachable in principle.
  `plugin-rest-child` fixes this: an entity declares `route` as a `{parentId}`-templated path
  (`/wc/v3/orders/{parentId}/notes`) plus `parentRoute` (the already-sampled collection that
  supplies real parent ids, e.g. `/wc/v3/orders`). Availability is a two-part **presence**
  check against the site's REST index — `parentRoute` is in scope, and the index advertises a
  route shaped like the template (WordPress's `(?P<id>[\d]+)`-style regex segments are
  normalized to `{parentId}` for the comparison, so the parameter's name never has to match).
  Presence alone does not confirm real data exists there: `wp-discovery.js`'s
  `sampleChildEntities` runs a **live, representative check** afterward — it substitutes up to
  3 already-sampled parent ids into the template and fetches each, purely to say "N of 3
  sampled parents actually returned something," not to claim a full count. That result surfaces
  as a plain-language run note, never as a channel-status change: a small sample coming back
  empty does not mean the capability is absent, only that this sample did not confirm it.
  The infrastructure is
  built and tested (`plugin-knowledge.js`, `wp-route-classifier.js`'s `childRouteAdvertised`,
  `wp-plugin-detect.js`'s `describeProfiledEntity`, `wp-discovery.js`'s `sampleChildEntities`),
  and `plugins/woocommerce-other-payment-gateway.json` is authored and live-verified against
  the reference store (a real order id substituted into the template found 2 of 3 sampled orders had
  matching notes) — do not guess a plugin's installed-directory id when authoring a similar
  profile; confirm `detect.pluginFileIds` against a live `GET /wp/v2/plugins` response first, it
  is exactly the kind of fact a stale or invented guess silently gets wrong.
- **Non-standard response envelope (`responseEnvelope`, fixed 2026-08-11).** Sampling and
  counting assume a flat array (`X-WP-Total`/`X-WP-TotalPages` headers, or the array's own
  length) or a single object. MailPoet's REST API (`/mailpoet/v1/subscribers`,
  `/segments`, `/newsletters`, ...) broke that assumption: it is a real, paginated, GET-only
  REST route (VERIFIED LIVE 2026-08-11: 306 real subscribers on the reference store, readable with the
  standard Application Password), but the payload is wrapped as
  `{ data: { items: [...], meta: { count, pages } } }` with no `X-WP-Total` header — the count
  lives inside the body instead. Before this fix the whole envelope would have sampled as one
  opaque record. A profile entity (route-bearing channels only) now declares
  `responseEnvelope: { itemsPath, countPath }` — a dot-path to the array of records, and an
  optional dot-path to the true total when there's no header. `wp-discovery.js`'s
  `inspectEntity` unwraps to that path and otherwise treats it exactly like a flat array; a
  path that stops resolving (stale profile, plugin version drift) falls back to the raw payload
  shape and records a discovery note rather than failing the run.
  `plugins/mailpoet.json` is authored and live-verified against the reference store: `crm.email-subscription`
  now resolves to migration-planned via the existing `crm/email-subscription` target, with
  `recordCount: 306` read via the declared `countPath`. A namespace-wide `unprofiledRoutes`
  entry is still a sign a route this shape (or any other) has never been profiled — check there
  before concluding a plugin has "no REST surface."
- **Route default query (`ROUTE_DEFAULT_QUERY_RULES`, fixed 2026-08-16).** Sampling sends
  `per_page` and nothing else, so any collection route that applies a **default filter to an
  unparameterized request** is read as its filtered subset and the plan under-counts — the
  hidden records are invisible to the mapper, not merely misreported. Observed on
  `/wc/v3/products/reviews`, which defaults to `status=approved`: the reference store has 120 reviews (114
  approved + 6 on hold) and discovery counted 114. This is a class of bug, so the fix is a
  table rather than a special case: `wp-route-classifier.js` carries
  `ROUTE_DEFAULT_QUERY_RULES` — `[pattern, params, reason]`, `*`-suffix matching, longest
  pattern wins — and `defaultQueryFor(routePath)` / `defaultQueryReasonFor(routePath)` resolve
  it. `wp-discovery.js` merges the result under its paging parameters and records a discovery
  note naming the parameters and the reason, so generated readers know to send them too.
  Adding a route is one row in the table plus a fixture; a route with no row is unchanged.

### Coverage statuses

The four statuses, and only the four: `migration-planned` (via `api` or `cms`,
confidence `confirmed` or `proposed`), `no-need-to-migrate`, `pending`,
`requires-development`. A failed or unavailable read is never a status — it attaches to the
row as `blocked[]` (`user-file` / `surface-changed`, with a `declined` flag).

The split is deliberate: `pending` (we do not know how to migrate this yet — our open item)
and `requires-development` (a human established Wix has no surface) call for different
conversations. Only the second is a closed door, and only a human may open it — the
human-signed register `plugins/requires-development.json` is its single source.

### Interaction rules

- **The admin Application Password is the only source credential.** A plugin REST namespace
  that honours WordPress authentication works with it, and that is the normal case — plugins
  with their own key systems offer them as an *alternative* for external callers, not a
  requirement (verified for Gravity Forms, which accepts Application Passwords and runs
  requests under the caller's plugin capabilities). Do **not** treat "this plugin has API
  keys" as "we need another credential"; that reasoning has been wrong every time it was
  applied. If a plugin genuinely rejects the platform credential, that is a config-gate
  requirement like the WooCommerce consumer keys — not a per-capability runtime state.
- `blocked[]` entries are collected and asked **once**, batched, each individually
  skippable. A `user-file` blocker is the one state no credential can fix: unregistered post
  meta and plugin tables are unreachable by any WordPress API, and Application Passwords
  cannot reach `wp-admin`, so a WXR or CSV export must be produced by the user. Record each
  answer in `orchestration/decisions.json` under `pluginBlocker:<capability>:<kind>`
  (`provided` / `declined`); `wp-discovery.js` reads it back (`--decisions`, defaulting to
  `<out-dir>/../../orchestration/decisions.json`) so a declined ask renders as declined.
- `migration-planned · proposed` rows never block; the proposed capability and target are
  reviewed at the normal mapping-review checkpoint.
- `requires-development` and `pending` rows **must** reach the user. A detected but
  undeliverable capability the user was never told about is the failure this machinery
  exists to prevent. Every `pending` row is decided at the mapping review — the only exit.

**A recognized plugin always ends in Migration planned** (J2 property 1). If a profile
matched we know what the plugin holds, so:
- no readable channel (plugin tables only) → still classified by its target, with a
  `user-file` blocker on the row — **not** pending, and never a "cannot" verdict. A database
  export or a source-side bridge would reach it, and automation may not foreclose that any
  more than it may declare Wix incapable.
- `pending · cannot-tell` is reserved for an **unrecognized** plugin where we genuinely
  found nothing; the no-migration-needed list or the agent's own reading can
  still resolve it to *No need to migrate* with a recorded rationale.

**A CMS destination is not turnkey.** "Kept as data" means the records land in a Wix CMS
collection with their original IDs — genuinely migrated, not documented. But Wix Data must be
installed first (item writes fail with `WDE0110` otherwise) and collection creation has no
verified writer yet, so it is a setup step. Say both on the row; a customer reading "Kept as
data" should not discover the setup work later.

### Guardrails

- **Never a silent native mapping.** A derived entity may target a native Wix entity
  only when the Wix domain knowledge confirms its proposed capability; otherwise it goes to
  CMS. Either way the row is `confidence: proposed` and is confirmed at the mapping review.
- **Never a scope reopening.** The generic path operates only on routes the route classifier
  already accepted. It does not resurrect frontend, editor, admin, runtime, or integration
  families because a plugin registered them.
- Profile data routes outrank exclusion families (that is the per-capability opt-in), but a
  wildcard pattern must keep two concrete leading segments, so `/yoast/*` can never be
  opted in wholesale.

### Commands

```bash
node scripts/plugin-knowledge.js list-plugins
node scripts/plugin-knowledge.js read-plugin --slug the-events-calendar
node scripts/plugin-knowledge.js resolve-route --route /tribe/events/v1/events
node scripts/plugin-knowledge.js resolve-property --property bundled_items
node scripts/plugin-knowledge.js list-capabilities
node scripts/wp-plugin-inventory.js --base-url <url> --out-dir <dir> [auth options]
node scripts/plugin-knowledge-validate.js --write-index
```

To add or correct a plugin, edit `plugins/<slug>.json` and add a fixture — no skill logic
changes. See `plugins/README.md`.

## Read contract (codegen-time)

What a generated WordPress reader must get right. Capture the operational facts below into
`source-profile.md` during discovery so codegen has them without re-deriving.

The generated reader is an **extractor**, not an in-memory bulk loader. It should fetch
WordPress/WooCommerce records page by page and write them to project-local files (for
example per-entity paged JSON files plus a manifest) so the import step can read from
disk later without re-fetching the source.

**Reuse the shared transport — do not regenerate it.** The auth, URL building, rate-limit
throttling, and `Retry-After`-aware 429/503 backoff a reader needs already exist as a
dependency-free module at `lib/wp-http.js` in **this skill directory** (the same module
the capture script imports). It
exports `fetchJson`, `buildHeaders`, `configureRateLimit`, and `parseTotalHeader`. Any
generated WordPress reader **must reuse this module rather than reimplementing transport**,
so the reader contains only per-project orchestration: which entities to pull, the
pagination loop, `_embed`/`_links` resolution, and transform glue. One tested transport
core is what makes the sampler and the reader behave identically. *How* the module is
carried into a runnable migration project is `rp-import-codegen`'s concern (its File
targets), not this adapter's. The notes below describe what the reader does *on top of*
that shared core:

- **Namespaces & auth differ per namespace:**
  - `wp/v2` (core): HTTP Basic auth with a WordPress **Application Password**
    (`--username` + `--application-password`).
  - `wc/v3` (WooCommerce): **consumer key / secret**, sent as Basic auth over HTTPS (or
    as query params on some hosts). This is a different credential from the Application
    Password — both may be needed for a full migration.
- **Pagination:** `?page=N&per_page=M` (max `per_page` is typically 100). Total pages are
  in the `X-WP-TotalPages` response header and total records in `X-WP-Total` — read
  those rather than guessing when to stop. Some public WooCommerce Store API collection
  routes paginate without `X-WP-TotalPages`; when that header is absent, generated readers
  must stop on the first page whose item count is smaller than `per_page`.
- **Embedded relations:** request `?_embed` to inline related resources, or follow the
  `_links` block (`author`, `wp:featuredmedia`, `wp:term`) to resolve relations. The
  `evidence` pointers in `source-schema.json` relations come from this `_links` block.
- **Hierarchical taxonomies:** WordPress categories (and custom hierarchical taxonomies)
  carry a `parent` field on each term (`0` = top-level). When **any** term has a non-zero
  `parent`, the source taxonomy is nested. Discovery must elevate this into structured
  schema — set `"hierarchical": true` on that entity in `source-schema.json` (see
  `source-schema.example.json` → `category`) rather than leaving `parent` buried in the raw
  dump. The Wix Blog category target is flat (no parent/child), so this flag is what triggers the
  mapper's mandatory lossiness entry; without it, the flatten happens silently.
- **Rate limits / retries:** not advertised; the capture script throttles
  (`--rate-limit-rpm`, default 120) and backs off on 429/503 honoring `Retry-After`.
  Generated readers should inherit the same discipline.
- **Rich content:** `content.rendered` / `title.rendered` are HTML; `*.raw` requires
  `context=edit` (authenticated). Note which the reader should pull.
- **HTML entities in "plain text" fields (trap, hit live 2026-07-19):** WordPress returns
  HTML-encoded entities (`&#8211;`, `&amp;`, `&#8217;`, …) not only in rendered HTML but
  also in fields consumed as plain text — product/category/tag `name`, `title.rendered`
  after tag-stripping, excerpts, even SKUs. Values sent to plain-text Wix fields (product
  name, blog title, tag label, CMS text columns) must be entity-decoded by the generated
  transforms or the encoded form appears verbatim in the Wix dashboard. HTML passed to
  rich-content conversion does NOT need pre-decoding — the converter handles entities.
- **Custom fields:** ACF / meta often appear in sample records but are absent from the
  `OPTIONS` schema — surface them as `unknowns` in discovery so the mapper can decide.
- **WooCommerce variation attribute values are URL-encoded slugs, not display names (trap, hit live 2026-07-21):**
  `variations[].attributes[].value` from `wc/v3/products/{id}/variations` is a URL-encoded
  taxonomy-term slug (e.g. `1-%d7%a7%d7%92` for `1 ק"ג`), not the human-readable display
  name that the product's `attributes[].options[]` array contains. Generated readers must
  build a per-option slug→displayName map from the parent product's `attributes[].options[]`
  (which does carry display names) and resolve slug values to display names before writing to
  Wix. Passing slugs directly causes `MISSING_VARIANT_OPTION_CHOICE` because Wix compares
  variant choice names against option choice names and finds no match.
- **WooCommerce "Any"-style variations have null attribute values (trap, hit live 2026-07-21):**
  When a WooCommerce variation is set to "Any" for an option (the variation applies to any
  value of that option), `variations[].attributes[].value` is an empty string or null, not a
  specific term. Generated transforms that filter variants by attribute value will silently
  drop "Any" variants, leaving options with no variants — Wix then auto-generates priceless
  placeholder variants, causing price-empty errors. Fix: when ALL attributes for a variation
  are null/"Any", treat the variation as a single cartesian entry covering all option choices
  at the variation's price, rather than filtering it out.
- **Route paths passed to `fetchJson` / `buildApiUrl` must NOT include `/wp-json` (trap, hit live 2026-07-21):**
  `buildApiUrl` in `lib/wp-http.js` already prepends `/wp-json` to the `routePath` argument.
  Generated route paths must start with the namespace directly (e.g. `/wc/store/v1/products`,
  `/wp/v2/posts`) — never with `/wp-json/...`. Prefixing with `/wp-json` doubles the prefix
  and produces 404s.
- **WooCommerce consumer key/secret can 401 on some `wc/v3` routes even when it reads others
  fine (trap, hit live 2026-08-12):** `WC_CONSUMER_KEY`/`WC_CONSUMER_SECRET` are scoped at
  key-creation time (Read / Write / Read-Write) and can be narrower than the WordPress
  Application Password's access. On the reference store, the consumer key/secret 401'd
  `woocommerce_rest_cannot_view` on `wc/v3/taxes`, `wc/v3/taxes/classes`, and
  `wc/v3/settings/tax` while the very same reads succeeded immediately with the
  `WP_USERNAME`/`WP_APPLICATION_PASSWORD` Basic auth pair. Generated readers must not treat a
  401/403 on one `wc/v3` route as proof the whole consumer key is broken (which would wrongly
  block products/orders/coupons too) — retry that specific route with the Application Password
  credential before failing, and prefer the Application Password outright for admin-ish
  `wc/v3` routes (taxes, settings) that a narrowly-scoped key is more likely to be denied on.
- **Core WooCommerce settings/tax routes are core, not plugin data:** `wc/v3/taxes`,
  `wc/v3/taxes/classes`, and `wc/v3/settings/tax` are ordinary WooCommerce core collections
  (same auth/pagination rules as `wc/v3/products` etc.) — they are not profiled as a "plugin"
  because tax is core WooCommerce, not an extension. Per-product `tax_status`/`tax_class`
  fields ride along on the ordinary `wc/v3/products` read; no separate per-product route is
  needed to get them. See `rp-target-wix` domains/tax/ for the corresponding Wix target
  entities (Tax Group / Tax Region / Manual Tax Mapping / Tax Settings) and mapping-plan.json's
  `product` and `tax-class` entities for a live worked example (migrations/reference-run, 2026-08-12).

## Schema shape

`source-schema.example.json` (in this skill folder) is the template `rp-discovery` follows
when emitting `migrations/<project>/source-schema.json`. It is a shape to follow, not a
strict schema to validate against. Keep the platform-agnostic core stable; push WordPress
quirks (`restNamespace`, statuses, etc.) into each entity's open `sourceMeta` blob.

For a profiled plugin entity, `sourceMeta` MUST also carry `requestMethod`, `requestBody`,
and `responseFragmentGroupSize` verbatim whenever the plugin profile declares them (spec
0044/0045) — copy them from the profile entity (surfaced structurally in plugin detection's
per-entity output, `wp-plugin-detect.js`'s `describeProfiledEntity`) rather than re-deriving
them from discovery's prose notes. `rp-import-codegen`'s read contract depends on finding
these under exactly those `sourceMeta` keys; omitting them silently degrades a declared
non-GET/fragmented read into an unreadable one downstream.
