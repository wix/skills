---
name: "Pointing a Wix-Registered Domain at External (Non-Wix) Hosting"
description: A domain purchased through Wix can be pointed at non-Wix hosting without transferring it away from Wix — via the Domain DNS API's Update DNS Zone, not the domain-connect flow. Read this when the user wants to move their site off Wix but keep the Wix-registered domain.
---

# Pointing a Wix-Registered Domain at External (Non-Wix) Hosting

## When to use this

The user owns a domain **purchased through Wix** (a "registered domain") and wants their domain name
to resolve to a site hosted **somewhere other than Wix** — e.g. they built a static site elsewhere
(GitHub Pages, Netlify, Vercel, a self-hosted server) and want `theirdomain.com` to point there instead
of their Wix site, while keeping the domain itself registered and billed through Wix.

This is the mirror image of [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md),
which only ever connects a domain **into** Wix. That skill's hard boundary (§A1.1) is deliberate and
correct for its job — but it means a "move my domain off Wix hosting" request has nowhere else to land
today. Route here instead.

## The API exists — it's just not where you'd expect it

It's tempting to conclude this isn't possible: registered-domain nameservers stay on Wix
(`ns4.wixdns.net` / `ns5.wixdns.net`), there's no "disconnect domain" button in the domain-purchase
flow, and the Connected Domains API only works in the other direction (bringing an external domain
*into* Wix). None of that is the relevant API.

**[Domain DNS API → Update DNS Zone](https://dev.wix.com/docs/api-reference/account-level/domains/domain-dns/update-dns-zone)**
(`PATCH https://www.wixapis.com/domains/v1/dns-zones/{domainName}`) edits the actual DNS records (A,
CNAME, MX, TXT, …) inside the zone Wix hosts for a registered domain — **without** touching nameserver
delegation. The domain keeps `ns4/ns5.wixdns.net` as its nameservers (registration/renewal/billing via
Wix is unaffected); only the record *values inside that zone* change, so the hostname resolves to the
external host's IP/CNAME instead of Wix's. This is exactly the officially documented
["Update DNS records for a registered domain"](https://dev.wix.com/docs/api-reference/account-level/domains/domain-dns/sample-flows#update-dns-records-for-a-registered-domain)
use case — it is not a workaround or an unsupported trick.

Confirmed reachable from an MCP session: `GetDnsZone`/`PreviewDnsZone` (read side) succeed via
`ManageWixSite` despite the docs stating these calls "cannot be authenticated with the standard
authorization header" — the Wix MCP's account-level credential already satisfies that requirement, so
no separate account-level API key needs to be minted for this flow.

## Steps

1. **Confirm the domain is actually registered through Wix**, not merely connected. Call
   [Preview Dns Zone](https://dev.wix.com/docs/api-reference/account-level/domains/domain-dns/preview-dns-zone)
   or [Get Dns Zone](https://dev.wix.com/docs/api-reference/account-level/domains/domain-dns/get-dns-zone)
   (`GET /v1/dns-zones/{domainName}`) via `ManageWixSite`. An `NS` record pointing at
   `ns4.wixdns.net`/`ns5.wixdns.net` confirms Wix hosts this zone.
2. **Get the external host's required DNS values** (its IP for an `A` record, or its CNAME target) from
   the user or the external hosting provider's own setup instructions.
3. **Call [Update DNS Zone](https://dev.wix.com/docs/api-reference/account-level/domains/domain-dns/update-dns-zone)**
   (`PATCH /v1/dns-zones/{domainName}`) via `ManageWixSite`, passing:
   - `deletions`: the current `A` record (and `CNAME` on `www`, if present) that points at Wix.
   - `additions`: the new `A`/`CNAME` record(s) pointing at the external host.
   - **Do not touch `MX`/`TXT` records** unless the user also wants to move email or verification
     records — deleting them will break existing email delivery or domain-verification tokens (e.g.
     Google Workspace, SPF, DKIM) that have nothing to do with hosting.
4. **This takes the domain off Wix hosting immediately once DNS propagates** (up to 48 hours, though
   often much faster). The Wix site remains reachable at its default `*.wixsite.com` /
   `*.editorx.io` URL, but no longer at this custom domain. Confirm this explicitly with the user before
   calling `Update DNS Zone` — it is not easily or instantly reversible from the visitor's perspective
   (DNS caching), and if the user is mid-troubleshooting (e.g. this is the same conversation where an
   attempt to get their design onto the Wix site itself has failed), moving the domain away is often a
   bigger, harder-to-reverse step than the problem that prompted it.

## What this does NOT do

- It doesn't cancel or transfer the domain registration — renewal/billing through Wix is unaffected.
- It doesn't change nameservers — the domain still resolves via `ns4/ns5.wixdns.net`, it's just the
  records inside that zone that changed.
- It doesn't help the user get a **Wix-hosted design onto their Wix site** — if that's what actually
  failed first (e.g. `import-claude-design-from-url` only accepts Claude Design's own export URLs, or
  there's no API to place a design on an *existing* site — see
  [Editing Pages, Menus, or Homepage Layout on an Existing Site — Known Gap](../sites/editing-existing-site-pages-menus-and-homepage.md)),
  moving the domain elsewhere doesn't solve that; it just relocates hosting to wherever the design
  already works. Make sure the user actually wants to leave Wix hosting, not merely deliver a design to
  their current Wix site.

## Dashboard fallback

If the user (or a human with account access) would rather do this by hand: **My Domains**
(`https://manage.wix.com/account/domains`) exposes DNS record management for domains purchased through
Wix — see [Domains Dashboard Navigation](domains-dashboard-navigation.md).
