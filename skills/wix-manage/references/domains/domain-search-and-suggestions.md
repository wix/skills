---
name: "Domain Search and Suggestions"
description: Check domain availability and suggest domain names using Domain Search V2 API. Use when a user wants to check if a domain is available, find domain ideas, brainstorm names for a business, or explore alternatives when a domain is taken.
---
# Domain Search and Suggestions

Use this recipe when a user wants to:
- Check if a specific domain name is available for purchase
- Get domain name suggestions or brainstorm ideas for a business/project
- Find alternatives after learning a domain is taken
- Explore different TLD options (.com, .net, .online, etc.)

## Prerequisites

- Wix account with domain management permissions
- Account-level API access

## Required APIs

- **Check Domain Availability**: [API Reference](https://dev.wix.com/docs/api-reference/account-level/domains/domain-search/availability-v2/check-domain-availability) — `GET https://www.wixapis.com/domain-search/v2/check-domain-availability`
- **Suggest Domains**: [API Reference](https://dev.wix.com/docs/api-reference/account-level/domains/domain-search/suggestion-v2/suggest-domains) — `GET https://www.wixapis.com/domain-search/v2/suggest-domains`

These are **account-level APIs** — use account-level authentication (e.g., `ManageWixSite` tool), not site-level.

**Important**: Do NOT use the `GetSuggestedDomains` (v1) API — that one requires a `siteId` and only matches existing site names. The `SuggestDomains` (v2) API listed above is the correct one for free-text searches and brainstorming.

---

## Step 1: Understand What the User Needs

Figure out if the user has a specific domain in mind or wants to brainstorm:

- **Specific domain** (e.g., "is mybusiness.com available?") → Go to Step 2
- **Brainstorming** (e.g., "suggest domains for a pancakes business") → Go to Step 3
- **Not sure** → Ask if they have a name in mind or want suggestions

If the user gives a domain without a TLD (e.g., just "mybusiness"), default to checking `.com` first, then offer alternatives if taken.

---

## Step 2: Check Domain Availability

Use this when the user wants to check a specific domain.

**Endpoint**: `GET https://www.wixapis.com/domain-search/v2/check-domain-availability`

**Query Parameters**:
| Parameter | Description | Example |
|-----------|-------------|---------|
| `domain` | Full domain name including TLD | `mybusiness.com` |

**Example Request**:
```
GET https://www.wixapis.com/domain-search/v2/check-domain-availability?domain=mybusiness.com
```

**Response when available**:
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

**Response when taken**:
```json
{
  "availability": {
    "domain": "mybusiness.com",
    "available": false,
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
| `premium` | `true` if this is a premium-priced domain (costs more than standard) |
| `premiumType` | Type of premium pricing (if applicable) |

### Rules

- The `domain` field **must** include the TLD (e.g., `mybusiness.com`, not just `mybusiness`)
- If you get a `DOMAINS_UNSUPPORTED_TLD` error, tell the user that TLD isn't supported by Wix and suggest alternatives

### When the domain is taken

If the domain is not available, **immediately run Step 3** (Suggest Domains) using the same keyword to offer alternatives. Don't just say "it's taken" and stop — always provide alternatives.

---

## Step 3: Suggest Domain Names

Use this when brainstorming domain ideas or offering alternatives for a taken domain.

This API accepts free-text queries — it works with business descriptions, keywords, brand concepts, not just domain names. For example: "pancakes business", "modern yoga studio", "photography portfolio".

**Endpoint**: `GET https://www.wixapis.com/domain-search/v2/suggest-domains`

**Query Parameters**:
| Parameter | Description | Example |
|-----------|-------------|---------|
| `query` | Keywords, business idea, or brand concept | `pancakes business` |
| `paging.limit` | Number of suggestions (default: 10) | `10` |
| `tlds` | Filter by specific TLDs (repeatable, no dots) | `com`, `net` |

**Example — free text brainstorming**:
```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query=pancakes+business&paging.limit=10
```

**Example — alternatives for a taken domain**:
```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query=mybusiness&paging.limit=10
```

**Example — filtered by TLDs**:
```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query=mybusiness&paging.limit=5&tlds=com&tlds=net
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

### Presenting Suggestions

When showing suggestions to the user:
- List the domain names clearly
- Flag premium domains (they cost more than standard pricing)
- If the user has a preference for TLD type, highlight relevant ones (e.g., `.com` for general business, `.shop`/`.store` for e-commerce, `.me` for personal branding)
- All returned suggestions are available for purchase

### Pagination

If `pagingMetadata.hasNext` is `true`, more suggestions exist. Use `cursors.next` to fetch the next page if the user wants to see more options.

---

## Step 4: Next Steps

After the user picks a domain:
- If they want to **purchase** it through Wix, follow the Domain Purchase recipe to generate a checkout link
- If they want to **connect** an external domain they already own, follow the Domain Connection recipe

---

## Error Handling

| Error Code | Description | Action |
|------------|-------------|--------|
| `DOMAINS_UNSUPPORTED_TLD` | The TLD is not supported by Wix | Tell the user and suggest supported TLDs using the Suggest Domains API |
| `access_denied` | Authentication issue | Use account-level API authentication (not site-level) |

---

## Example Flows

### Flow 1: User checks a specific domain

1. User: "Is mybusiness.com available?"
2. Check availability → `available: false`
3. Tell user it's taken, immediately suggest alternatives using query `mybusiness`
4. Show 10 suggestions
5. User picks one → direct to purchase or connection recipe

### Flow 2: User brainstorms domain ideas

1. User: "I need a domain for my pancakes restaurant"
2. Use Suggest Domains with query `pancakes restaurant`
3. Show suggestions with TLD recommendations
4. User picks one → verify availability, then direct to purchase or connection recipe

### Flow 3: Unsupported TLD

1. User: "Check if mybusiness.io is available"
2. Check availability → `DOMAINS_UNSUPPORTED_TLD` error
3. Tell user `.io` is not supported by Wix
4. Suggest alternatives using query `mybusiness` → show available options with supported TLDs
