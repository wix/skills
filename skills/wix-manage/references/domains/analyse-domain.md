---
name: "Analyse Domain"
description: Report on the domains in the user's own Wix account — what kind a domain is, which site it is on, when it expires and whether it renews, its add-ons, DNS propagation and SSL state — for one domain, or by listing and filtering the account's domains.
---

# Analyse Domain

Answers one question: **what is the state of a domain in this account?** It only reads. It does not
buy, connect, assign, renew or change DNS, and it says nothing about domains outside the account.

Every call runs in the user's own context: as the signed-in user, never as an app, and never with an API
key or an integration token. The account the user is working in is the account for the call. A domain that
is not in the account comes back as `404`, which is an answer, not a failure (see below). Every domain in
the account, whether registered through Wix or registered elsewhere and connected to Wix, is read from
the domain views.

## Flow

1. **Normalize the domain**: lowercase, trim whitespace, strip `http://`, `https://`, `www.` and any
   path. Keep the extension the user typed. A subdomain (`shop.example.com`) is a valid input here.
2. **One named domain** → look it up (next section), in the one call shown there.
   **A question about the account** ("which expire soon", "which are
   connected from outside Wix") → search or list, then answer from the rows.
3. Read the result (tables below) and answer in plain language, only what was asked.
4. Run the calls silently. For one named domain the lookup call handles its own failures, including its
   one retry of the domain view, so do not retry it. For the account-wide calls, retry a failed call once, silently; if it fails again, say
   "Something went wrong on our end. Please try again in a moment."


Never name an endpoint, a field or an enum value to the user.

## Look up one domain

Make this one read-only call, with whatever lets you run a short script over several Wix API requests at
once. Put the domain in `domain` and the account's ID in `accountId`: it is the Account ID in the Wix
context you already read, and the expiry lookup needs it as `targetAccountId`. Keep the helpers inside the one
function.

It asks for the domain view first. Only when there is none does it look at the `unassigned` list, then
at the `assigned` list, and when neither holds the domain the answer is "not found". Each request is
wrapped so that a failure is an answer ("no view", "no match") and never an error to chase. The call
already retries the domain view once, because its first attempt can fail on a missing call scope and the
second goes through. Do not retry anything yourself, do not try another tool, and do not search the docs.

```javascript
async function() {
  const domain = "example.com";
  const accountId = "ACCOUNT_ID";
  const lists = "https://manage.wix.com/_api/my-domains/v1/domains";
  const renewal = { AUTO_RENEW_ON: true, AUTO_RENEW_OFF: false };

  async function getDomainView() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data } = await wix.request({ scope: "account", method: "GET",
          url: `https://www.wixapis.com/v1/domain-views/${domain}` });
        return data.domainView;
      } catch (e) {}
    }
    return null;
  }

  const getList = kind => wix.request({ scope: "account", method: "GET",
    url: `${lists}/${kind}?filter.searchTerm=${domain}` }).then(r => r.data).catch(() => ({}));

  async function findUnassigned() {
    const { domains = [] } = await getList("unassigned");
    const d = domains.find(x => x.domainName === domain);
    return d && { where: "unassigned", wixRegistration: d.wixRegistration, managementType: d.managementType,
                  expirationDate: d.expiresAt, autoRenew: d.isAutoRenewed };
  }

  async function findAssigned() {
    const { sites = [] } = await getList("assigned");
    for (const { site, primary, redirects = [] } of sites) {
      if (primary?.domainName === domain) return { where: "primary", siteName: site.siteName };
      if (redirects.some(r => r.domainName === domain)) return { where: "redirect", siteName: site.siteName };
    }
    return null;
  }

  async function findPremiumAsset() {
    let cursor;
    for (let page = 0; page < 5; page++) {
      const { data } = await wix.request({ scope: "account", method: "POST",
        url: "https://www.wixapis.com/premium-assets/v2/premium-assets/query",
        headers: { targetAccountId: accountId },
        body: { cursorQuery: { filter: { status: { $in: ["ACTIVE", "NOT_ACTIVE"] } },
                               cursorPaging: { limit: 100, cursor } },
                includePermitted: false } });
      const hit = (data.premiumAssets || []).find(a => a.domainsData?.domain === domain);
      cursor = data.pagingMetadata?.cursors?.next;
      if (hit) return hit;
      if (!data.pagingMetadata?.hasNext || !cursor) return null;
    }
    return null;
  }

  async function withExpiry(match) {
    if (match.expirationDate !== undefined && match.autoRenew !== undefined) return match;
    const asset = await findPremiumAsset().catch(() => null);
    return asset ? { ...match,
      expirationDate: match.expirationDate ?? asset.domainsData.expirationDate,
      autoRenew: match.autoRenew ?? renewal[asset.renewalType] } : match;
  }

  const view = await getDomainView();
  if (view) return { source: "domainView", domainView: view };

  const match = (await findUnassigned()) || (await findAssigned());
  if (!match) return { source: "lists", where: null };
  if (match.wixRegistration === false) {
    return { source: "lists", where: match.where, wixRegistration: false, managementType: match.managementType };
  }
  return { source: "lists", ...(await withExpiry(match)) };
}
```

The wrapping is deliberate. Domain views and the `assigned` list are not reliably reachable from every
session (a domain-view `404` and an `assigned` `400` "subject is missing" were seen), so a failed
request is read as "not there" and the next source is tried.

`source: "domainView"` is the domain view below. `source: "lists"` is the answer from the account's
domain lists, read further down. `expirationDate` and `autoRenew` come from the `unassigned` entry
(`expiresAt`, `isAutoRenewed`). When the entry lacks them, or the domain is on a site, the Premium asset
supplies them; only Wix-registered domains have one. For any other domain they are absent. The returned
object is already trimmed to the exact match: the lists carry far more fields, including registrant
details, and none of them is read or mentioned.

```json
{ "domainView": {
    "id": "example.com", "domain": "example.com", "rootDomain": "example.com",
    "domainType": "REGISTERED",
    "assignment": { "assignedToId": "SITE_ID", "assignmentType": "PRIMARY" },
    "registered": {
      "expirationDate": "2027-03-01T10:00:00Z", "lifecycleStatus": "ACTIVE", "icannStatus": "VERIFIED",
      "subscription": { "autoRenew": true },
      "addons": { "privacy": { "enabled": true, "supported": true },
                  "dnssec": { "enabled": false, "supported": true },
                  "insurance": { "enabled": false, "supported": true } } },
    "dnsPropagation": { "status": "SUCCEEDED" },
    "sslCertificate": { "active": true } } }
```

- Every field except `id`, `domain` and `domainType` can be missing. Report only what is present.

## When the domain has no domain view

The lookup above falls back to the account's domain lists: `assigned` (the sites the user's domains are
on) and `unassigned` (the domains on no site). `filter.searchTerm` matches substrings, so the call keeps
only an exact `domainName` match. Read `where` in the result:

| Result | Say |
|---|---|
| `where` `primary` | "{domain} is in your account, and it's the primary domain of {`siteName`}." |
| `where` `redirect` | "{domain} is in your account, and it redirects to {`siteName`}." |
| `where` `unassigned` | "{domain} is in your account, but it isn't on a site yet", plus the rows below. |
| `wixRegistration` `false` | Start with "{domain} is registered elsewhere and connected to Wix". |
| `wixRegistration` `true` | "It's registered through Wix." |
| `expirationDate` | The date, written out ("1 March 2027"). |
| `autoRenew` `true` / `false` | Auto-renew is on / off. Absent: say nothing about renewal. |
| `managementType` `POINTING` / `DNS` | "Its settings stay at its provider" / "Wix manages its settings". Any other value or none: say nothing about the method. |
| `where` is `null`, including when a request failed | "I can't find {domain} in your Wix account." Do not mention the failed call. A miss is not proof that the user doesn't own it: these lists see the Wix account, not the registry. Never say someone else owns it, and say nothing about who holds it. If the user then asks whether it can be registered, use [Check Domain Availability](check-domain-availability.md); to buy or connect it, [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md). |

This call is the last source: do not search the docs or call any other API, even when the user asked
for an expiry, a renewal or add-ons. Add-ons, SSL and the DNS check are not reported. An expiry or
renewal that the result does not carry is never stated or guessed: say Wix can't report it for this
domain.

## A domain registered elsewhere

A domain the user bought elsewhere and connected to Wix is also a domain view, with `domainType`
`CONNECTED`. Say "It's registered elsewhere and connected to Wix", then report `assignment` and
`dnsPropagation` as in the table below.

A connected domain has no expiry, renewal or add-ons at Wix: its registrar owns those. Never state or guess
them, even when the user asks. The same goes for SSL: never state it for a connected domain, even when
`sslCertificate` is present.

## Reading a registered domain

`domainType` is `REGISTERED` for a domain bought through Wix, and the `registered` block carries the
details. A `CONNECTED` domain has no `registered` block (see above); the other rows apply to both.

| Field | Say |
|---|---|
| `assignment` absent | "It isn't on any site yet." |
| `assignment.assignmentType` `PRIMARY` | "It's the primary domain of the site `assignedToId`." |
| `assignment.assignmentType` `REDIRECT` | "It redirects to {`redirectInfo.primaryDomain`}." |
| `registered.expirationDate` | The date, written out ("1 March 2027"). |
| `registered.lifecycleStatus` `INACTIVE` | "The registration is no longer active" (expired or transferred away). `graceEndDate` and `redemptionEndDate` are the last dates it can still be recovered, when the user asks. |
| `registered.subscription` present | Auto-renew on or off from `autoRenew`. |
| `registered.subscription` absent | "Renewal billing isn't set up yet." Do not say auto-renew is off. |
| `registered.icannStatus` `PENDING` | "The contact email still has to be verified" — an unverified domain is deactivated after a deadline. |
| `registered.icannStatus` `DEACTIVATED` | "It was deactivated because the contact email wasn't verified." |
| `registered.addons.<name>.enabled` | On or off. `supported: true` with `enabled: false` means available but turned off; say nothing about whether it was bought. |
| `registered.premium` `true` | The registry charges more than the standard rate to renew. Give no price. |
| `dnsPropagation.status` | `SUCCEEDED` "the domain's settings are correct"; `IN_PROGRESS` "changes are still spreading, check again later"; `FAILED` "the domain isn't pointing at Wix correctly". Absent: no information, say so. Say "DNS" only if the user did. |
| `sslCertificate.active` | Whether the site on this domain has a valid certificate. |

- `assignedToId` is a site ID. Use the site's name if it is already in the conversation, otherwise give the ID.
- The response carries no price. Never state or estimate one.

## Several domains

`Query` returns the account's domains, registered and connected, up to **100** per call, but can only
filter by `id`. Use it to list everything and filter the rows yourself. `Search` filters and sorts on the
fields listed below, and also matches free text on the domain name. Filter `domainType` on `CONNECTED` for
the domains registered elsewhere.

```
POST https://www.wixapis.com/v1/domain-views/query
Content-Type: application/json

{ "query": { "cursorPaging": { "limit": 100 } } }
```

```
POST https://www.wixapis.com/v1/domain-views/search
Content-Type: application/json

{ "cursorSearch": {
    "filter": { "registered.lifecycleStatus": { "$eq": "ACTIVE" },
                "registered.expirationDate": { "$lt": "2027-01-01T00:00:00Z" } },
    "sort": [ { "fieldName": "registered.expirationDate", "order": "ASC" } ],
    "cursorPaging": { "limit": 100 } } }
```

Both answer `{ "domainViews": [ ... ], "pagingMetadata": { "cursors": { "next": "..." }, "hasNext": true } }`.
Both return at most 100 per page (`Search` defaults to 50); a larger `limit` is a `400`. While
`hasNext` is `true`, repeat the call with `"cursorPaging": { "limit": 100, "cursor": "<cursors.next>" }`
(inside `query` for Query, inside `cursorSearch` for Search) before answering a question about "all" or
"how many".

Filterable and sortable on `Search`: `domain`, `displayName`, `rootDomain`, `domainType`,
`assignment.assignedToId`, `assignment.assignmentType`, `dnsPropagation.status`,
`sslCertificate.active`, `registered.expirationDate`, `registered.registeredDate`,
`registered.lifecycleStatus`, `registered.subscription.autoRenew`, `registered.addons.privacy.enabled`,
`registered.addons.dnssec.enabled`. Anything else, such as "not on any site", is filtered in code.

Free text on the name: `"search": { "expression": "example", "fields": ["domain"] }` inside
`cursorSearch`.

Answer a list in one table, one row per domain, with only the columns the question needs.

## Boundaries

No WHOIS, registrant, registrar or owner lookup, no valuation, and nothing about a domain that is not
in the account. Anything beyond reading a domain's state is another skill's task. Say what you found,
then hand over:

- A domain's DNS records: the Analyse Domain DNS skill.
- Changing its DNS: the Update Domain DNS skill.
- Buying a domain, or connecting one to a site (assigning it): [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md).
- Whether a name is available to register: [Check Domain Availability](check-domain-availability.md).
- Renewing a domain: no skill covers it yet, so stop there.
