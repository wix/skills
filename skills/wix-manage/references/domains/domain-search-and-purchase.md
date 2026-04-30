---
name: "Domain Search and Purchase"
description: Help users buy a domain through Wix. Check availability, suggest alternatives if taken, and generate a purchase checkout link. The purchase link is the key output of this recipe - always generate it when the user wants to buy a domain.
---
# Domain Search and Purchase

Use this recipe when a user wants to:
- Buy / purchase a domain
- Register a domain through Wix
- Get a custom domain for their Wix site
- Check if a domain is available and then buy it
- Says something like "buy me a domain", "I want to purchase a domain", "get me mybusiness.com"

## How Purchase Works

There is no API to purchase a domain directly. Instead, you generate a **purchase checkout link** that the user opens in their browser to complete the purchase. The checkout page handles everything: plan selection (domain + site plan or domain only), registration period, contact info, privacy protection, and payment.

This is the main goal of this recipe: get the user to a working checkout link as fast as possible.

## Important: No Site Required

This recipe does NOT require a site. Do NOT call `ListWixSites` or ask the user to pick a site. Domain search and purchase is completely independent of any Wix site.

## Required APIs

- **Check Domain Availability**: `GET https://www.wixapis.com/domain-search/v2/check-domain-availability`
- **Suggest Domains**: `GET https://www.wixapis.com/domain-search/v2/suggest-domains`

These are **public APIs that require no special authentication or scopes**. Just make a plain GET request to the URL with query parameters. No extra headers, no account-level auth, no site-level auth. No tokens needed.

**Important**: Do NOT use `GetSuggestedDomains` tool for domain suggestions in this recipe. Use the `SuggestDomains` v2 endpoint above instead -- it accepts free-text queries and does not need a site ID.

---

## Step 1: Find an Available Domain

### If the user has a specific domain in mind

Check if it's available using:

`GET https://www.wixapis.com/domain-search/v2/check-domain-availability?domain={domain}`

The `domain` parameter **must** include the TLD (e.g., `mybusiness.com`, not just `mybusiness`). If the user gives a name without a TLD, default to `.com` first.

**Response when available**:
```json
{
  "availability": {
    "domain": "mybusiness.com",
    "available": true,
    "premium": false
  }
}
```

**Response when taken**:
```json
{
  "availability": {
    "domain": "mybusiness.com",
    "available": false
  }
}
```

- **available: true** -> Proceed to Step 2
- **available: false** -> Do NOT just say "it's taken" and stop. Immediately suggest alternatives (see below).
- **DOMAINS_UNSUPPORTED_TLD error** -> Tell the user that TLD isn't supported by Wix, then suggest alternatives with supported TLDs (see below).

### If the domain is taken, unsupported, or the user wants ideas

Use the **Suggest Domains v2** API to find available alternatives:

`GET https://www.wixapis.com/domain-search/v2/suggest-domains`

**IMPORTANT**: Do NOT use the `GetSuggestedDomains` tool for this. Always use the v2 endpoint above.

This API accepts **free-text queries** -- it works with business descriptions, keywords, and brand concepts, not just domain names. For example: "pancakes business", "modern yoga studio", "photography portfolio".

**Query Parameters**:
| Parameter | Description | Example |
|-----------|-------------|---------|
| `query` | Keywords, business idea, or brand concept | `pancakes business` |
| `paging.limit` | Number of suggestions (default: 10) | `10` |
| `tlds` | Filter by specific TLDs (repeatable, no dots) | `com`, `net` |

**Example -- alternatives for a taken domain**:
```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query=mybusiness&paging.limit=10
```

**Example -- brainstorming from a business idea**:
```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query=pancakes+business&paging.limit=10
```

**Example -- filtered by TLDs**:
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

When presenting suggestions:
- List the domain names clearly
- All returned suggestions are already available for purchase -- no need to re-check availability
- Do NOT show a "Premium" column or flag premium domains -- it confuses users
- If the user has a TLD preference, highlight relevant ones (`.com` for general business, `.shop`/`.store` for e-commerce, `.me` for personal branding)
- If no suggestions come back, ask the user to try different keywords or broader terms
- If `pagingMetadata.hasNext` is true, more suggestions exist -- offer to show more

Once the user picks a domain (or the original was available), proceed to Step 2.

---

## Step 2: Generate the Purchase Link

This is the most important step. You MUST generate this link and share it with the user.

**Purchase URL format**:

```
https://manage.wix.com/premium-domains/split-page?domainName={DOMAIN_NAME}
```

Replace `{DOMAIN_NAME}` with the chosen domain including TLD.

**Example**: for domain `mybakery.com`:

```
https://manage.wix.com/premium-domains/split-page?domainName=mybakery.com
```

This link opens a page where the user can:
- Get the domain **free with a site plan** (best value -- includes a Wix site plan with the domain free for the first year)
- Or **buy the domain only** at full price
- Then continue to select registration period (1-10 years), fill in contact info, add privacy protection, and complete payment

Present this link as a clickable markdown link, not as a raw URL. For example:

```
[Click here to purchase mybakery.com](https://manage.wix.com/premium-domains/split-page?domainName=mybakery.com)
```

**Rules**:
- Always verify availability (Step 1) before generating the link
- Do NOT tell the user to "go to the Wix dashboard and search for the domain" -- generate the direct link instead
- Do NOT say you can't generate a purchase link -- you can, using the format above
- Do NOT ask which site to connect to -- the checkout page handles that

---

## Error Handling

| Error Code | Description | Action |
|------------|-------------|--------|
| `DOMAINS_UNSUPPORTED_TLD` | TLD not supported by Wix | Suggest alternatives using Suggest Domains API |
| `access_denied` or `403` | Auth issue | These are public APIs -- make sure you're not adding extra auth headers or scopes |

---

## Example Flows

### Flow 1: Direct purchase (happy path)

1. User: "Buy me mybakery.com"
2. Check availability -> available: true
3. Generate link: `https://manage.wix.com/premium-domains/split-page?domainName=mybakery.com`
4. Share link with user

### Flow 2: Domain taken, suggest alternatives

1. User: "I want to buy coolstartup.com"
2. Check availability -> available: false
3. Suggest alternatives with query "coolstartup" -> show 10 options
4. User picks "coolstartup.online"
5. Generate link: `https://manage.wix.com/premium-domains/split-page?domainName=coolstartup.online`
6. Share link with user

### Flow 3: Brainstorming from scratch

1. User: "I need a domain for my pancakes restaurant"
2. Suggest domains with query "pancakes restaurant" -> show 10 options
3. User picks "stackedpancakes.com"
4. Generate link: `https://manage.wix.com/premium-domains/split-page?domainName=stackedpancakes.com`
5. Share link with user

### Flow 4: Unsupported TLD

1. User: "Buy mysite.io"
2. Check availability -> DOMAINS_UNSUPPORTED_TLD
3. Tell user .io is not supported, suggest alternatives with query "mysite"
4. User picks "mysite.online"
5. Verify availability, generate link, share it
