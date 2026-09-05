---
name: "Connect an External Domain"
description: Connect a domain the user already owns (registered elsewhere, e.g. GoDaddy/Cloudflare/iwantmyname) to a Wix site by pointing or nameservers, monitor DNS propagation correctly, and avoid the two most common failure modes -- trusting a false "success" signal, and taking the live site offline by reassigning primary too early.
---
# Connect an External Domain

Use this recipe when a user wants to:
- Connect a domain they already own (bought elsewhere) to a Wix site
- Point an existing domain at Wix, or migrate from one domain to another
- Says something like "connect mydomain.com to my site", "point my domain at Wix", "switch my site to a shorter domain"

This is **not** the domain-purchase flow -- if the user wants to buy a new domain through Wix, use [Domain Search and Purchase](domain-search-and-purchase.md) instead. This recipe is for domains registered with an external provider.

## Required APIs

- **Create Connected Domain**: `POST https://www.wixapis.com/domains/v1/connected-domains`
- **Get Connected Domain**: `GET https://www.wixapis.com/domains/v1/connected-domains/{connectedDomainId}`
- **Get DNS Propagation**: `GET https://www.wixapis.com/premium/domains/v1/dns-propagations/{domain}`
- Connection requires an active Premium plan on the target site.

Read the full method schemas via `SearchWixRESTDocumentation`/`SearchWixAPISpec` before calling -- the request body differs for `POINTING` vs `NAMESERVERS` connection types.

## Step 1: Choose a connection type

Ask (or infer from what the user already set up):
- **Pointing**: the user keeps DNS hosted at their current provider (e.g. Cloudflare, GoDaddy) and just adds an A record (apex) + CNAME (`www` -> `pointing.wixdns.net`). Wix does **not** manage DNS for pointing domains.
- **Nameservers**: the user changes their domain's nameservers to Wix's, and Wix hosts the DNS zone.

Call `CreateConnectedDomain` with the chosen `connectionType`, then give the user the exact DNS records to add (from the response / Setup Info API) if they're doing this themselves at their registrar/DNS provider.

## Step 2: Monitor DNS propagation -- and know what it does NOT tell you

Poll `GetDnsPropagation` for the domain. `status` moves `IN_PROGRESS` -> `SUCCEEDED` (or `FAILED`, see the DNS Propagation API's error-handling docs for how to read `failureInfo`).

**Critical: `status: SUCCEEDED` on this API is necessary but not sufficient for the site to actually be served.** It only confirms the DNS records themselves are correctly configured and visible from Wix's resolvers (`dnsResolverIncludesWixNs: true`). It does **not** confirm that:
- The domain has stopped serving the "Your domain is being connected" placeholder page
- An SSL certificate being issued for the domain (which can happen independently) means the site is live
- Real end-to-end traffic through the domain actually reaches the site

There is **no public API that reports "is this domain actually serving the site yet."** The only way to confirm the domain is truly live is to **have the user open the URL in a browser** and check they see their actual site, not a placeholder. Do not tell the user the domain is "connected" or "done" just because `GetDnsPropagation` returned `SUCCEEDED` -- say DNS has propagated and the site should go live "shortly," and ask them to check the live URL before relying on it.

If propagation stays `SUCCEEDED` (or the site keeps showing the placeholder) for more than ~48 hours, there is no self-serve retry/force-resync API. Tell the user their only option at that point is to contact Wix support -- do not imply there's an API-level fix.

## Step 3: Assigning primary -- do this LAST, and only once the new domain is confirmed live

If the user is **migrating** from an existing working domain to a new one (the scenario that most often goes wrong), never reassign primary based on API status alone.

**Do NOT set a domain as primary (or tell the user to) while it is still showing the placeholder page or before `GetDnsPropagation` has returned `SUCCEEDED` for it.** Reassigning primary immediately demotes the current primary to a redirect. If the new domain is not actually serving yet, this takes the site **fully offline on both domains** for however long the new domain remains stuck connecting -- there is no atomic "both domains up" intermediate state.

Correct order of operations when migrating domains:
1. Connect the new domain as a **secondary/redirect** domain first (not primary).
2. Wait for `GetDnsPropagation` to return `SUCCEEDED` for the new domain.
3. Have the user open the new domain's URL directly in a browser and confirm it shows the real site content, not the "being connected" placeholder.
4. Only after that visual confirmation, reassign the new domain to primary and keep the old one as a redirect.

If a user asks you to "just make the new domain primary now" while it's still connecting, warn them explicitly that this can take their live site offline until the new domain finishes connecting, and confirm they want to proceed anyway before doing it.

## Error Handling

| Situation | Action |
|---|---|
| `GetDnsPropagation` returns `FAILED` | Read `failureInfo.invalidRecords` and the matching `invalidARecordInfo`/`invalidNsRecordInfo`/`invalidCnameRecordInfo` object; tell the user exactly which record type and value to fix at their DNS provider. |
| `SUCCEEDED` but site still shows placeholder after 48h | No API remediation exists. Tell the user to contact Wix support to request a manual re-sync. |
| `NON_PREMIUM_SITE` error on create | The target site needs an active Premium plan before a domain can be connected. |
| `DOMAINS_ALREADY_EXISTS` | The domain (or the same domain with different settings) is already connected -- check `ListConnectedDomains` first. |
