---
name: "Diagnosing: Live Site Not Updating After a Successful Write"
description: What to do when Editor saves, Publish Site, or a normally-immediate write (e.g. Create Custom Embed) all report success with real revisions/timestamps, but the live-served HTML never changes. Bisects the problem to rule out client/CDN caching vs. a backend serving-layer incident, since the fix (if any) is not reachable from any public API.
---
# Diagnosing: Live Site Not Updating After a Successful Write

## Symptom

Every write path the user tries reports success — Editor saves, [Publish Site](https://dev.wix.com/docs/api-reference/account-level/sites/site-actions/publish-site), a Velo/code deploy, a REST call — and the site's `updatedDate`/revision visibly advances. But the live-served HTML on the public URL never reflects the change, no matter how long you wait or how many times you republish.

**Do not treat this as a normal "my publish didn't work" question and start replaying every write flow again.** If the checks below confirm the write path is healthy, this is very likely a backend serving/cache incident on that one site, not something fixable by retrying APIs, re-publishing, or changing how the agent calls things.

## Step 1 — Rule out a downstream (CDN/browser) cache first

Fetch the live URL directly (`curl -D -`) and check the response headers:
- `cache-control: private, max-age=0, must-revalidate` and `age: 0` mean the **outer edge is not caching** — every request is a fresh pass to origin. If you see this, a downstream/browser cache is NOT the explanation, even though the content still looks stale.
- If instead you see a long `max-age`/`s-maxage`, a high `age` value, or a `cf-cache-status: HIT`, that IS a real downstream cache — the fix there is a normal CDN purge or waiting out the TTL, not an incident.

## Step 2 — Bisect using a no-publish-required write

[Create Custom Embed](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/create-custom-embed) is documented to apply to the live site **immediately, with no publish step**. Create one with a unique, greppable HTML marker (e.g. a harmless `<meta>` tag) and re-fetch the live URL right after:

- **Marker appears live** → the general write→serve pipeline for this site is healthy. Whatever else isn't updating is a narrower, specific problem (e.g. a particular content type, page, or app) — debug that directly instead of assuming a platform-wide incident.
- **Marker does NOT appear**, even though `Create Custom Embed`'s own response returned a real `revision` → this bisects the problem to below the write layer entirely. Since Custom Embeds don't go through Publish Site at all, this rules out every publish-flow-specific theory (a stuck deploy job, a Velo-specific runtime issue, etc.) in one call. What's left is the site's serving/render origin itself failing to pick up new revisions — most likely a stuck or un-invalidated origin-side cache (separate from and invisible to the CDN-edge headers checked in Step 1).

## Step 3 — What to tell the user if Step 2 confirms the deeper case

There is **no public API to force-refresh or query the state of a site's serving-origin cache** — this is backend infrastructure, not something reachable via the Wix MCP, REST API, or CLI. Don't keep trying more write APIs or re-publishing; it won't help; and don't spend further "trying-harder" write-path tool calls once Step 2 has produced the second (no-marker) outcome.

Tell the user this looks like a platform-side serving incident specific to their site, and to escalate it to **Wix Support** with the concrete evidence you gathered (the response headers from Step 1 and the Custom Embed bisection result from Step 2) — that evidence lets support skip straight to the serving/cache layer instead of re-treading the write-path debugging you already ruled out.
