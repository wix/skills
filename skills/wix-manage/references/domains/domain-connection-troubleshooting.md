---
name: "Domain Connection Troubleshooting"
description: "Diagnose why a custom domain that's already connected/bound to a Wix site isn't resolving or is showing a browser/SSL error. Uses the DNS Propagation API to check DNS record status. Use when the user reports the site 'doesn't open', 'not found', 'can't be reached', or an SSL/certificate warning on a domain they already connected — not for the connect flow itself, which is Domain Search, Purchase and Connect."
---

# Domain Connection Troubleshooting

This is the follow-up flow, not the connect flow. Use it when a domain is **already** connected to a
site (per [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md)) and the user
comes back saying the site still doesn't load, or the browser shows a not-found / connection / SSL
error. Do not use this to connect a domain in the first place — that flow deliberately says nothing
about timing, propagation or SSL because none of it is knowable at bind time. Here, it is.

## 1. Check DNS propagation status

```
GET https://www.wixapis.com/premium/domains/v1/dns-propagations/{domain}
```

Call via `CallWixSiteAPI` with the site's `siteId` (the docs example uses a `wix-site-id` header,
which `CallWixSiteAPI` supplies automatically). `{domain}` is the bare domain, no protocol.

Read `status`:

| `status` | Meaning | What to tell the user |
|---|---|---|
| `SUCCEEDED` | DNS records are correctly configured and propagated | DNS is fine. If the site still doesn't load, go to §2 (SSL) rather than re-checking DNS. |
| `IN_PROGRESS` | Records are still propagating | This is expected and can take **up to 48 hours** after a domain is connected or its DNS records change. Ask the user to check back later rather than repeating this call in a tight loop. |
| `FAILED` | One or more records are misconfigured | Read `failureInfo.invalidRecords` and the matching `invalidARecordInfo` / `invalidNsRecordInfo` / `invalidCnameRecordInfo` objects. Tell the user plainly which record type is wrong and what value is expected (`expectedDnsRecords`) versus what's actually there (`actualDnsRecords`) — this is exactly the information the user needs to fix it at their registrar. |

If the call itself fails with a permission/authorization error rather than returning a status, do not
surface the raw error. Say diagnostics aren't available right now and go straight to the dashboard
link below.

## 2. SSL / HTTPS errors after DNS has succeeded

There is no API to check SSL certificate issuance status. Wix provisions the certificate
automatically once DNS resolves correctly — it is not something to request or poll for. If DNS
propagation shows `SUCCEEDED` but the browser still shows a certificate warning:

- It is usually still catching up — issuance normally follows shortly after DNS is confirmed valid.
- Point the user at the site's domain settings for a status view a dashboard user can act on:
  `https://manage.wix.com/dashboard/{metaSiteId}/domain-settings` (see
  [Domains Dashboard Navigation](domains-dashboard-navigation.md)).
- If it hasn't cleared after 48 hours from when DNS succeeded, this needs a human — hand off to Wix
  Support rather than continuing to guess.

## What not to do

- Don't tell the user DNS is fine because the domain shows as "Connected" in site context — that only
  reflects the *binding*, not whether DNS has actually propagated. Always check propagation status
  before reassuring the user.
- Don't invent an SSL status — there is no field or endpoint for it. Saying "SSL is provisioning" as a
  fact rather than an expectation is a guess dressed as a diagnosis.
- Don't loop this call more than once or twice in the same conversation — propagation is checked by
  Wix on its own schedule (up to 48 hours after a change, then every ~4 days for stable domains); rapid
  re-polling won't produce a different answer.
