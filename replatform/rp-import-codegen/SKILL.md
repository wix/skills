---
name: rp-import-codegen
description: >-
  Generates migration readers, transforms, and Wix writers from schema and mapping
  artifacts. Use when producing runnable extract/import code under the migration project.
---

# rp-import-codegen

Generate source readers, transforms, and Wix writers from approved migration artifacts.

## Purpose

This skill turns the schema, mapping, and setup decisions into implementation files under the active migration project.

## Required inputs

- `migrations/<project>/source-schema.json`
- `migrations/<project>/mapping-plan.md`
- `migrations/<project>/setup-requirements.md` when setup affects write paths

## Source read contract

Generating a correct reader requires platform-specific knowledge — auth model,
pagination, rate limits, and REST quirks. That knowledge lives in the matching **source
adapter** skill, not here, so this skill never names a platform. Resolve the adapter from
the `platform` field in `source-schema.json` via the naming convention `rp-source-<platform>`
(e.g. `platform: "wordpress"` → `rp-source-wordpress`) and read its "Read contract"
section. The operational facts should already be recorded in `source-profile.md`; use the
adapter to fill any gaps rather than guessing. `rp-execute-import` runs the reader you
generate and stays platform-agnostic — so the platform specifics must be baked into this
generated code, not deferred to execution.

Adding a new source platform therefore requires no change to this skill: a new
`rp-source-<platform>` adapter is enough.

## Target write contract

Symmetrically, do **not** re-derive the Wix write surface here. It is identical for
every migration and is pre-verified in the **`rp-target-wix`** adapter (sibling skill;
see `CONVENTIONS.md`), which ships
`lib/wix-writers.js` — verified-once request builders + executors for media import,
the Ricos HTML→rich-content converter, Blog categories/tags/draft-posts, Wix Data
items, and Members. **Vendor a copy of `rp-target-wix/lib/wix-writers.js` into the
project** (like the source transport) and generate writers that **call its primitives**,
supplying only per-project field maps. Never hand-emit Wix endpoints/bodies inline —
that path repeatedly shipped wrong shapes (lowercase Ricos plugin enums, `{tag:{…}}`
tag bodies, `media.wixMedia.image.id` featured images) that only failed at execution.

**Validate by real call, not by doc example.** MCP doc checks confirm an endpoint
*exists*; they do not confirm the request *shape works* — public examples have been
wrong (FR-007). Trust a Wix request shape only once a real call (or
`rp-target-wix/scripts/contract-test.js` in live mode, run from the `rp-target-wix` skill
directory) has succeeded. Treat the
adapter's `// VERIFIED:` shapes as the source of truth over any docs example.

Adding a new source platform requires no change here, and the Wix surface change for
*all* migrations is a one-place edit in `rp-target-wix` (caught by its contract test),
not a per-project regeneration.

## Workflow

1. Read the discovery, mapping, and setup artifacts, plus the source adapter's read
   contract and the `rp-target-wix` write contract.
2. Generate source reader code that can enumerate and fetch source entities. If the adapter
   ships a shared transport module (auth, pagination, throttling, retries), vendor a copy of
   it into the project (e.g. `migrations/<project>/src/lib/`) and import from it instead of
   re-emitting that plumbing — the reader should hold only per-project orchestration.
   The reader must extract source records to durable files on disk; it must not require the
   whole source dataset to live in memory before import begins.
3. Generate transform code that maps source records into Wix payloads.
4. Generate writer code that writes to Wix entities or collections — vendor
   `rp-target-wix/lib/wix-writers.js` into `src/lib/` and call its primitives; the
   generated writer holds only per-project field maps + ordering, not Wix API plumbing.
5. Generate the runnable extraction/import entrypoints (see below) — the artifacts
   `rp-execute-import` actually runs. This is required, not optional.
6. Generate an execution plan if batching, checkpointing, or retries are needed.
7. Document any manual code follow-up still required.

## Runnable extraction/import entrypoints — the artifacts are the execution path (required)

`rp-execute-import` runs the import by **executing this artifact**, never by the agent
hand-issuing Wix MCP calls (see that skill's "Execute the generated scripts — never an
agentic MCP flow"). So codegen must emit real, runnable entrypoints:

- **`src/extract-source.js`** or equivalent reader entrypoint — reads the source APIs and
  writes durable extracted files under the project. Extraction is a separate step from
  destination writes, so large migrations can be resumed or re-imported without re-reading
  the whole source.
- **`src/run-import.js`** or equivalent import entrypoint — reads the extracted files,
  applies transforms, and writes to Wix in dependency order through the vendored
  `wix-writers` transport (`fetch` + injected credentials, or the Wix SDK). It must:
  - load project-local config files, then process env, for all expected env-style values
    (never hardcoded; fail fast if absent — do not fall back to any agent/MCP auth),
  - consume extracted source files from disk rather than materializing the entire source in
    memory,
  - apply idempotent dedupe keyed by source ID, using either a client-controlled source-id
    field on the target or a durable `sourceId -> targetId` crosswalk for native Wix
    entities with server-assigned IDs,
  - honor a `--dry-run`/`--sample` flag for the safe-validation pass.
- **The dry-run is the same import code path with writes disabled** — not a separate driver.
  A standalone dry-run that builds request envelopes but never exercises the real
  `fetch`/auth/async-polling path validates code that won't ship.

Extraction format requirements:

- write extracted data to project-local files, not process memory
- chunk by entity and page/batch so a large source does not become one giant file
- write a manifest that lets the import step discover which entity files exist and in what
  order to consume them
- make the extracted files deterministic enough for resume, replay, and debugging

## Project-local config files

Generated code should treat `migrations/<project>/config/` as the canonical home for all
values that are otherwise expected as environment variables. Use simple `.env` syntax and
load these files before reading config:

- `config/wix.env` always exists:

  ```bash
  WIX_SITE_ID=
  WIX_AUTH_TOKEN=
  ```

- `config/source.<platform>.env` exists after the source platform is known. For WordPress:

  ```bash
  WP_BASE_URL=
  WP_USERNAME=
  WP_APPLICATION_PASSWORD=
  WP_MEDIA_URL_REWRITE_FROM=
  WP_MEDIA_URL_REWRITE_TO=
  WC_CONSUMER_KEY=
  WC_CONSUMER_SECRET=
  ```

Codegen rules:

- Generate a small dependency-free config loader in the runnable entrypoint or `src/lib/`.
- Load `config/wix.env` and the selected source config before constructing source/Wix
  clients.
- Real process environment variables may override file values.
- Blank values in config files must not overwrite non-empty process env values.
- If a required key is still missing after loading file + env, fail fast with the key
  name, not a downstream 401.
- Never log secret values. It is okay to log that a key is present/missing.
- Do not generate debug output that dumps config file contents, environment snapshots, or
  request headers carrying credentials.

## Localhost media sources

If the source profile shows `localhost`, `127.0.0.1`, or another private-only source URL,
generated media import code must not assume Wix can fetch those URLs. Wix Media import is
URL-based (`rp-target-wix` import-from-URL primitive), so live media import needs a public
URL reachable by Wix servers. This is optional and, as far as we know today, only affects
media import.

Codegen/runtime should support one of these explicit paths:

- Use a public HTTPS tunnel/source URL for live media import. For ngrok on macOS:

  ```bash
  brew install ngrok
  ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
  ngrok http 8090
  export WP_BASE_URL=https://<id>.ngrok-free.app
  ```

- If the source REST responses still contain local media URLs, generate a configurable
  rewrite from the local base URL to the public tunnel base URL. For WordPress, use
  `WP_MEDIA_URL_REWRITE_FROM` and `WP_MEDIA_URL_REWRITE_TO`; when those are blank, it is
  acceptable to rewrite localhost/private origins to public `WP_BASE_URL`.
- Or generate/allow a media-skip/defer mode and document that media-dependent references
  such as hero images, galleries, and downloadable files will be absent until media is
  imported.

Surface the selected path in `import-plan.md` and the execution plan before any live
write. Do not let a dry-run with localhost media URLs imply live Wix Media import is ready.

## File targets

Write code under the project-local source tree:

- `migrations/<project>/src/readers/`
- `migrations/<project>/src/transforms/`
- `migrations/<project>/src/writers/`
- `migrations/<project>/src/lib/` — vendored shared modules (e.g. the source adapter's
  transport module), copied here so the project runs standalone with no external deps
- `migrations/<project>/src/extract-source.js` or equivalent reader entrypoint — writes the
  extracted source files
- `migrations/<project>/src/run-import.js` — the runnable import entrypoint (required; see
  "Runnable extraction/import entrypoints" above). `--dry-run` drives the safe-validation
  pass through the same import code path.
- `migrations/<project>/data/source-extract/` — extracted source files and manifest(s)
- `migrations/<project>/import-plan.md`

## Verifying Wix APIs

**The primary control is the Target write contract above: call `rp-target-wix`'s
verified primitives when they exist.** That adapter is where each stable shape is
verified-once (by a real call) and where a Wix surface change is fixed in one place.
When Wix has a native entity but `rp-target-wix` does not yet have a dedicated writer,
codegen must generate a Wix REST call for that native entity via the adapter's generic
direct REST helper, log the missing writer, and call the RePlatform notification hook.
Do **not** route to CMS merely because the writer is missing.

- **Prefer the Wix MCP** (the API-docs/schema server) to locate the endpoint and
  request/response shape. If the shape is common enough, add a dedicated primitive to
  `rp-target-wix/lib/wix-writers.js`; otherwise generate a project-local native REST call
  through `sendDirectRest` and mark it `UNVERIFIED`.
- **If the Wix MCP is expected but missing, treat that as a prerequisite gap first.**
  Before falling back to docs, first try to ensure the Wix MCP is installed/connected in
  the current runtime. If the environment supports connector/plugin install flows, use
  them. Otherwise halt to needs-user with exact install/connect instructions for the Wix
  MCP, then resume codegen after it is available.
- **Confirm the shape with a real call, not a doc example** — public examples have been
  wrong (FR-007: lowercase Ricos plugin enums 400). Cover the new primitive in
  `rp-target-wix/scripts/contract-test.js` so drift stays visible.
- **Fallback when no Wix MCP is available:** rely on published Wix REST/SDK docs and
  conservative names only when the user explicitly accepts a provisional path. Mark the
  generated native call `// UNVERIFIED:` until a real call confirms it — never ship an
  unchecked Wix call to a user's live site without surfacing it in the execution plan.

## Runtime policy

Verify each Wix endpoint and field against the Wix MCP at codegen time. The
`// UNVERIFIED:` marker is a fallback only for environments where the MCP is genuinely
unavailable, not a way to ship unchecked calls that fail later on the user's live site.
Anything unverified must be surfaced explicitly in downstream artifacts before execution.

## Missing writer policy

CMS fallback is for source concepts that do **not** have a suitable native Wix entity, or
for native entities explicitly rejected because they cannot preserve fidelity or would
cause unsafe side effects. CMS is **not** a fallback for a missing writer, and it is not a
special default for coupons just because coupon scoping/restrictions need mapping.

When the mapping targets a native Wix entity and no dedicated `rp-target-wix` writer
exists:

1. Generate project-local code that calls the native Wix REST endpoint through
   `sendDirectRest`.
2. Add a clear log line before the first use of that generated REST path.
3. Call `notifyMissingWriter({ sourceEntity, wixEntity, method, path, reason })`. The
   current implementation may be a no-op; the generated code must still call it.
4. Mark the path `UNVERIFIED` in `import-plan.md` and the execution-plan report until a
   live/sandbox call promotes it.
5. Maintain the same idempotency rules as dedicated writers: crosswalk by source ID and
   never dedupe by slug.

## Codegen rules

- Keep reader and writer responsibilities separate.
- Do not generate a read-all-into-memory importer for the general case. The reader extracts
  to disk first; the importer consumes extracted files from disk.
- Make transforms deterministic and testable.
- Preserve **source IDs** for traceability, but do not assume native Wix target IDs can
  be preserved or client-assigned.
- For native Wix entities, generate and use a durable crosswalk (`sourceId -> targetId`)
  whenever the target API does not expose a client-controlled source-id field. Seed it at
  startup via `queryAllDataItems(ImportCrosswalk)` and write a row per created entity, so
  re-runs/continues skip done records. **Slug-based dedupe does NOT work** — Wix rewrites
  slugs (FR-010); never rely on it.
- The canonical collection name is **`ImportCrosswalk`**. If upstream artifacts still say
  `MigrationRefs`, normalize them to `ImportCrosswalk` in the generated code and note the
  normalization in `import-plan.md`.
- **Attach every related entity, don't just create it.** Creating a tag/category is not the
  same as linking it. Blog posts attach tags via `tagIds` (GUIDs) and categories via
  `categoryIds` on the draft-post create — collect the resolved ids and pass them, or the
  taxonomy exists on the site but `postCount` stays 0 (the FR-012 builder bug).
- **Taxonomy creates are not idempotent** (FR-011): treat `409 ALREADY_EXISTS` as success
  AND resolve the existing entity's id (e.g. `listBlogTags`) so it can still be attached —
  don't drop it.
- **Rich text is chunked for you.** `convertHtmlToRichContent` transparently splits HTML over
  the 30k Ricos cap (FR-009) and merges the node arrays; pass full HTML, don't pre-truncate
  or skip large posts.
- Include batching, pagination, logging, and retry hooks where relevant.
- Do not hardcode secrets.

## Output

Summarize which files were generated, which entities they cover, and any remaining implementation gaps.
