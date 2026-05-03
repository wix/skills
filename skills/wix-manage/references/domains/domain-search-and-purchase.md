---
name: "Domain Search and Purchase"
description: Help users buy a domain through Wix. Check availability, suggest alternatives if taken, collect registration details (cycle, privacy, contact info), create a pre-configured cart, and provide a checkout link where the user just pays.
---
# Domain Search and Purchase

Use this recipe when a user wants to:
- Buy / purchase a domain
- Register a domain through Wix
- Get a custom domain for their Wix site
- Check if a domain is available and then buy it
- Says something like "buy me a domain", "I want to purchase a domain", "get me mybusiness.com"

## How Purchase Works

You help the user find an available domain, then collect registration details (cycle, privacy protection, contact info) directly in the chat. Once collected, you save the contact info, create a cart with the domain + addons, and provide a checkout link where the user only needs to complete payment.

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

## Step 2: Collect Registration Details

Once the user picks a domain, collect the details needed for purchase.

### 2a: Show pricing and ask for registration period

Get available cycles and pricing for the chosen TLD:

**Request** (via `ManageWixSite`):
```
POST https://manage.wix.com/_api/premium-purchase-platform-serverless/v1/offering/72af0602-1321-4897-8299-f507480b2bb8
```
Body:
```json
{
  "purchaseContext": {
    "params": { "tld": ".com" }
  }
}
```

Replace `.com` with the actual TLD (include the leading dot).

**Response** contains `products[0]` with:
- `productId` -- save this, you'll need it for the cart
- `pricingDetails[]` -- array of pricing per cycle

Present the pricing to the user as a table, for example:

| Period | Price |
|--------|-------|
| 1 year | $14.95 |
| 2 years | $27.90 |
| 3 years | $40.85 |

Ask the user which period they prefer. Default to 1 year if they don't have a preference.

If the API returns no products for this TLD, tell the user: "This TLD isn't available for purchase through chat yet. You can buy it at [wix.com/domains](https://www.wix.com/domains)."

### 2b: Ask about privacy protection

Ask: "Would you like to add domain privacy protection? It hides your personal contact info from public WHOIS lookups. Recommended: yes."

- If yes (recommended): use addon product ID `f8211619-d9f6-4312-9d03-f2958bbd08aa` (privacy + DNSSEC)
- If no: skip the addon line item

### 2c: Collect or confirm contact info

First, check if the user already has contact info on file:

**Request** (via `ManageWixSite`):
```
GET https://manage.wix.com/v1/domain-registration-intents/preview/{domain}
```

Replace `{domain}` with the chosen domain (e.g. `mybakery.com`).

**Response** contains `domainRegistrationIntent` with existing contacts:
```json
{
  "domainRegistrationIntent": {
    "registrantContact": { "firstName": "...", "lastName": "...", "email": "...", "phone": "...", "address": { ... } },
    "adminContact": { ... },
    "techContact": { ... }
  }
}
```

- **If contacts exist**: Show the info and explicitly ask "Should I use these details, or would you like to register with different info?" Wait for the user to confirm before proceeding to Step 3. Do NOT skip this confirmation.
- **If contacts are empty**: Ask the user for: first name, last name, email, phone number, street address, city, country, and postal code. Wait for them to provide all fields before proceeding.

---

## Step 3: Save Contact Info

Generate a random UUID to use as a session ID (`wsess`). This links the contact info to the cart.

**Request** (via `ManageWixSite`):
```
POST https://manage.wix.com/v1/domain-registration-intents/upsert
```
Body:
```json
{
  "domainRegistrationIntent": {
    "domain": "mybakery.com",
    "sessionId": "<random-uuid>",
    "registrantContact": {
      "firstName": "John",
      "lastName": "Smith",
      "email": "john@email.com",
      "phone": "+1.5551234567",
      "address": {
        "streetAddress": "123 Main St",
        "city": "New York",
        "country": "US",
        "postalCode": "10001"
      }
    },
    "adminContact": { ... same as registrant ... },
    "techContact": { ... same as registrant ... }
  }
}
```

Use the same contact info for registrant, admin, and tech contacts (standard practice for individual registrations).

Phone format: `+{countryCode}.{number}` (e.g. `+1.5551234567`, `+972.544738293`).

If the API returns a validation error:
- Show the user exactly which fields have issues (missing, invalid format, etc.)
- Ask them to provide corrected values for those specific fields
- Retry the upsert with the corrected data
- Some TLDs require extra fields (e.g. .com.br needs an identification number, .it needs entity type). If the error mentions TLD-specific requirements, explain what's needed and ask the user to provide it.

---

## Step 4: Create Cart and Checkout Link

### 4a: Cancel any existing cart

```
POST https://manage.wix.com/_api/premium-cart/v1/carts/active/cancel
```
Body: `{}`

This clears any leftover cart. If there's no active cart, this returns successfully anyway.

### 4b: Get a fresh cart

```
GET https://manage.wix.com/_api/premium-cart/v1/carts/active
```

This creates a new cart if none exists and returns it.

### 4c: Add domain and addon to cart

```
PATCH https://manage.wix.com/_api/premium-cart/v1/carts/active/add-items
```
Body:
```json
{
  "lineItems": [
    {
      "productInfo": {
        "productId": "<productId from Step 2a>",
        "productTypeId": "72af0602-1321-4897-8299-f507480b2bb8"
      },
      "cycle": {
        "cycleDuration": { "count": 1, "unit": "YEAR" },
        "cycleType": "RECURRING"
      },
      "metadata": {
        "domainName": "mybakery.com",
        "wsess": "<same random-uuid from Step 3>",
        "core": "true"
      }
    }
  ]
}
```

Set `cycle.cycleDuration.count` to the number of years the user chose.

If the user selected privacy protection, add a second line item in the same `lineItems` array:
```json
{
  "productInfo": {
    "productId": "f8211619-d9f6-4312-9d03-f2958bbd08aa",
    "productTypeId": "b3d86a1d-9db3-4f69-bd54-c132808856b1"
  },
  "cycle": {
    "cycleDuration": { "count": 1, "unit": "YEAR" },
    "cycleType": "RECURRING"
  },
  "metadata": {
    "domainName": "mybakery.com",
    "wsess": "<same random-uuid from Step 3>"
  }
}
```

Use the same cycle duration for the addon as for the domain.

### 4d: Provide checkout link

Once the cart is populated, give the user this link:

```
[Click here to complete your purchase](https://manage.wix.com/cart/checkout)
```

This opens the checkout page with the pre-filled cart. The user only needs to complete payment.

---

## Error Handling

| Error Code | Description | Action |
|------------|-------------|--------|
| `DOMAINS_UNSUPPORTED_TLD` | TLD not supported by Wix | Suggest alternatives using Suggest Domains API |
| `access_denied` or `403` on domain search APIs | Auth issue | These are public APIs -- do not add extra auth headers |
| Offering API returns no products | TLD not available for chat purchase | Tell user to buy at wix.com/domains |
| Intent API validation error | Missing/invalid contact fields | Show the error, ask user to correct, retry |
| Cart add-items fails | Product ID or format issue | Verify product ID came from offering API response |

---

## Example Flows

### Flow 1: Full purchase (happy path)

1. User: "Buy me mybakery.com"
2. Check availability -> available: true
3. Get pricing for .com -> show cycles table
4. User picks 1 year
5. Ask about privacy -> user says yes
6. Preview contact info -> shows existing info -> user confirms
7. Save contact via intent API (generate wsess UUID)
8. Cancel old cart -> get fresh cart -> add domain + privacy addon
9. Share checkout link: [Complete your purchase](https://manage.wix.com/cart/checkout)

### Flow 2: Domain taken, suggest alternatives, then full purchase

1. User: "I want to buy coolstartup.com"
2. Check availability -> available: false
3. Suggest alternatives with query "coolstartup" -> show 10 options
4. User picks "coolstartup.online"
5. Get pricing for .online -> show cycles table
6. User picks 2 years
7. Ask about privacy -> user says no
8. Preview contact info -> empty -> ask user for details
9. User provides: name, email, phone, address
10. Save contact via intent API
11. Create cart with domain only (no addon), 2-year cycle
12. Share checkout link

### Flow 3: Brainstorming from scratch

1. User: "I need a domain for my pancakes restaurant"
2. Suggest domains with query "pancakes restaurant" -> show 10 options
3. User picks "stackedpancakes.com"
4. Get pricing for .com -> show cycles
5. User picks 1 year, wants privacy
6. Confirm contact info -> user confirms existing info
7. Save contact, create cart, share checkout link

### Flow 4: Unsupported TLD

1. User: "Buy mysite.io"
2. Check availability -> DOMAINS_UNSUPPORTED_TLD
3. Tell user .io is not supported, suggest alternatives with query "mysite"
4. User picks "mysite.online"
5. Continue with full purchase flow (pricing, privacy, contact, cart, checkout)
