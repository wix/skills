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
missing, using empty values for the user to fill:

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
private/authenticated data`.

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
   node scripts/wp-discovery.js --base-url <url> --out-dir <migrations-root>/<project>/data/wp-discovery
   ```

   It walks the REST index, runs one `OPTIONS` + a small `GET` sample per entity, and
   writes per-entity markdown (routes, schemas, sample records, record counts,
   relationships). Pass auth options (see Read contract → Auth) for a complete capture.
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

6. Map known plugins to entity types where relevant (e.g. WooCommerce → store,
   Seriously Simple Podcasting `ssp/v1` → podcasts, Yoast → SEO, ACF → custom fields).

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

## Schema shape

`source-schema.example.json` (in this skill folder) is the template `rp-discovery` follows
when emitting `migrations/<project>/source-schema.json`. It is a shape to follow, not a
strict schema to validate against. Keep the platform-agnostic core stable; push WordPress
quirks (`restNamespace`, statuses, etc.) into each entity's open `sourceMeta` blob.
