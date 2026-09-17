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
  emitted `source-schema.json`. This describes the discovery artifact, not the orchestration
  decision.
- Once discovery confirms WooCommerce, record `sourcePlatform=woocommerce` in the
  orchestration decision and use `config/source.woocommerce.env`. Otherwise record
  `sourcePlatform=wordpress` and use `config/source.wordpress.env`. The adapter remains
  `rp-source-wordpress` in both cases.

## Capture (discovery-time)

Sampling the source to learn its shape — **not** a bulk export.

The Wix domain knowledge base may be used as a classifier supplement during synthesis,
but not as a sampling mandate. When a discovered WordPress/WooCommerce route matches a
known alias, annotate the emitted entity with `sourceMeta.candidateTargetRefs[]`; do not
turn that hint into a target decision here. Keep frontend, theme, runtime, admin, and
transient routes skipped by default even if a knowledge entry exists for a related
setup/config target.

After identifying the platform, verify `migrations/<project>/config/source.<platform>.env`.
For a confirmed WooCommerce source, this is `source.woocommerce.env`; for WordPress without
WooCommerce evidence, it is `source.wordpress.env`. Create the selected file if missing with
empty values:

```bash
WP_BASE_URL=
WP_USERNAME=
WP_APPLICATION_PASSWORD=
WMH2_MIGRATION_KEY=
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
private/authenticated data`. Request `WMH2_MIGRATION_KEY` only when bridge-backed entities
are actually in scope and the detected source has no WooCommerce. Collect every sensitive
value through the secure Secrets Manager flow; do not ask the user to paste it into chat.

There are two independent scopes, and a complete run may need both credentials:

- **Private WordPress/WooCommerce REST** (`wp/v2`, `wc/v3`) requires a WordPress
  Application Password (`WP_USERNAME` + `WP_APPLICATION_PASSWORD`).
- **`wix-wp-plugin-v2` bridge reads** use the Application Password path only when
  WooCommerce is present, because that route requires `manage_woocommerce`. When the
  source has no WooCommerce, collect `WMH2_MIGRATION_KEY` for bridge reads instead. The
  key is generated and shown once on the plugin's wp-admin page at activation or rotation.
  It never authenticates ordinary `wp/v2` or `wc/v3` reads.

Key sensitivity is predefined and does not change at runtime. Requiredness is separate
and may depend on the selected acquisition mode or source behavior.

| Key | Sensitivity | Requiredness |
|---|---|---|
| `WP_BASE_URL` | non-sensitive | Required for URL-based capture |
| `WP_USERNAME` | sensitive | Required for private/authenticated WordPress capture via Application Password |
| `WP_APPLICATION_PASSWORD` | sensitive | Required for private/authenticated WordPress capture via Application Password |
| `WMH2_MIGRATION_KEY` | sensitive | Required for `wix-wp-plugin-v2` bridge reads when the source has no WooCommerce; optional otherwise |
| `WP_MEDIA_URL_REWRITE_FROM` | non-sensitive | Optional |
| `WP_MEDIA_URL_REWRITE_TO` | non-sensitive | Optional |
| `WC_CONSUMER_KEY` | sensitive | Optional unless WooCommerce rejects the WordPress Application Password for `wc/v3` reads |
| `WC_CONSUMER_SECRET` | sensitive | Optional unless WooCommerce rejects the WordPress Application Password for `wc/v3` reads |

Required for a complete WordPress/WooCommerce capture:

- `WP_BASE_URL`
- `WP_USERNAME` + `WP_APPLICATION_PASSWORD` when private REST-visible data is in scope
- `WMH2_MIGRATION_KEY` additionally when bridge-backed entities are in scope and the
  source has no WooCommerce

⚠️ **`WMH2_MIGRATION_KEY` only unblocks the plugin's own `/structure` and `/query` routes**
(`wix-wp-plugin-v2`'s `structure-bridge-plugin` entities — custom plugin tables with no REST
route, spec 0101/0102) — `wp-discovery.js`/`wix-wp-plugin-v2-client.js` sign requests with it
automatically when the signed bridge path is selected. It does **not** authenticate
standard WordPress/WooCommerce REST (`wp/v2`, `wc/v3`) at all — reading posts, pages,
products, orders, customers, and every other REST-visible entity still requires the
Application Password. On a source site with no WooCommerce, the Application Password routes
are `manage_woocommerce`-gated and unusable by any user regardless, so the migration key is
the only credential that reaches the bridge. If no separate WordPress REST credential is
available, ordinary private content still cannot be captured through this adapter and needs
another source API or export.

`WC_CONSUMER_KEY` and `WC_CONSUMER_SECRET` are optional when WooCommerce accepts the
WordPress Application Password for `wc/v3` reads; ask for them only if WooCommerce routes
return 401/403 with the WordPress Application Password.

`WP_MEDIA_URL_REWRITE_FROM` and `WP_MEDIA_URL_REWRITE_TO` are optional. Use them when the
WordPress API is reached through a public tunnel but media/file URLs inside records still
point at `localhost` or another private origin. If they are blank, generated readers may
rewrite localhost/private origins to `WP_BASE_URL` when `WP_BASE_URL` is public.

`config/source.<platform>.env` is a secret-bearing file once it may contain real values.
Do not read it with whole-file commands that print its contents into tool output. Check
only whether the file exists and whether each required key is present/blank/missing; when
describing status, name keys only and never echo values.

1. Run the deterministic capture script **from this skill's directory** (the folder
   containing this `SKILL.md`; see `CONVENTIONS.md`):

   ```
   node scripts/wp-discovery.js --env-file <migrations-root>/<project>/config/source.<platform>.env --out-dir <migrations-root>/<project>/data/wp-discovery
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

   **Images: never read a field, always resolve.** An image reference in a WordPress-family
   payload is a *set* of candidate URLs for one picture — the merchant's original upload plus
   the crops WordPress generated from it. Which field holds the original varies by route, and
   the two WooCommerce APIs disagree on the **same site**: on `wc/store/v1` `images[].src` is
   the original, while on `wc/v3` it is resolved through WordPress's registered image sizes
   and can be the *smallest* crop, because any theme or image-optimizer plugin may redefine
   those sizes. Pass the whole reference to `resolveImageUrl` / `resolveImageUrls` in
   `lib/wp-image-url.js` and use what it returns. It handles `src`, `thumbnail`,
   `source_url`, `srcset`, `thumbnail_srcset`, and `media_details.sizes.*`, prefers the
   original, falls back to the widest crop, and percent-encodes the result.

   ⚠️ This is not optional on the public path just because `src` happens to be right there
   today. Same call, everywhere — a contract test pins the Store API no-op, so a change in
   that behaviour surfaces as a test failure rather than as a merchant's blurry storefront.

   ⚠️ The destination gives one attempt. Wix copies the single URL you send and generates
   every derivative from it, with no way to raise quality afterwards, so a crop shipped here
   is that product's permanent ceiling. When `resolvedIsCrop()` is true the source genuinely
   had nothing better — report those images in the run's own record rather than shipping them
   silently.

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

## Payment gateways: read the summary, never the route

`GET /wc/v3/payment_gateways` and `/wc/v3/payment_gateways/{id}` return each gateway's **entire
settings object**. On a site with a real gateway connected that includes the live API key and
secret. Anything a tool returns is in the model's context, the transcript and potentially a
durable run artifact, so there is no careful-handling mitigation available after the fact — the
value must never be requested.

**`fetchGatewaySummary()` in `lib/wp-http.js` is the only way to read gateway configuration.**
It returns, per gateway, `id` / `title` / `enabled` / `order` and `fields: [{ name, state }]`,
where `state` is `present`, `blank` or `absent` — plus a `value` for the short allowlist of
display and behaviour fields, each of which passes the shared secret-value guard first. That is
everything discovery legitimately needs: which gateways are registered, which are enabled, and
whether a credential is configured. Request-level outcomes (`ok`, `unauthorized`, `unreachable`,
`malformed`) are a separate axis, and a failed request returns **zero** field entries rather
than a page of `absent`, so "this gateway has no API key" can never be confused with "we could
not ask".

Everything else about the route is closed, on purpose:

- `fetchJson()` **refuses** either gateway route before issuing the request, below discovery's
  `--include-route` override. There is no flag, option, capability token or environment variable
  that lifts it; adding one is the exposure with extra steps.
- The route classifier categorizes both shapes as `excluded_credential_bearing`, and neither
  `--include-route` nor `--include-excluded-category` can promote them to `sample`.
- A plugin profile may not declare a gateway route as a readable entity route, under any flag.
- Never write a gateway field value into `source-profile.md`, `source-schema.json`, a sample
  record, a progress log, a completion report, a CMS field, telemetry, or `.local.env`. Never a
  prefix, a length or a hash of one either — each of those is a usable clue on its own.

Report what was read. A run that states "15 gateways, 4 enabled, 6 credential fields present, 0
values retained" is auditable; one that silently read the settings blob is not.
`describeGatewaySummary()` produces that line for the approval gate.

⚠️ The value guard is a pattern list, not a guarantee — a credential in an unrecognized format
passes it. It is the backstop for credentials nobody can name in advance; the controls above are
the actual protection.

## Reading payment, refund and invoice history

Three deterministic registries carry this knowledge. Use them; do not re-derive which source keys
mean what, and do not hand-author the reads.

| What you need | Use |
| --- | --- |
| Which source keys the payments import may read at all | `paymentReadKeys()` in `lib/gateway-source-keys.js` |
| Which value may become a payment's provider transaction reference | `resolveTransactionReference()` in the same module |
| Whether a method is online or offline | `resolveOfflinePayment()` — omits the flag when unknown |
| Whether a refund actually happened | `qualifyRefund()` in `lib/refund-corroboration.js` |
| Whether the store has invoices, and where their bytes live | `lib/invoice-discovery.js` |

**The read manifest is closed.** `paymentReadKeys()` returns the complete set of keys this import
touches — the amount, both paid-date fields, the method, the currency, the canonical reference,
and each registry family's candidate fields. Nothing else is read. In particular a raw provider
response blob is declared **unreadable**, not "to be pattern-matched later": on a live store its
sibling fields carried customer name, phone and email, and a contract that requires parsing
unstructured personal data is not one that can be honoured safely.
`assertNoNeverReadKeys()` refuses a read plan naming it *before* the plan executes — filtering
after the response arrives is too late, the blob is already in the run's working data.

**Two surfaces, and neither alone covers payments.** Row-shaped tables come through the plugin
`/query` surface; meta-backed fields come through WooCommerce REST. Run the generated
`…--<table>.eav-read-plan.json` verbatim and reconcile it afterwards — a hand-authored scoped read
cannot be reconciled against anything, and a plan edited after discovery wrote it is caught by its
own hash.

**A gateway-shaped key is not attribution.** The payment-method slug names the checkout plugin,
not necessarily the processor: on the measured store, orders whose method was one gateway carried
another gateway's reference key, while every order whose method *was* that second gateway carried
none. So a candidate is written only when its semantics are verified AND the registry recognizes
the order's method — directly, or through a separately verified layered integration. Everything
else is reported with a reason and never guessed at by precedence. Report candidate coverage and
defensible coverage as separate numbers; collapsing them overstates fidelity.

**A refund needs a refund record.** A canonical WooCommerce refund entity with a stable id and a
positive amount is authoritative on its own. An order-level refunded status corroborates but
cannot supply a missing amount. Gateway flags, statuses and refundable-balance fields never create
a refund, however many agree — fields written by one callback are one signal. On the measured
store this yields zero importable refunds and 556 reported orders, which is the correct output.

**Invoices are resolved per run.** Discovery matches key *families*, not authored names, and
patterns found in a sample are then applied across the full order population. A discovered
document URL is untrusted input that something is about to fetch: classify it before touching it,
and never log or store it — the query string can be a bearer token and the filename can carry the
customer's name. Nothing found means nothing is created, and the report says "no invoices found",
never "not supported".

Redaction counts are findings, not plumbing: a non-zero `redactedValueCount` means a credential
was sitting somewhere unexpected in the source, and it belongs in the run report. Telemetry
carries counts only — never a discovered key name and never a value.

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

- **Unregistered post meta is invisible to the REST API.** WordPress exposes meta only when
  the plugin registered it with `show_in_rest` (and, for a CPT, declared `custom-fields`
  support). A plugin can keep its entire per-record state in `postmeta` and expose none of
  it. Three ways to reach it, in preference order: the **structure bridge** (see "Reading
  key/value tables through the bridge" below — this is the one that needs no profile and no
  user action), a WXR export the user produces, or a database dump.
- **WXR cannot be fetched.** Application Passwords authenticate the REST API and XML-RPC
  only, never `wp-admin`, so an export file is something the **user produces and supplies**.
  Treat `export-file` as a request to the user, never as a download.
### Reading key/value tables through the bridge

When `wix-wp-plugin-v2` is installed on the source site, `postmeta` and every other
key/value-shaped table is readable — key-scoped. This is the channel to reach for when a
capability would otherwise be a `user-file` blocker, and it is the ONLY one that works for a
plugin nobody has profiled.

**Always run key discovery, even for a profiled plugin.** It is tempting to treat a profile's
`detect.recordProperties` as the key list and skip the round-trip — `subscriptions-for-woocommerce.json`
names `_wps_sfw_product` there — but those are *detection markers*, one or two keys that prove
the plugin wrote the record. They are not the record's field list. Reading only them produces a
short extraction that looks complete, the same failure as a truncated key list.

Profiles earn their place elsewhere: they say which table to read, which entity it maps to, and
what the pitfalls are. The key list comes from the site. A single order on a gateway-backed store
can carry dozens of gateway-specific meta keys under a prefix no profile anywhere has seen, which
is why discovery is the mechanism and not the fallback.

**The rule: if you have not named the keys you want, the value column does not exist.** Not
in `select`, not in `where`, not in `orderBy`, not in `groupBy`. Violating it returns
`wmh2_invalid_structure_request` (400) — the same error as naming a nonexistent column, so
the refusal will not tell you which column is the value column. Two steps:

1. **`GET /structure?table=postmeta`** → the column list plus `eavPair: {keyColumn,
   valueColumn}`. This tells you the table is key-scoped *before* you write a query. No rows,
   no key names.
2. **Discovery** — `select` the key column plus a count, `groupBy` the key column. Returns the
   real key list with row counts, `eavAccess.tier: "key-discovery"`.
3. **Scoped read** — `where` the key column `in` the keys you want (**max 50 per request**),
   then `select` the value column freely. `eavAccess.tier: "key-scoped"`.

```jsonc
// 2. discovery                                  // 3. scoped read
{"structureRequest": {                           {"structureRequest": {
  "table": "postmeta",                             "table": "postmeta",
  "select": [{"column": "meta_key"},               "select": [{"column": "post_id"},
             {"column": "meta_key",                            {"column": "meta_key"},
              "aggregate": "count", "as": "n"}],              {"column": "meta_value"}],
  "groupBy": ["meta_key"],                         "where": [{"column": "meta_key", "op": "in",
  "orderBy": [{"column": "meta_key",                          "value": ["<key from step 2>",
               "direction": "asc"}]                                     "<key from step 2>"]}],
}}                                               "orderBy": [{"column": "post_id", "direction": "asc"}]
                                                 }}
```

⚠️ **Count the KEY column, not some other column.** `{"column": "<keyColumn>", "aggregate":
"count"}` works on any key/value table; counting `meta_id` only works where that column happens
to exist, and a `name`/`value` table has no `meta_id` at all. The generic client counts the
discovered key column for exactly this reason.

Four things that will bite:

- **Page discovery to exhaustion.** `limit` maxes at 200 and a large `postmeta` has more
  distinct keys than one page. Follow `pagingMetadata.cursors.next` until it is null before
  concluding a key is absent — a truncated key list reads as "these are all the keys" and
  will send the mapping down a wrong path. Budget `ceil(N/200)` discovery pages plus at least
  `ceil(N/50)` scoped **batches** — and a batch is not a request: each pages at 200 rows, so a
  batch whose 50 keys hold 4,000 rows costs 20 requests. Because discovery returns each key's
  row count, the read plan states the real figure (`expectedPages` per batch,
  `expectedScopedRequests` overall) — read it there rather than estimating.
- **`options` and `usermeta` are still refused outright**, and pinning `option_name` does not
  unlock `options`. Gateway configuration held in `options` is a different mechanism
  entirely — do not try to route around this.
- **Check `redactionMetadata.redactedValueCount` on every response.** Non-zero means a value
  matched a credential shape and came back as `[REDACTED:secret-shaped]`. That is not a bug
  to work around: it means the source site keeps a credential somewhere unexpected, and it
  belongs in the run's notes.
- **A table named `*meta` whose pair is not one of the six recognized ones is refused (403),
  not readable.** There is no key column to pin, so there is nothing to scope. Reach for a WXR
  export or a database dump for that table, and say so rather than reporting it as empty.
- **A table can carry MORE than one pair**, and each is guarded separately: pinning `meta_key`
  does not make a second pair's `value` column readable. `eavPair.additionalPairs` and
  `eavAccess.additionalPairs` list them; `guardedValueColumns()` in the client returns all of
  them at once, which is what you want when building a select list.

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

- **The admin Application Password is the source REST credential; `wix-wp-plugin-v2`'s
  migration key is scoped to that bridge.** A plugin REST namespace that honours
  WordPress authentication works with the Application Password, and that is the normal
  case — plugins with their own key systems offer them as an *alternative* for external
  callers, not a requirement (verified for Gravity Forms, which accepts Application
  Passwords and runs requests under the caller's plugin capabilities). Do **not** treat
  "this plugin has API keys" as "we need another credential"; that reasoning has been
  wrong every time it was applied. If a plugin genuinely rejects the platform credential,
  that is a config-gate requirement like the WooCommerce consumer keys — not a
  per-capability runtime state. For the structure bridge specifically, select the
  Application Password path only when WooCommerce is present; otherwise use
  `WMH2_MIGRATION_KEY`. Never describe that bridge-only key as private REST authentication.
- `blocked[]` entries are collected and asked **once**, batched, each individually
  skippable. A `user-file` blocker means no *WordPress API* can reach it: unregistered post
  meta and plugin tables are invisible to REST, and Application Passwords cannot reach
  `wp-admin`, so absent anything else a WXR or CSV export must be produced by the user.
  **Check the structure bridge first** — if `wix-wp-plugin-v2` is installed on the source
  site, both of those are readable through it (see "Reading key/value tables through the
  bridge" below), and asking the user for an export they did not need to produce is a real
  cost to avoid. Record each
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

## Product and variation stock

Extract `stock_status`, `manage_stock`, `stock_quantity`, `backorders`,
`backorders_allowed`, and `backordered` from products and every variation. Use
`lib/woo-inventory.js` → `mapWooInventory(record, {parent})` during canonical mapping.
Persist its `fields` on the canonical variant and its disposition beside the source ID.
An untracked product can still be explicitly in stock; `manage_stock:false` is not missing
inventory. Use variation records for variable products; never replicate a parent's shared
tracked quantity onto each child. Preserve `decision-needed` outcomes for missing signals,
backorders, invalid quantities, and shared stock; do not turn them into an empty success.

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
exports `fetchJson`, `buildHeaders`, `configureRateLimit`, and `parseTotalHeader`. It does
**not** export an undenied transport — `fetchJson` refuses payment-gateway routes, and a
generated reader must not reintroduce a raw one. Any
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
- **The store's own configuration must be read DIRECTLY, and with the WordPress credential
  (trap, hit live 2026-09-01):** `/wc/v3/settings/general` holds the business address
  (`woocommerce_store_address`, `_address_2`, `_city`, `_postcode`, `woocommerce_default_country`),
  the currency, which countries the shop sells to, and whether tax is calculated. Two reasons it
  was never captured on any run:
  1. **The REST index advertises only the parameterized form** `/wc/v3/settings/(?P<group>...)`,
     never the literal group route, so nothing in the generic sweep ever fetches it. Read
     `/wc/v3/settings/general` directly, the same way a shipping zone's `/locations` and
     `/methods` sub-resources are — a parent-scoped sub-resource the caller resolves itself.
  2. **The WooCommerce consumer key gets `401 woocommerce_rest_cannot_view` here; the WordPress
     application password gets `200`.** Both are already in every run's source config. A reader
     that only tries the store key gets a plausible "no permission" and moves on — which is
     exactly how this stayed invisible while migrated sites published with an empty business
     address.

  `woocommerce_default_country` is `COUNTRY` **or** `COUNTRY:STATE` (e.g. `US:CA`) — the same
  packing a zone's `state`-type location uses. `rp-target-wix/lib/store-config-build.js` maps the
  whole group; do not hand-roll it.
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

## Coupons, coupon usage and the currency gate

Three source-side decisions, each in a library so a generated importer supplies facts rather than
rules. Read `lib/coupon-discovery.js` and `lib/currency-gate.js`; both are pure.

- **Coupons are counted from one surface and imported from the same one.** `wc/v3/coupons`
  (published) is the discovered set and the denominator; sweep it to exhaustion with
  `sweepCoupons(fetchPage)`, which refuses a total that disagrees with `X-WP-Total`. The `posts`
  count by `post_status` is a reconciliation check only — `summarizeCoupons({ restCoupons,
  postsByStatus })` reports the non-published rows as deliberately excluded, never as a shortfall
  (one reference store: 4,287 posts vs 4,224 via REST, the difference being 62 drafts and 1 auto-draft).
- **Redeemability, not expiry, classifies a coupon.** `classifyCoupon` — redeemable iff not expired
  and not usage-exhausted; **`usage_limit` 0 or empty means UNLIMITED**. A `usage_limit` or
  `usage_count` that is not an integer (`"1.5"`, `"abc"`) is `unresolved`: neither redeemable nor
  exhausted, not written (`coupon-usage-limit-unresolved`), its own partition line. Import all
  published coupons; the report carries the breakdown, never "imported N coupons".
- **Mapping reports rather than approximates.** `mapCouponToWix(coupon, { resolveProduct,
  resolveCategory })` returns a Wix specification or a named refusal: `fgf_free_gift` and any
  unknown `discount_type` are `coupon-type-unmappable`, and so is an **unrestricted
  `fixed_product`** (a per-unit amount on every product; Wix's money-off takes it off the order
  once — a product-scoped one maps); a scope Wix cannot hold in one group is
  `coupon-scope-unmappable`. An exhausted single-use code is imported `active: false`, because
  Wix's usage count starts at zero. An eligibility constraint Wix cannot hold — excluded products
  or categories, a sale-item exclusion, a maximum discount amount, an email restriction, or a
  minimum spend on a product/collection-scoped coupon — is a **refusal** (`coupon-scope-unmappable`,
  reason `scope: constraints`): dropped, each would make the coupon more generous than the
  merchant published. Only a dropped amount on a free-shipping coupon stays a per-coupon finding.
- **Coupon usage rides on the order.** On legacy post storage the surface is the order's REST
  `coupon_lines[]` (measured on a reference store: 8 of 50 recent orders carry them, with
  `discount` per code); HPOS stores have `wc_order_coupon_lookup`. Name whichever was found as
  `coupon-usage-surface`. The target side (`rp-target-wix/lib/order-applied-discount-build.js`)
  turns the lines into `appliedDiscounts` through the coupon crosswalk; an unresolved code writes
  nothing and is reported.
- **Currency halts before any order write.** `currency-gate.js` `evaluateCurrencyGate({
  settingsCurrency, orderCurrencies, targetSiteCurrency })` — settings from
  `wc/v3/settings/general` through `store-currency.js`, order currencies through
  `resolveOrderCurrency` (which decodes `&#8362;` and refuses a contradicting symbol). One
  currency matching the site proceeds with `currency-validated`; a mismatch or a history spanning
  two currencies is a **halt**, and unresolved orders halt too. Two configured currencies with a
  single-currency history proceeds, with the configuration reported.
- **Plan-shaped sources are gated by row counts** (`B1` subscription products, `B2` membership
  CPT, `B3` recurring-plan meta), never by plugin detection. Zero rows on all three — every store
  surveyed so far — reports "no pricing plans found". The gate and the plan body live target-side
  in `rp-target-wix/lib/pricing-plan-definition.js`.

## Currency is a store setting, not an order field

`order.currency` is documented as an ISO 4217 code. Do not trust it. LIVE-FOUND 2026-09-05 on a
real store, every one of 7,297 orders returned `currency: "&#8362;"` — the HTML-encoded shekel
SYMBOL — because a plugin or theme filter had overridden the field. Passed through, the payment
existence gate refuses every payment as a currency mismatch; passed through without a gate it
labels amounts with a symbol.

`lib/store-currency.js` resolves it: `readStoreCurrency()` reads `woocommerce_currency` from
`/wc/v3/settings/general` (one request per run, and the store's own authoritative setting), and
`resolveOrderCurrency(order, storeCurrency)` trusts the order's own value when it is a plausible
ISO code — a multi-currency store legitimately holds several — and falls back to the store setting
when it is not. It reports `order-currency-not-iso` when it falls back, because a store that
mangles this field is a store whose other currency-bearing fields are suspect too.

It never infers a code from a symbol. `$` is at least a dozen different currencies, and guessing
one silently mislabels money.
