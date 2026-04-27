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

There is no API to purchase a domain directly. Instead, you generate a **purchase checkout link** that the user opens in their browser to complete the purchase. The checkout page handles everything: plan selection (domain + site plan or domain only), registration period, contact info, privacy protection, and payment.

This is the main goal of this recipe: get the user to a working checkout link as fast as possible.

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

## Step 2: Generate the Purchase Link

This is the most important step. You MUST generate this link and share it with the user.

**Purchase URL format**:

```
https://manage.wix.com/get-domain?domainName={DOMAIN_NAME}&flowType=purchase
```

Replace `{DOMAIN_NAME}` with the chosen domain including TLD.

**Example**: for domain `mybakery.com`:

```
https://manage.wix.com/get-domain?domainName=mybakery.com&flowType=purchase
```

The checkout page will let the user:
- Choose between getting the domain free with a site plan (best value) or buying the domain only
- Select a registration period (1, 2, 3, 5, or 10 years)
- Fill in contact information
- Add privacy & security protection (WHOIS privacy)
- Complete payment

Present this link to the user and tell them to click it to complete the purchase.

**Rules**:
- Always verify availability before generating the link
- Do NOT tell the user to "go to the Wix dashboard and search for the domain" -- generate the direct link instead
- Do NOT say you can't generate a purchase link -- you can, using the format above
- Do NOT ask which site to connect to -- the checkout page handles that

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
3. Generate link: `https://manage.wix.com/get-domain?domainName=mybakery.com&flowType=purchase`
4. Share link with user

### Flow 2: Domain taken, suggest alternatives

1. User: "I want to buy coolstartup.com"
2. Check availability -> available: false
3. Suggest alternatives -> show 10 options
4. User picks "coolstartup.online"
5. Verify availability -> available: true
6. Generate link: `https://manage.wix.com/get-domain?domainName=coolstartup.online&flowType=purchase`
7. Share link with user

### Flow 3: Unsupported TLD

1. User: "Buy mysite.io"
2. Check availability -> DOMAINS_UNSUPPORTED_TLD
3. Tell user .io is not supported, suggest alternatives
4. User picks "mysite.online"
5. Verify, generate link, share it
