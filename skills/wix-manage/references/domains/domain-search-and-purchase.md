---
name: "Domain Search and Purchase"
description: Search for available domains, get domain suggestions, and generate purchase links using Domain Search V2 API. Covers availability checks, TLD filtering, and connecting domains to Wix sites.
---
# Domain Search and Purchase

This recipe guides you through searching for available domains, getting domain suggestions, and purchasing a domain to connect to a Wix site. Use this recipe when a user wants to buy a domain, find a domain, check domain availability, connect a domain to their site, or get a custom domain for their Wix site.

## Prerequisites

- Wix account with domain management permissions
- Account-level API access

## Required APIs

- **Domain Search API**: [REST](https://dev.wix.com/docs/api-reference/account-level/domains/domain-search/introduction)
- **Check Domain Availability API**: [Check Domain Availability](https://dev.wix.com/docs/api-reference/account-level/domains/domain-search/availability-v2/check-domain-availability) — `GET https://www.wixapis.com/domain-search/v2/check-domain-availability`
- **Suggest Domains API**: [Suggest Domains](https://dev.wix.com/docs/api-reference/account-level/domains/domain-search/suggestion-v2/suggest-domains) — `GET https://www.wixapis.com/domain-search/v2/suggest-domains`

---

## Step 1: Understand User Requirements

Before searching for domains, gather information:

1. **Ask the user** what domain name they're looking for (e.g., `mybusiness.com`)
2. **Clarify preferences** — do they want a specific TLD (.com, .net, .org) or are they open to suggestions?

---

## Step 2: Check Domain Availability

If the user has a specific domain in mind, check whether it's available for purchase.

**Endpoint**: `GET https://www.wixapis.com/domain-search/v2/check-domain-availability`

**Query Parameters**:
| Parameter | Description | Example |
|-----------|-------------|---------|
| `domain` | The full domain name including TLD | `mybusiness.com` |

**Example Request**:
```bash
curl -X GET \
  'https://www.wixapis.com/domain-search/v2/check-domain-availability?domain=mybusiness.com' \
  -H 'Authorization: <AUTH>'
```

**Example Response**:
```json
{
  "availability": {
    "domain": "mybusiness.com",
    "available": true,
    "premium": false,
    "premiumType": "UNKNOWN_PREMIUM_TYPE"
  }
}
```

### Response Fields

| Field | Description |
|-------|-------------|
| `domain` | The domain that was checked |
| `available` | `true` if available for purchase, `false` if taken |
| `premium` | `true` if this is a premium-priced domain |
| `premiumType` | Type of premium pricing (if applicable) |

### IMPORTANT NOTES:
- The `domain` field **must** include the TLD (e.g., `mybusiness.com`, not just `mybusiness`)
- Not all TLDs are supported. If you receive a `DOMAINS_UNSUPPORTED_TLD` error, inform the user and suggest supported alternatives
- This is an **account-level API** — use the account-level authentication method (e.g., `ManageWixSite` tool)

---

## Step 3: Get Domain Suggestions

If the user wants alternatives, or if their preferred domain is unavailable, use the suggestions API.

**Endpoint**: `GET https://www.wixapis.com/domain-search/v2/suggest-domains`

**Query Parameters**:
| Parameter | Description | Example |
|-----------|-------------|---------|
| `query` | Keyword or domain to base suggestions on | `mybusiness` |
| `paging.limit` | Number of suggestions to return | `10` |
| `tlds` | Filter by specific TLDs (can be repeated). Do **not** include the dot. | `com`, `net`, `org` |

**Example Request**:
```bash
curl -X GET \
  'https://www.wixapis.com/domain-search/v2/suggest-domains?query=mybusiness&paging.limit=10' \
  -H 'Authorization: <AUTH>'
```

**Example Request with TLD filter**:
```bash
curl -X GET \
  'https://www.wixapis.com/domain-search/v2/suggest-domains?query=mybusiness&paging.limit=5&tlds=com&tlds=net' \
  -H 'Authorization: <AUTH>'
```

**Example Response**:
```json
{
  "suggestions": [
    { "domain": "mybusiness.com", "premium": false },
    { "domain": "mybusiness.net", "premium": false },
    { "domain": "mybusiness.org", "premium": false },
    { "domain": "mybusiness.co", "premium": false },
    { "domain": "mybusiness.online", "premium": false }
  ],
  "pagingMetadata": {
    "count": 5,
    "cursors": { "next": "..." },
    "hasNext": true
  }
}
```

### Pagination

If `pagingMetadata.hasNext` is `true`, more suggestions are available. Use the `cursors.next` value to fetch the next page.

### Present Suggestions to User

Show the suggestions in a clear format, highlighting:
- Domain name
- Whether it's a premium domain
- Recommendations based on use case (e.g., `.com` for general, `.me` for personal branding, `.shop`/`.store` for e-commerce)

---

## Step 4: Select Target Site

Before generating a purchase link, **ask the user which site** they'd like to connect the domain to.

Use the `ListWixSites` tool to retrieve the user's sites and present them for selection. The user must pick a site, as the site ID is required for the purchase URL.

---

## Step 5: Generate Purchase Link

Once the user picks a domain and a target site, first **verify availability** using Step 2, then generate a purchase link.

**Purchase URL format**:
```
https://manage.wix.com/dashboard/{SITE_ID}/premium-express-checkout-app/storefront-bundle-selection?domainName={DOMAIN_NAME}&locale=en
```

| Parameter | Description | Example |
|-----------|-------------|---------|
| `{SITE_ID}` | The Wix site ID (GUID) the domain will be connected to | `57d71937-e772-44ab-a89a-e4d0a7d9d814` |
| `{DOMAIN_NAME}` | The chosen domain name including TLD | `mybusiness.com` |

**Example**:
```
https://manage.wix.com/dashboard/57d71937-e772-44ab-a89a-e4d0a7d9d814/premium-express-checkout-app/storefront-bundle-selection?domainName=mybusiness.com&locale=en
```

Replace `{SITE_ID}` with the selected site's ID and `{DOMAIN_NAME}` with the user's chosen domain (e.g., `ravitgonen.online`).

### Getting the Site ID

Use the `ListWixSites` tool to list the user's sites and retrieve the site ID from the response.

### IMPORTANT NOTES:
- **Always verify availability** before generating the purchase link
- If the domain has an unsupported TLD, inform the user and suggest alternatives
- The actual purchase is completed by the user through the Wix dashboard — the API cannot process domain purchases directly

---

## Error Handling

| Error Code | Description | Action |
|------------|-------------|--------|
| `DOMAINS_UNSUPPORTED_TLD` | The TLD is not supported by Wix | Inform the user and suggest supported TLDs using the Suggest Domains API |
| `access_denied` | Authentication issue | Use account-level API authentication (not site-level) |

---

## Example Full Flow

1. User asks to buy `mysite.io`
2. Check availability → `DOMAINS_UNSUPPORTED_TLD` error
3. Inform user that `.io` is not supported
4. Get suggestions for `mysite` → present alternatives
5. User picks `mysite.online`
6. Verify `mysite.online` is available → `available: true`
7. List user's sites and ask which site they'd like to connect the domain to
8. User selects their site (e.g., site ID `57d71937-e772-44ab-a89a-e4d0a7d9d814`)
9. Generate purchase link: `https://manage.wix.com/dashboard/57d71937-e772-44ab-a89a-e4d0a7d9d814/premium-express-checkout-app/storefront-bundle-selection?domainName=mysite.online&locale=en`
10. Share link with user to complete purchase
