---
name: rp-target-wix
description: >-
  Wix target adapter with verified write primitives (wix-writers.js) and contract tests.
  Use when vendoring Wix writers, validating API shapes, or Wix provisioning mechanics.
---

# rp-target-wix

Wix **target adapter**. Owns the Wix-side write surface that every migration shares —
verified once here so the platform-agnostic stages and per-project codegen never
re-derive (and re-break) it. This is the symmetric counterpart to `rp-source-wordpress`:
that adapter owns *reading* a source platform; this one owns *writing* to Wix.

## When this skill is used

Not a stage in the flow — a reference + shared library consulted by:

- **`rp-import-codegen`** vendors `lib/wix-writers.js` into the project (like the
  `wp-http` transport) and generates writers that **call these primitives**, supplying
  only per-project field maps. Codegen does not re-emit Wix API plumbing.
- **`rp-setup-discovery` / `rp-execute-setup`** consult the "Verified endpoints" and
  "Provisioning" notes for app-install / Wix-Data / collection mechanics.

Because the Wix surface is identical across source platforms, adding a new source
(`rp-source-shopify`, …) requires **no change here**.

## Write contract (the verified Wix surface)

`lib/wix-writers.js` exposes pure request builders (`build*Request`) + executors. Shapes
marked **VERIFIED** were validated by a real call against a live site, not just read from
docs. Shapes marked **UNVERIFIED** are docs-schema/MCP-derived bootstrap primitives that
must be surfaced in execution plans until a live contract call promotes them. It also
exports `sendDirectRest` and `notifyMissingWriter` for generated native REST paths when
Wix has a native entity but this adapter does not yet ship a dedicated primitive.

| Capability | Endpoint | Notes / traps |
| --- | --- | --- |
| HTML → rich content | `POST /ricos/v1/ricos-document/convert/to-ricos` | VERIFIED. `options.plugins` enum is **UPPERCASE** — docs example shows lowercase and 400s (FR-007). |
| Import media from URL | `POST /site-media/v1/files/import` | VERIFIED. **Async**: response is `PENDING`; poll `GET /site-media/v1/files/{id}` for `READY` before referencing. |
| Blog category | `POST /blog/v3/categories` | VERIFIED. body `{ category: { label, slug, description } }`. |
| Blog tag | `POST /blog/v3/tags` | VERIFIED. Body is **top-level `{ label, language }`** — NOT `{ tag: { label, slug } }`; slug is derived. |
| Blog post | `POST /blog/v3/draft-posts` → `…/{id}/publish` | VERIFIED. `memberId` **required** (3rd-party). Featured image is **`heroImage.id`** (WixMedia GUID), not `media.wixMedia.image.id`. |
| CMS item | `POST /wix-data/v2/items` | VERIFIED. `{ dataCollectionId, dataItem: { data } }`. Requires Wix Data enabled (else `WDE0110`). |
| Members | `GET`/`POST /members/v1/members` | VERIFIED. dedup by `loginEmail` (gated PII; use a fallback member when absent). |
| Stores product | `POST /stores/v3/products`, `POST /stores/v3/products/query` | UNVERIFIED docs-schema bootstrap. Product payload is project-specific; promote only after sandbox create/query succeeds. |
| Stores product Catalog V1 fallback | `POST /stores/v1/products`, `POST /stores/v1/products/query` | TEMPORARY FR-013 fallback. Use only when the destination site reports `CATALOG_V1`; remove this row and the matching code block when FR-013 is resolved and fresh Stores installs are always Catalog V3. |
| Stores collection Catalog V1 fallback | `POST /stores/v1/collections`, `POST /stores/v1/collections/query` | TEMPORARY FR-013 fallback for Woo product categories on Catalog V1 sites. Use as the native Stores grouping target instead of CMS. Remove with FR-013. |
| Stores category | `POST /categories/v1/categories` | UNVERIFIED docs-schema/project-artifact bootstrap. Confirm destination Stores category semantics before live import. |
| Contacts | `POST /contacts/v4/contacts`, `POST /contacts/v4/contacts/query` | VERIFIED (2026-06-16). V4 list fields are wrapper objects: `emails.items`, `phones.items`, `addresses.items`; arrays directly under `info` return 400. Duplicate handling still depends on `allowDuplicates`. |
| Coupons | `POST /stores/v2/coupons`, `POST /stores/v2/coupons/query` | UNVERIFIED bootstrap. Prefer native Wix coupons because Wix has a native coupon entity; do not special-case coupons into CMS merely for caution or because scoping must be mapped. Fallback is only for source semantics with no native representation. |
| eCom order | `POST /ecom/v1/orders`, `POST /ecom/v1/orders/query` | UNVERIFIED docs-schema bootstrap. Treat as blocked unless setup verification proves historical order creation is side-effect-free. |
| Direct native REST | any Wix REST path derived by codegen | UNVERIFIED generated path for native Wix entities missing a dedicated adapter writer. Must log, call `notifyMissingWriter`, and be shown in the execution plan. |

## Media import source URL reachability

The media primitive imports by URL: Wix servers fetch the provided `sourceUrl`. Public
HTTPS URLs are expected; `localhost`, `127.0.0.1`, Docker-only hosts, and other
private-only URLs are not reachable by Wix during a live import. This is optional source
preparation and, as far as we know today, affects media import only.

If the source system is local, the migration should either:

- expose the source through a public HTTPS tunnel, then pass/rewire media URLs to that
  public base URL; or
- skip/defer media import and clearly state which media-dependent references will be
  missing until media is imported.

Ngrok quick setup for macOS:

```bash
brew install ngrok
ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
ngrok http 8090
export WP_BASE_URL=https://<id>.ngrok-free.app
```

## Validate by real call — do not trust doc examples

Codegen-time MCP doc checks confirm an endpoint *exists*; they do **not** confirm the
request *shape works*. The live wporg-news import proved doc examples can be wrong
(lowercase Ricos plugins → 400) or incomplete (featured image field, tag body). The
rule for this adapter:

- Treat a shape as verified **only after a real call succeeds** — encode the working
  shape here with a `// VERIFIED:` (or `// VERIFIED-TRAP:`) note and a date.
- A `// UNVERIFIED:` primitive is allowed as a bootstrap point for generated code, but it
  is not a silent live-write permission. The execution plan must call it out, and setup
  verification must either promote it with a sandbox/live validation or route to fallback.
- Keep `scripts/contract-test.js` current: it issues one real call per primitive
  against a sandbox site and is the single place schema drift surfaces. Run from the
  `rp-target-wix` skill directory:

  ```bash
  node scripts/contract-test.js
  WIX_AUTH_TOKEN=... WIX_SITE_ID=... node scripts/contract-test.js
  ```

  Run on a cadence and after any Wix API change. A failing contract test — not a stranger's
  broken import — is how we learn the surface moved.

## Temporary Stores Catalog V1 fallback (FR-013)

Remove this section as a whole when fresh Wix Stores installs reliably support Catalog
V3 product writes without the V1 fallback (internal tracking: FR-013).

Fresh Wix Stores installs are expected to become Catalog V3-only. Until Wix Stores fixes
that flow, setup verification may discover a freshly installed Stores site that reports
`CATALOG_V1` when probed through `POST /stores/v3/products/query`. In that case:

- Keep using a native Stores product target; do **not** route products to CMS just because
  the V3 writer is unusable for this site.
- Use the temporary Catalog V1 native REST fallback in `lib/wix-writers.js`.
- Map source product categories to Stores V1 collections on Catalog V1 sites; pass those
  collection IDs to V1 product create as `collectionIds`.
- Log the fallback through `notifyMissingWriter` and surface it in the execution plan as
  an unverified native path.
- Promote the V1 fallback only after a sandbox create/query succeeds, or delete it once
  FR-013 is done.

## What stays in codegen (not here)

Per-project field maps and ordering (which source field → which `data` key, the
media/author/taxonomy ref maps, upsert-by-key) live in the generated transforms/writers.
This adapter holds only the invariant Wix request shapes + transport. Collection names
and schemas (`PodcastEpisodes`, …) are project-specific and come from the mapping plan.

## Provisioning pointers (see rp-execute-setup)

- Apps (Blog, Members) install via the App Installation API; ground `appDefId` from the
  official "Apps Created by Wix" table.
- **Wix Data enablement** (`WDE0110`): install the **Wix Data app `appDefId
  e593b0bd-b783-45b8-97c2-873d42aacaf4`** via the App Installation API; afterward `POST
  /wix-data/v2/collections` creates NATIVE collections with no `WDE0110` (verified live).
  Fallback: a custom app with a data-collections extension (declares collections at
  install time, but can't express REFERENCE fields).

## Scope & coverage

Wix has many apps/entities (Stores, Bookings, Events, Restaurants, Pricing Plans, CRM,
…). This adapter does **not** pre-build all of them. Coverage is **demand-driven** and
grows through reviewed releases. A migration may still target a native Wix entity before a
dedicated primitive exists; in that case codegen emits a native REST path using
`sendDirectRest`, logs the missing primitive, and calls `notifyMissingWriter` so the
RePlatform team can add the writer later.

**Native target ladder when no dedicated writer exists:**

1. **Use the dedicated `rp-target-wix` primitive** when one exists.
2. **If Wix has a native entity but no dedicated primitive, generate a native REST call**
   from Wix MCP/docs-schema, mark it `UNVERIFIED`, log it, call `notifyMissingWriter`, and
   surface it in the execution plan before any write. This is not a silent live write.
3. **Use CMS only when there is no suitable native Wix entity, or when the native entity
   is explicitly rejected for fidelity/side-effect reasons.** CMS is not a fallback for a
   missing adapter writer.
4. **Halt** if neither a native path nor an acceptable CMS/custom target exists.

The invariant: **anything not backed by a verified primitive is surfaced to the user for
consent before execution** — never written silently.
