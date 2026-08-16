---
name: "Domains Dashboard Navigation"
description: "Builds direct links to the domain-management pages on manage.wix.com — the site-level domain settings page and the account-level My Domains page. Pairs domain search/purchase with its read APIs. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Domains Dashboard Navigation

For the general URL contract, see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md). Domains have two surfaces — a **site-level** page (this site's domains) and an **account-level** page (all domains you own, no metaSiteId).

## Main Pages

| Page | URL | What it manages |
|---|---|---|
| Site domain settings | `https://manage.wix.com/dashboard/{metaSiteId}/domain-settings` | The domains connected to this site |
| My Domains (account) | `https://manage.wix.com/account/domains` | All domains in the account (renew, transfer, DNS) |

Older `settings/domains` and `manage-website/domains` links redirect to `domain-settings`.

## Pairing Entities with Their Read APIs

| Entity | Read API | Dashboard link |
|---|---|---|
| Domain availability / suggestions | `GET /domain-search/v2/check-domain-availability?domain=...` · `GET /domain-search/v2/suggest-domains?query=...` | `https://manage.wix.com/account/domains` (after purchase) |
| This site's connected domains | Site Properties (`GET /site-properties/v4/properties` → `url`) | `domain-settings` |

Example — after a purchase-link flow:

```
mybusiness.com is available — complete the purchase, then manage it here:
https://manage.wix.com/account/domains
Connect it to this site: https://manage.wix.com/dashboard/{metaSiteId}/domain-settings
```
