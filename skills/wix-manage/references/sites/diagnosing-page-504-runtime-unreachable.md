---
name: "Diagnosing a Live Page Returning 504 / 'Runtime is unreachable' — Known Gap"
description: A published, Velo-enabled site's non-home pages return HTTP 504 with body "Runtime is unreachable" while the home page works. Republishing does not fix it, ListSitemapPages cannot diagnose it, and there is no public API to check or restart the site's Velo runtime. Read this before spending multiple tool calls hunting for a fix.
---

# Diagnosing a Live Page Returning 504 / "Runtime is unreachable" — Known Gap

## The symptom

A site owner reports that some or all pages of a **Published, Velo-enabled** site fail to
load, with the browser showing an error like "runtime is unreachable" and DevTools showing
`Failed to load resource: the server responded with a status of 504`. Often the home page
loads fine while other pages (About, Contact, etc.) fail — because the home page is more
likely to already be warm/cached, not because those other pages are special.

## Root cause: this is a Velo backend runtime signal, not a content/publish problem

The literal string **"Runtime is unreachable"**, paired with HTTP **504**, is Wix's own Velo
platform's canned response for exactly this condition — it comes from the Kore Supervisor
(`wix-private/velo-platform-golang`, `kore/kore-supervisor`), the reverse proxy in front of
every Velo-enabled site's backend runtime container. When the supervisor can't dial the
runtime (connection refused, EOF, or an unexplained fast timeout — see
`handleRuntimeUnreachable` in `kore-supervisor/handlers/proxy_factory.go`), it returns
`504` with body `"Runtime is unreachable"` verbatim. This is an **infrastructure-level
signal that the site's Velo runtime pod is unreachable or crashed** — it has nothing to do
with the page's content, its publish status, or its routing configuration.

This explains two things a diagnostic session will otherwise misread as separate bugs:

- **Republishing does not fix it.** `Publish Site` (Site Actions API) publishes content/routing
  changes; it does not touch Velo runtime pod lifecycle at all. A successful `publish-site`
  call with the 504s persisting afterward is expected, not a sign the publish itself is broken.
- **There is no public API to check or restart the runtime.** There is no REST/MCP surface to
  read a site's Velo runtime health or force a restart. If a site is stuck in this state, the
  only path is to escalate to Wix support/infra — do not keep spending tool calls probing
  content or routing APIs looking for a fix here.

## Don't use `ListSitemapPages` to check whether the site's pages are "registered"

A natural next diagnostic step is checking whether the affected pages are known to Wix's
backend at all — via the Headless Sitemap Entry V1 API's `ListSitemapPages`
(`GET /v1/list-sitemap-pages`). **This will not tell you that.** Its `itemType` enum only
covers dynamic, repeater-generated business-solution items (`STORES_PRODUCT`, `BLOG_POST`,
`BOOKINGS_SERVICE`, etc.) — there is no value for a site's static/main pages (classic Editor
"Home", "About", "Contact", ...). An empty `pages` result is the **expected, unrelated**
response for any site whose pages are all static — it is not evidence those pages are
unpublished or unregistered, and it should not feed into a 504 root-cause hypothesis.

There is also no other public API to list a classic/Editorless site's own static page
routes for verification: `List Published Site URLs` (Site URLs API) only returns
domain-level URLs (primary/secondary/multilingual subdomains), not per-page routes. This is
the same underlying theme as the page-editing gap documented in
[[editing-existing-site-pages-menus-and-homepage.md]] — site *creation* APIs are rich, site
*introspection* of the actual page/runtime state is not.

## What to do instead

1. Confirm the symptom directly (fetch the failing page URL, or ask the user to check
   DevTools) rather than relying on `ListSitemapPages` or any other content API — it won't
   confirm or refute this.
2. If confirmed, state plainly that this is a Velo backend runtime issue on Wix's
   infrastructure side, not something fixable via the Wix MCP or any public API — republishing
   will not help. Direct the user to Wix Support for the underlying runtime pod issue.
3. Don't loop on `publish-site`, sitemap, or SEO/routing APIs expecting one of them to
   surface or fix this — none of them touch Velo runtime pod health.
