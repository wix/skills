---
name: "Domain Search and Purchase"
description: Help users buy a domain through Wix. Check availability, suggest alternatives if taken, and generate a purchase checkout link. The purchase link is the key output of this recipe - always generate it when the user wants to buy a domain.
---
# Domain Search and Purchase

Use this recipe when a user wants to:
- Buy / purchase a domain
- Register a domain through Wix
- Get a custom domain for their Wix site
- Says something like "buy me a domain", "I want to purchase a domain", "get me mybusiness.com"

For users who only want to check availability or brainstorm domain ideas without purchasing, use the Domain Search and Suggestions recipe instead.

## How Purchase Works

There is no API to purchase a domain directly. Instead, you generate a **purchase checkout link** that the user opens in their browser to complete the purchase. This is the main goal of this recipe: get the user to a working checkout link as fast as possible.

## Required APIs

- **Check Domain Availability**: `GET https://www.wixapis.com/domain-search/v2/check-domain-availability`
- **Suggest Domains**: `GET https://www.wixapis.com/domain-search/v2/suggest-domains`

All are **account-level APIs** -- use account-level authentication.

---

## Step 1: Check Availability

If the user has a specific domain in mind, check if it's available.

**Endpoint**: `GET https://www.wixapis.com/domain-search/v2/check-domain-availability?domain={domain}`

If the user gives a domain without a TLD (e.g. just "mybusiness"), default to `.com` first.

**If available**: proceed to Step 2.

**If taken**: immediately suggest alternatives using `GET https://www.wixapis.com/domain-search/v2/suggest-domains?query={keyword}&paging.limit=10`. Let the user pick one, then proceed to Step 2.

**If unsupported TLD**: tell the user and suggest alternatives with supported TLDs.

---

## Step 2: Select Target Site

Use the `ListWixSites` tool to list the user's sites. Ask the user which site they want to connect the domain to. You need the **site ID** (UUID) for the purchase link.

If the user only has one site, confirm it and move on.

---

## Step 3: Generate the Purchase Link

This is the most important step. You MUST generate this link and share it with the user.

**Purchase URL format**:

```
https://manage.wix.com/dashboard/{SITE_ID}/premium-express-checkout-app/storefront-bundle-selection?domainName={DOMAIN_NAME}&locale=en
```

Replace:
- `{SITE_ID}` with the site UUID from Step 2
- `{DOMAIN_NAME}` with the chosen domain including TLD

**Example**: for site ID `db064689-f61a-4e1b-82e6-45fb01e936ef` and domain `mybakery.com`:

```
https://manage.wix.com/dashboard/db064689-f61a-4e1b-82e6-45fb01e936ef/premium-express-checkout-app/storefront-bundle-selection?domainName=mybakery.com&locale=en
```

Present this link to the user and tell them to open it to complete the purchase. The checkout page handles payment, plan selection, and domain registration.

**Rules**:
- Always verify availability before generating the link
- Always include the site ID and domain name in the URL
- Do NOT tell the user to "go to the Wix dashboard and search for the domain" -- generate the direct link instead
- Do NOT say you can't generate a purchase link -- you can, using the format above

---

## Error Handling

| Error Code | Description | Action |
|------------|-------------|--------|
| `DOMAINS_UNSUPPORTED_TLD` | TLD not supported by Wix | Suggest alternatives using Suggest Domains API |
| `access_denied` | Auth issue | Use account-level authentication |

---

## Example Flows

### Flow 1: Direct purchase

1. User: "Buy me mybakery.com"
2. Check availability -> available: true
3. List sites, user picks "My Bakery Site" (ID: db064689-...)
4. Generate link: `https://manage.wix.com/dashboard/db064689-.../premium-express-checkout-app/storefront-bundle-selection?domainName=mybakery.com&locale=en`
5. Share link with user

### Flow 2: Domain taken, suggest alternatives

1. User: "I want to buy coolstartup.com"
2. Check availability -> available: false
3. Suggest alternatives -> show 10 options
4. User picks "coolstartup.online"
5. Verify availability -> available: true
6. List sites, user picks their site
7. Generate purchase link and share it

### Flow 3: Unsupported TLD

1. User: "Buy mysite.io"
2. Check availability -> DOMAINS_UNSUPPORTED_TLD
3. Tell user .io is not supported, suggest alternatives
4. User picks "mysite.online"
5. Verify, select site, generate link
