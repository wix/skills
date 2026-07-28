---
name: "Domain Search and Purchase"
description: Help users find and buy a new domain or connect one they already own to their Wix site.
---

# Domain Search and Purchase

Use this recipe when a user wants to:
- Search for and buy a domain through Wix
- Connect a domain they already own to their Wix site
- Says something like "I want a domain", "buy mybusiness.com", "I have a domain", "connect my domain"

**UX rule:** Execute checks silently. Never expose technical language (API names, error codes, endpoint paths, tool names) to the user under any circumstances. Reveal information only when it changes what the user needs to do next.

---

## Step 1: Ask for the Domain

If the user hasn't named a domain, ask: *"What domain do you have in mind?"*

If a business name or relevant keywords are available from context or the conversation, immediately show **3 available suggestions** from the Suggest Domains API so the user has something to react to:

```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query={business name or keywords}&paging.limit=3
```

If no business name or keywords are available, skip proactive suggestions and wait for the user's answer.

All returned suggestions are available for purchase — they are **not** registered and cannot be connected right now. Show them as purchase alternatives only.

> Do NOT use the `GetSuggestedDomains` tool — always use the v2 endpoint above.

If `pagingMetadata.hasNext: true`, add: *"Let me know if you'd like to see more available options."*

If the user selects one of the suggestions, treat it as available and proceed directly to Step 3 — skip Step 2.

**Normalize the domain before any API call:**
- Remove `http://` / `https://` and `www.` prefixes
- Add `.com` if no TLD given: `example` → `example.com`

---

## Step 2: Check Availability

```
GET https://www.wixapis.com/domain-search/v2/check-domain-availability?domain={domain}
```

No special auth headers — this is a public API.

| Result | Action |
|--------|--------|
| `available: true` | Domain is NOT registered → see [Available Domain](#available-domain) |
| `available: false` | Domain IS registered → continue to Step 3 |
| `DOMAINS_UNSUPPORTED_TLD` error | → see [Unsupported TLD](#unsupported-tld) |

> ⚠️ Ignore the `premium` field in this response — it refers to domain pricing, not site Premium status.

### Available Domain

The domain is unregistered — it can't be connected, only purchased. Respond:

> "[DOMAIN] isn't registered yet — you can lock it in. Get it now →"

Continue to Step 3 to resolve the site context, then Step 4P for registration and checkout.

### Taken Domain

Respond with:

> "Domain is already registered. If it's yours — connect it to a Wix site. Here are alternatives that fit your brand."

Show the alternatives widget. The user signals connect intent by clicking **Connect**; they signal purchase intent by selecting a suggestion. The connect path continues to Step 3 below.

### Unsupported TLD

> "We don't currently support .[TLD] domains."

**Purchase intent:** Call the Suggest Domains API using the SLD only (e.g. for `mybusiness.xyz` query with `mybusiness`) to show 3 available alternatives with supported TLDs:

```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query={SLD}&paging.limit=3
```

Present the results as purchase options. If the user selects one, proceed directly to Step 3.

**Connect intent:** Ask: *"Do you have a different domain you'd like to connect?"* If yes, restart from Step 1 with the new domain.

---

## Step 3: Resolve UUID / MSID

> ⚠️ **This step is shared by both the connect and purchase intents.** Run it before any Premium or voucher check.

Determine which Wix site to associate with this domain and get its `siteId` (MSID/UUID).

### UUID already in context

**Condition:** `siteId` / `msid` is already present in the environment (site dashboard, headless setup).

**Action:** Use it directly. Do NOT call `ListWixSites`. Proceed as **resolved with MSID**.

---

### No UUID — resolve from context

**Condition:** No `siteId` in context.

**Case A — user is in a site context** (dashboard or mentions a specific site by name):
→ Extract the MSID from the environment. Proceed as **resolved with MSID**.

**Case B — no site context:**
Call `ListWixSites`.
- Single site returned → use it directly, proceed as **resolved with MSID**.
- Multiple sites → list them and ask the user to pick one. Once selected → proceed as **resolved with MSID**.

---

### Standalone — no Wix site

**Condition:** No UUID and the user has no Wix site (or `ListWixSites` returns empty).

**Purchase intent:** Ask: *"Are you planning to connect this domain to a Wix site?"*

**Connect intent:** Ask: *"You'll need a Wix site to connect to. Do you have one, or would you like to create one?"*

| User answer | Action |
|-------------|--------|
| Yes (either intent) | Show sign in / sign up widget → after authentication, re-resolve UUID → proceed as **resolved with MSID** |
| No (purchase intent) | Skip 4P-a entirely — proceed directly to 4P-b. Pricing, privacy, and contact collection still apply; in 4P-d use the standalone checkout URL (no `msid`). |
| No (connect intent) | End flow. Respond: *"Connecting a domain requires a Wix site. Want to create one?"* — if yes, show sign-up widget. |

---

> After Step 3: **purchase intent** → Step 4P · **connect intent** → Step 4C

---

## Step 4P: Purchase Path

### 4P-a — Premium check

> Skip if standalone (no MSID).

```
GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}
```
Extract `payload.premiumState`. `allowedDomain = premiumState !== "FREE"`.

| `allowedDomain` | Action |
|----------------|--------|
| `true` | Inform: "Your domain will auto-connect to your site after purchase." Proceed to 4P-b. |
| `false` | Run TLD voucher and sale checks below, then show split page. |

**If `allowedDomain: false` — TLD voucher and sale check:**

```
GET https://manage.wix.com/_serverless/premium-domains-serverless/domain-tlds/list-tlds?tlds={TLD_WITHOUT_DOT}
```
(e.g. `tlds=com` for `.com`, `tlds=net` for `.net`) → extracts `couponsApplicable` (boolean) from the matching TLD object.

```
GET https://manage.wix.com/store/api/v1/sale/8b1b47e6-9f58-4e59-b147-cac894bec8da?productTypeId=8b1b47e6-9f58-4e59-b147-cac894bec8da
```
The same UUID appears in both the path and the query param — this is correct by design.
`isOnSale = response body is not an empty object`.

Present two options inline in the conversation (do not redirect to an external URL):

- **Option A:** "Get your site live at this domain with a Premium plan"
- **Option B:** "Get domain for now without connecting it"

Append complimentary messages when applicable:
- If `couponsApplicable: true` → add: "{DOMAIN} free for the first year"
- If `isOnSale: true` → add: "50% off select Premium plans"

**Split-page choices:**
- User picks Premium + domain → share the upgrade link and end the flow:
  `https://manage.wix.com/premium-pricing/studio/select-plan?domainName={DOMAIN}&referralAdditionalInfo=add-domain-purchase-intent&siteGuid={siteId}&showDomain=true`
  Replace `studio` with `sunrise` for Classic editor sites (same detection logic as Step 5C).
  Closing message: *"Here's where you can pick a plan and get {DOMAIN} after →"*
- User picks domain only → drop MSID, continue as standalone into 4P-b.

### 4P-b — Registration details (collect in parallel)

**Pricing:** `POST https://manage.wix.com/_api/premium-purchase-platform-serverless/v1/offering/72af0602-1321-4897-8299-f507480b2bb8`
Body: `{ "purchaseContext": { "params": { "tld": ".<TLD>" } } }`
Show `products[0].pricingDetails[]` as 1yr / 2yr / 3yr table. Ask user to pick. Default 1 year.
If no products returned → TLD not supported, suggest `.com` / `.net` / `.org`.

**Privacy:**

| Option | Description | Product ID |
|--------|-------------|-----------|
| Privacy + DNSSEC *(recommended)* | Hides WHOIS info + DNS spoofing protection | `f8211619-d9f6-4312-9d03-f2958bbd08aa` |
| Privacy only | Hides WHOIS info | `22a84545-4ac0-4490-a434-45a1ebc479fb` |
| No protection | Contact info publicly visible | `b9d89ff0-f29b-4bfd-a3f0-6e34ae65120d` |

Addon product type (all three): `b3d86a1d-9db3-4f69-bd54-c132808856b1`

**Contact:** `GET https://manage.wix.com/v1/domain-registration-intents/preview/{domain}`

Response contains `domainRegistrationIntent` with existing contacts:
```json
{
  "domainRegistrationIntent": {
    "registrantContact": {
      "firstName": "...", "lastName": "...", "email": "...", "phone": "...",
      "streetAddress": "...", "city": "...", "country": "...", "postalCode": "..."
    },
    "adminContact": { ... },
    "techContact": { ... }
  }
}
```

> Address fields are **flat** on each contact (`streetAddress`, `city`, `country`, `postalCode`) — there is no nested `address` sub-object.

- **Contacts exist:** Show the info and explicitly ask *"Should I use these details, or would you like to register with different info?"* Wait for the user to confirm before proceeding to 4P-c. Do NOT skip this confirmation.
- **No contacts:** Ask the user for: first name, last name, email, phone number, street address, city, country, and postal code. The user can provide country as a full name (e.g. "Israel", "United States") — convert it to the 2-letter ISO country code (e.g. "IL", "US") before sending to the API. Wait for all fields before proceeding.

### 4P-c — Save contact info

Generate a random RFC 4122 v4 UUID as `sessionId` (wsess).

`POST https://manage.wix.com/v1/domain-registration-intents/upsert`
Body: `{ "domainRegistrationIntent": { "domain": "{domain}", "sessionId": "<wsess>", "registrantContact": {...}, "adminContact": {...same...}, "techContact": {...same...} } }`

On validation error → highlight the fields mentioned in the error response and ask the user to correct them. If the error doesn't name specific fields, re-ask for all required contact fields. Continue to 4P-d only when all inputs are valid.

### 4P-d — Cart and checkout

Use `CallWixSiteAPI` (with `siteId`) if MSID is in play, otherwise `ManageWixSite`. Both tools carry the Wix session auth automatically — no extra headers needed for the cart calls below.

1. Cancel cart: `POST https://manage.wix.com/_api/premium-cart/v1/carts/active/cancel` Body: `{}`
2. Get fresh cart: `GET https://manage.wix.com/_api/premium-cart/v1/carts/active`
3. Add items: `PATCH https://manage.wix.com/_api/premium-cart/v1/carts/active/add-items`
```json
{
  "lineItems": [
    {
      "productInfo": { "productId": "<from 4P-b pricing>", "productTypeId": "72af0602-1321-4897-8299-f507480b2bb8" },
      "cycle": { "cycleDuration": { "count": <years>, "unit": "YEAR" }, "cycleType": "RECURRING" },
      "metadata": { "domainName": "{domain}", "wsess": "<wsess>", "core": "true" }
    },
    {
      "productInfo": { "productId": "<from 4P-b privacy>", "productTypeId": "b3d86a1d-9db3-4f69-bd54-c132808856b1" },
      "cycle": { "cycleDuration": { "count": <years>, "unit": "YEAR" }, "cycleType": "RECURRING" },
      "metadata": { "domainName": "{domain}", "wsess": "<wsess>" }
    }
  ]
}
```
4. Re-check `premiumStatus` (same endpoint as 4P-a). The user may have upgraded during contact collection. Branch on the result:

| `premiumState` | Checkout URL |
|----------------|-------------|
| non-FREE (upgraded since 4P-a) | Restore MSID if available → `https://manage.wix.com/cart/checkout?msid={siteId}` |
| FREE, MSID available | `https://manage.wix.com/cart/checkout?msid={siteId}` |
| FREE, standalone | `https://manage.wix.com/cart/checkout` |

---

## Step 4C: Connect Path — Premium Check

> Runs only after **resolved with MSID**.

```
GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}
```
Extract `payload.premiumState`. `allowedDomain = premiumState !== "FREE"`.

---

## Step 5C: Connect Path — Route to Connection or Upgrade

### Premium site (`allowedDomain: true`)

**Message (verbatim):**
> "Great choice! Click here to connect."

**Action (same response):** Open a new window to:
```
https://manage.wix.com/dashboard/{siteId}/add-domain/results?q={domainName}
```
Use the full domain in the URL. Use `displayName` (truncated if needed) as the visible link label.

Do not add any text after the link.

### Free site (`allowedDomain: false`)

Show this message inline in the conversation (verbatim):

> **Upgrade your site with a Premium plan to connect your domain**
>
> Connecting a domain is a Premium feature. Upgrade now to let visitors reach you at a custom web address and enjoy Premium benefits.
>
> [Upgrade →]

The Upgrade link:
`https://manage.wix.com/premium-pricing/studio/select-plan?siteGuid={siteId}`

Replace `studio` with `sunrise` for Classic editor sites.

Detect editor type: if the dashboard URL contains `/studio/` or the site context exposes `editorType: "studio"`, use `"studio"`. When uncertain, default to `"sunrise"`.

---

## Error Handling

Retry any failed call once silently. If still failing, respond with one of:

- *"Something went wrong on our end. Please try again in a moment."*
- *"Having trouble loading this — try refreshing the page."*
- As a fallback, always offer: *"You can connect to Wix and search for a domain there → [manage.wix.com/domains]"*

Never expose technical language: no API names, error codes, endpoint paths, tool names, or phrases like "the request failed" or "let me retry".
