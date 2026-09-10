---
name: "Diagnosing a Published Site That's Unreachable (ERR_CONNECTION_RESET / never loads)"
description: What to do when a site-creation or publish tool reports success but the returned URL doesn't load in a browser — how to verify independently, and how to tell a hosting-domain outage apart from a content problem.
---
# Diagnosing a Published Site That's Unreachable

## Symptom

A site-creation/publish flow (`WixSiteBuilder` → `pullSiteCreationJob`, `CreateSiteFromTemplate`, or a
direct `Publish Site` call) reports success and returns a URL, but the user reports the site "doesn't
open" — commonly `ERR_CONNECTION_RESET` in the browser, sometimes worded as "not even on mobile" — and
this persists across devices and repeated tries. `Get Site Context` / `Query Sites` still show the site
as `Published`.

## First: don't trust the tool's success text at face value

None of the publish-flow tools verify that the URL they hand back actually loads — they only check that
the *publish API call* succeeded. Before telling the user the site is live, do a real fetch of the exact
URL yourself and look at what actually comes back:

- **`ERR_CONNECTION_RESET` / a TLS handshake failure, no HTTP response at all** — this is a
  network/hosting-layer failure, not a content problem. Re-publishing, re-editing, or re-running
  `WixSiteBuilder`/`EditSite` will not fix it — the site's draft/content is irrelevant to a transport
  failure. Don't burn tool calls looping on publish/edit.
- **An actual HTTP response (even a 404, or a "page not found"/wrong-content page)** — that's a routing
  or content issue, a different failure class (e.g. no main route for the site's project — out of scope
  for this recipe).
- **A slow/blank page that eventually loads, or a "Runtime is unreachable" 504** — see the separate
  Velo-runtime-unreachable recipe; that's a different symptom (an HTTP 504, not a reset) with a
  different cause.

If you don't have a way to fetch the URL yourself, at minimum ask the user to try it in a private/
incognito window and from a second network (e.g. mobile data instead of home wifi) before concluding
it's a real outage rather than a local DNS-cache/extension/firewall issue on one device.

## Known incident shape: `*.wix-site-host.com` (free Editorless/Harmony hosting)

Wix's free-site hosting domain for Editorless/Harmony ("Vibe") sites created via `WixSiteBuilder` is
`*.wix-site-host.com` — distinct from the classic Editor's `*.wixsite.com` and Wix Studio's
`*.wixstudio.io`. This domain is served through a single Google Cloud Load Balancer that terminates TLS
for many Wix wildcard domains via Google Certificate Manager on one shared IP (SNI-based routing).

If that domain's certificate/cert-map entry is missing, expired, or not kept current, every hostname
under it TLS-resets — the LB never even reaches the point of serving an HTTP response, so it's
indistinguishable at the API level ("Published" is still true) but completely unreachable in a browser.
This was confirmed live on multiple existing `*.wix-site-host.com` sites in one account (same failure
from independent networks), while `*.wixsite.com`/`*.wix.com` on the exact same load-balancer IP served
normally — i.e. it's specific to that one hosting domain, not a general Wix outage. Not every
`WixSiteBuilder` site lands on `wix-site-host.com` — check which hosting domain the returned URL actually
uses before assuming this applies.

**If the unreachable URL is under `wix-site-host.com`:** this is very likely the same infra-layer issue,
not something the user or an agent can fix from the outside. Tell the user plainly that this looks like a
hosting-side issue on Wix's end (not their content or a publish mistake) and to check again after some
time; if it persists, this needs Wix Support / infra escalation, not more publish/edit attempts.

**If the unreachable URL is under `wixsite.com`/`wixstudio.io`/a connected custom domain instead:** this
specific incident doesn't apply — treat it as a general reachability/DNS/domain issue instead (see the
domain-connection-troubleshooting recipe for connected custom domains).

## Related recipes

- Velo-runtime "Runtime is unreachable" 504 — a different HTTP-level symptom, different cause.
- Domain connection troubleshooting — for connected custom domains that don't resolve/have no SSL.
- Delete Sites — if diagnosing this surfaced orphaned/duplicate sites along the way.
