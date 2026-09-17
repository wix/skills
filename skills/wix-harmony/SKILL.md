---
name: wix-harmony
description: Explicitly inspect and prepare a Wix Harmony live-editor session with the bundled Playwright bridge. Phase 1 positively identifies Harmony and reads RunEditorLLMCodeToolAPI namespace metadata, but fails closed before documentation calls, reads, or writes until attributed execution exists. Do not use for Wix Studio, the classic editor, or Dashboard data.
---

# Wix Harmony editor front-end

Use the bundled scripts from this skill directory. Do not substitute Wix Studio, the classic
Editor, Headless project code, or dashboard APIs.

## Phase 1 execution boundary

This Phase 1 candidate is explicit-invocation only and is not publicly published. Do not select it
implicitly for build or styling requests: it cannot complete them until attributed execution is
connected.

Use the transport to open an authenticated Harmony editor and read serializable namespace
metadata. Treat every `execute` request—including `catalog.describe`, reads, and writes—as blocked
until the Wix API owner supplies a supported caller-attribution host or bridge.

Never invent, scrape, default, or hard-code `biParams`, an `appDefId`, or an origin. Never accept an
attribution file or environment-variable bypass. Report
`blocked_missing_owner_attribution_spi` when the requested work needs `execute`.

## Start the editor bridge

Run the preflight with an explicit editor URL and a dedicated absolute automation-profile path
outside this installed skill and outside the user's normal browser profile:

```bash
node scripts/wix-harmony-preflight.mjs \
  --editor-url 'https://editor.wix.com/...' \
  --profile-dir '/absolute/path/to/dedicated-harmony-profile'
```

The diagnostic run does not create or loosen the profile directory. If it reports a missing profile,
unsafe permissions, dependency, or Chromium failure, rerun with `--fix` or use the exact remediation
it prints. `--fix` creates or repairs the dedicated profile at mode `0700`. Then start the long-lived
headed bridge with the same URL and profile:

```bash
node scripts/wix-harmony-bridge.mjs \
  --editor-url 'https://editor.wix.com/...' \
  --profile-dir '/absolute/path/to/dedicated-harmony-profile'
```

Send one NDJSON command per line. Keep the process alive across the request:

```json
{"id":"1","action":"open"}
{"id":"2","action":"metadata","includeMethodDocs":false}
{"id":"3","action":"status"}
{"id":"4","action":"close"}
```

The bridge canonicalizes profile aliases, publishes one exclusive stale-PID-aware lock beside the
physical profile, and serializes recovery with an atomic mutation guard. If it returns
`profile_in_use`, close the other bridge or choose a
different dedicated profile. If an interrupted guard is named, verify no bridge uses the profile
before removing that guard. An `open` using a different profile from the live context returns
`profile_mismatch`; send `close` before switching. Closing the target tab or headed window ends the
session and releases the lock only after the browser context closes; send `open` again to relaunch.
A close failure retains the lock and must be resolved before relaunching.

If `open` returns `auth_required`, authenticate in the headed browser. Never collect credentials
in chat, and treat only Wix-owned URLs as authentication pages. Retry `open` afterward. Stdout is
protocol-only; never expose cookies, storage, headers,
or session data. `status` freshly checks and reports Harmony identity, editor readiness, API
readiness, and `authRequired` separately; never treat an earlier successful `open` as evidence for
the current page. `metadata` independently re-verifies both gates and reads namespaces in one
page-realm snapshot. It returns `editor_not_ready` when the tab navigated away, lost the API
contribution, needs authentication, or was closed; run `open` again rather than retrying `metadata`.

## Confirm Harmony

Require all of these before metadata access:

1. `repluggableAppDebug.utils.unReadyEntryPoints()` exists and is empty.
2. `window.__OdeditorE2EApi__` exists as the positive Harmony identity marker.
3. `RunEditorLLMCodeToolAPI` resolves from the public `DATA_SERVICE` slot and exposes
   `listNamespacesMetadata` plus `execute`.

The API alone does not prove Harmony because Studio also contributes it. On a timeout, report
`harmony_marker_timeout`, `harmony_entry_points_timeout`, or `editor_api_timeout` with the returned
readiness detail. A client-side redirect to login is `auth_required`, including when it happens
while a readiness wait is in progress. Never use a failed gate as permission to mutate through
another surface.

## Use live capabilities after attributed execution is connected

Treat these as future execution rules; Phase 1 enforces the execution block above.

1. Call `listNamespacesMetadata()` for unfiltered orientation. Do not serialize
   `listNamespaces()` because it returns live functions.
2. Fetch every required namespace with one documentation-only `catalog.describe` execution.
   Never use a namespace method whose full live documentation has not been read in this
   conversation. A describe call earlier in the same snippet does not count.
3. Gather all decision-relevant reads together, using `Promise.all` for independent reads. Return
   whole candidates projected only for size.
4. Make semantic and visual judgments between executions. Keep exact-id lookups mechanical.
5. Inspect suitable existing components on the page or site first. Check whether reuse changes a
   shared, themed, or repeated instance. If none is suitable, inspect live Harmony out-of-the-box
   components, theme components, and presets. Create custom structure only after both searches
   fail and retain the evidence explaining why.
6. Address a component by `componentId` plus the returned `elementPath`. Read the setter's matching
   per-target schema before writing. Take tokens, fonts, types, presets, field keys, shaped values,
   and units from live reads or schema suggestions, never memory.
7. Select the intended desktop or mobile view before view-scoped writes.
8. After a write batch, perform a fresh read of a user-visible or normalized value. A write echo
   proves acceptance, not effect.

## Recover safely

Parse each returned item defensively: preserve JSON as `parsedContent` and plain text as
`rawContent`. Treat truncation markers and `+N more items` as incomplete results.

If a future attributed execution fails after writes, use `completedCalls` and `failedCall`; never
repeat successful creates. Retry a correctable method/value/target error once. Stop on
`Not possible:`. If the bridge or page dies while a write is in flight, read fresh state before
considering a retry.

## Keep dashboard data out of scope

Edit only the visible front-end. Route Stores products, Bookings services, orders, coupons,
contacts, members, blog posts, and site settings through the appropriate Wix MCP tool or owning
skill. A widget displaying dashboard data does not authorize mutation of the underlying record.
