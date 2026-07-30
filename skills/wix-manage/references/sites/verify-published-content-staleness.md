---
name: "Diagnose Stale Content After Publish"
description: What to do when a site owner or an automated fetch of a published page's public URL shows outdated content (old text, old nav links) even though the Editor confirms the edit is published and correct. Covers the cache-busting query-param check that definitively separates CDN/edge cache staleness from a real content problem, and why it self-heals.
---
# Diagnose Stale Content After Publish

## Symptom

A site owner edits content in the Wix Editor and publishes. They confirm in their own
browser — including after a hard refresh — that the change is live. But a **separate,
automated fetch** of the exact same public URL (a `curl`/`WebFetch` call, a monitoring
check, another agent) returns the **pre-edit** version: old text, or stale nav/menu
links from before a page rename. Repeated fetches over the following several minutes
can keep returning the same stale bytes, even though the owner's hard refresh already
shows the new version.

This is not limited to page text — the same pattern shows up for Stores: a deleted
product can keep rendering on the storefront and its own product-page URL after it's
confirmed gone from the Catalog API (see
[Delete Product (Catalog V1)](delete-product-catalog-v1.md)).

## Root cause

Published Wix sites are served through a multi-tier public cache chain (CDN edge →
internal edge cache → the renderer origin), not directly from the renderer on every
request. Publishing emits an async cache-invalidation event for the affected content,
but that invalidation is decoupled from the publish itself — it can lag, or a specific
cache entry (e.g. one page's route, one product's listing) can miss invalidation while
sibling content on the same site is invalidated correctly. This is why nav links or one
page can be stale while other pages on the same site are already fresh. It is a known,
self-healing class of cache-propagation delay, not data loss — the affected entry's TTL
expires and it corrects itself, typically within minutes and almost always within a few
days.

## How to tell definitively: cache-bust before concluding anything is broken

Never conclude a publish failed, or that content is "inconsistent between servers,"
from a single plain fetch of the public URL. Add a random, unused query parameter and
re-fetch:

```
https://example.com/some-page?_cachebust=<random-string>
```

- If the cache-busted fetch returns the **new** content → this **was** cache staleness,
  not a real problem. Report it as such; do not treat it as a data or publish bug.
- If the cache-busted fetch **still** returns the **old** content → this is not caching;
  escalate as a genuine content/publish problem instead.

A single stale plain fetch is expected and not actionable by itself. Only treat it as a
real bug if the cache-busted re-fetch is *also* stale, or if the same URL is still stale
after re-checking a few minutes later.

## What to do about it

- **Nothing is required** — the affected entry clears itself as its cache TTL expires.
- If it must resolve immediately, republishing the site (`POST` the site's publish
  endpoint via the Sites API, or `ManageWixSite`) busts the cache faster than waiting
  out the TTL.
- Don't tell the site owner their edit was lost or ask them to redo it — the Editor/CMS
  state is already correct; only the public-facing cached copy is behind.

## References

- [Delete Product (Catalog V1)](delete-product-catalog-v1.md) — same root-cause class
  applied to storefront product listings.
- [Query Sites](query-sites.md) / [Create Site from Template](create-site-from-template.md)
  — for republishing via the Sites API.
