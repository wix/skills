---
name: "Analyse Domain"
description: Report on the domains in the user's own Wix account — what kind a domain is, which site it is on, when it expires and whether it renews — for one domain, or by listing and filtering the account's domains.
---

# Analyse Domain

Answers one question: **what is the state of a domain in this account?** It only reads. It does not
buy, connect, assign, renew or change DNS, and it says nothing about domains outside the account.

Every call runs in the user's own context: as the signed-in user, never as an app, and never with an API
key or an integration token. The account the user is working in is the account for the call. Every domain
in the account, whether registered through Wix or registered elsewhere and connected to Wix, is read from
the account's two domain lists: `assigned` (the sites the user's domains are on) and `unassigned` (the
domains on no site). The account's Premium purchases add the expiry and renewal of a domain registered
through Wix. A domain that is in neither list is not in the account, which is an answer, not a failure
(see below).

## Flow

1. **Normalize the domain**: lowercase, trim whitespace, strip `http://`, `https://`, `www.` and any
   path. Keep the extension the user typed. A subdomain (`shop.example.com`) is a valid input here.
2. **One named domain** → look it up (next section), in the one call shown there.
   **A question about the account** ("which expire soon", "which are
   connected from outside Wix") → list and filter (Several domains), then answer from the rows.
3. Read the result (table below) and answer in plain language, only what was asked.
4. Run the calls silently. For one named domain the lookup call handles its own failures, so do not
   retry it. For the account-wide call, retry a failed call once, silently; if it fails again, say
   "Something went wrong on our end. Please try again in a moment."


Never name an endpoint, a field or an enum value to the user.

## Look up one domain

Make this one read-only call, with whatever lets you run a short script over several Wix API requests at
once. Put the domain in `domain` and the account's ID in `accountId`: it is the Account ID in the Wix
context you already read, and the expiry lookup needs it as `targetAccountId`. Keep the helpers inside the one
function.

It looks at the `unassigned` list first, then at the `assigned` list, and when neither holds the domain
the answer is "not found". Each request is wrapped so that a failure is an answer ("no match") and never
an error to chase. Do not retry anything yourself, do not try another tool, and do not search the docs.

```javascript
async function() {
  const domain = "example.com";
  const accountId = "ACCOUNT_ID";
  const lists = "https://manage.wix.com/_api/my-domains/v1/domains";
  const renewal = { AUTO_RENEW_ON: true, AUTO_RENEW_OFF: false };

  const getList = kind => wix.request({ scope: "account", method: "GET",
    url: `${lists}/${kind}?filter.searchTerm=${domain}` }).then(r => r.data).catch(() => ({}));
  const fields = d => ({ wixRegistration: d.wixRegistration, managementType: d.managementType,
                         autoRenew: d.isAutoRenewed });

  async function findUnassigned() {
    const { domains = [] } = await getList("unassigned");
    return domains.find(x => x.domainName === domain);
  }

  async function findAssigned() {
    const { sites = [] } = await getList("assigned");
    for (const { site, primary, redirects = [] } of sites) {
      if (primary?.domainName === domain) return { where: "primary", siteName: site.siteName, ...fields(primary) };
      const r = redirects.find(x => x.domainName === domain);
      if (r) return { where: "redirect", siteName: site.siteName, ...fields(r) };
    }
    return null;
  }

  async function findPremiumAsset() {
    let cursor;
    for (let page = 0; page < 5; page++) {
      const cursorQuery = cursor ? { cursorPaging: { limit: 100, cursor } }
        : { filter: { status: { $in: ["ACTIVE", "NOT_ACTIVE"] } }, cursorPaging: { limit: 100 } };
      const { data } = await wix.request({ scope: "account", method: "POST",
        url: "https://www.wixapis.com/premium-assets/v2/premium-assets/query",
        headers: { targetAccountId: accountId },
        body: { cursorQuery, includePermitted: false } });
      const hit = (data.premiumAssets || []).find(a => a.domainsData?.domain === domain);
      cursor = data.pagingMetadata?.cursors?.next;
      if (hit) return hit;
      if (!data.pagingMetadata?.hasNext || !cursor) return null;
    }
    return null;
  }

  async function withExpiry(match) {
    const asset = await findPremiumAsset().catch(() => null);
    return asset ? { ...match, expirationDate: asset.domainsData.expirationDate,
      autoRenew: match.autoRenew ?? renewal[asset.renewalType] } : match;
  }

  // With a search term, the unassigned list also returns a domain that redirects on a site.
  const listed = await findUnassigned();
  let match = listed && !listed.redirectsTo ? { where: "unassigned", ...fields(listed) } : null;
  if (!match) match = await findAssigned();
  if (!match && listed) {
    match = { where: "redirect", siteName: null, redirectsTo: listed.redirectsTo, ...fields(listed) };
  }
  if (!match) return { where: null };
  if (match.wixRegistration === false) {
    const { where, siteName, redirectsTo, managementType } = match;
    return { where, siteName, redirectsTo, wixRegistration: false, managementType };
  }
  return withExpiry(match);
}
```

The wrapping is deliberate. The `assigned` list is not reliably reachable from every session (an
`assigned` `400` "subject is missing" was seen), so a failed request is read as "not there" and the next
source is tried.

`filter.searchTerm` matches substrings, so the call keeps only an exact `domainName` match. With a
search term the `unassigned` list also returns a domain that redirects on a site (it carries
`redirectsTo`), so the `assigned` list is asked for its site; when that list can't be read, the
result is still a redirect, with `siteName` `null` and `redirectsTo` naming the domain it redirects to.
`wixRegistration`, `managementType` and `autoRenew` come from the list entry. The expiry always comes
from the Premium asset, and only Wix-registered domains have one; for any other domain it is absent. A
later page of Premium purchases carries only the cursor: the query refuses a filter together with a
cursor. The returned object is already trimmed to the exact match: the lists carry far more fields,
including registrant details, and none of them is read or mentioned.

## Reading the result

| Result | Say |
|---|---|
| `where` `primary` | "{domain} is in your account, and it's the primary domain of {`siteName`}." |
| `where` `redirect` | "{domain} is in your account, and it redirects to {`siteName`}." When `siteName` is `null`: "…and it redirects to {`redirectsTo`}." |
| `where` `unassigned` | "{domain} is in your account, but it isn't on a site yet", plus the rows below. |
| `wixRegistration` `false` | Start with "{domain} is registered elsewhere and connected to Wix". Its registrar owns its expiry, renewal and add-ons: never state or guess them, even when the user asks. Never state SSL for it either. |
| `wixRegistration` `true` | "It's registered through Wix." |
| `expirationDate` | The date, written out ("1 March 2027"). |
| `autoRenew` `true` / `false` | Auto-renew is on / off. Absent: say nothing about renewal. |
| `managementType` `POINTING` / `DNS` | "Its settings stay at its provider" / "Wix manages its settings". Any other value or none: say nothing about the method. |
| `where` is `null`, including when a request failed | "I can't find {domain} in your Wix account." Do not mention the failed call. A miss is not proof that the user doesn't own it: these lists see the Wix account, not the registry. Never say someone else owns it, and say nothing about who holds it. If the user then asks whether it can be registered, use [Check Domain Availability](check-domain-availability.md); to buy it, [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md); to connect it from another provider, [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md). |

This call is the last source: do not search the docs or call any other API, even when the user asked
for an expiry, a renewal or add-ons. Add-ons, SSL and the contact-verification status are not reported.
An expiry or renewal that the result does not carry is never stated or guessed: say Wix can't report it
for this domain. The result carries no price: never state or estimate one. DNS propagation and DNS records
are not in this result either: hand those questions to [Analyse Domain DNS](analyse-domain-dns.md), and a
"not secure" warning too (it never states a certificate's state).

## Several domains

Make this one read-only call for a question about the account's domains. It reads both lists in full
(no search term) and the account's Premium purchases, and returns one row per domain. Put the account's
ID in `accountId`, as above, and write the question as the `keep` filter, so only the matching rows come
back:

- registered elsewhere and connected: `row => row.wixRegistration === false`
- on no site: `row => row.site === null`; on a site: `row => row.site !== null`
- on one site: `row => row.site === "Site name"`
- auto-renew off: `row => row.wixRegistration === true && row.autoRenew === false`
- expiring before a date: `row => row.expirationDate && row.expirationDate < "2027-01-01T00:00:00Z"`
- everything ("list all", "how many"): `row => true`

```javascript
async function() {
  const accountId = "ACCOUNT_ID";
  const keep = row => true;
  const lists = "https://manage.wix.com/_api/my-domains/v1/domains";
  const renewal = { AUTO_RENEW_ON: true, AUTO_RENEW_OFF: false };

  const getList = kind => wix.request({ scope: "account", method: "GET",
    url: `${lists}/${kind}` }).then(r => r.data);
  // The assigned list can fail in some sessions; the domains on no site still answer.
  const [unassigned, assigned] = await Promise.all([getList("unassigned"),
                                                    getList("assigned").catch(() => null)]);

  const row = (d, site, role) => ({ domain: d.domainName, site, role,
    wixRegistration: d.wixRegistration, managementType: d.managementType, autoRenew: d.isAutoRenewed });
  const rows = (unassigned.domains || []).filter(d => !d.redirectsTo).map(d => row(d, null, null));
  for (const { site, primary, redirects = [] } of assigned?.sites || []) {
    if (primary) rows.push(row(primary, site.siteName, "primary"));
    for (const r of redirects) rows.push(row(r, site.siteName, "redirect"));
  }

  const expiry = {};
  let expiryRead = true;
  try {
    let cursor;
    for (let page = 0; page < 20; page++) {
      const cursorQuery = cursor ? { cursorPaging: { limit: 100, cursor } }
        : { filter: { status: { $in: ["ACTIVE", "NOT_ACTIVE"] } }, cursorPaging: { limit: 100 } };
      const { data } = await wix.request({ scope: "account", method: "POST",
        url: "https://www.wixapis.com/premium-assets/v2/premium-assets/query",
        headers: { targetAccountId: accountId },
        body: { cursorQuery, includePermitted: false } });
      for (const a of data.premiumAssets || []) {
        const name = a.domainsData?.domain;
        if (!name || expiry[name]?.status === "ACTIVE") continue;
        expiry[name] = { status: a.status, expirationDate: a.domainsData.expirationDate,
                         autoRenew: renewal[a.renewalType] };
      }
      cursor = data.pagingMetadata?.cursors?.next;
      if (!data.pagingMetadata?.hasNext || !cursor) break;
    }
  } catch (e) {
    expiryRead = false;
  }

  const domains = rows.map(r => {
    if (r.wixRegistration !== true) {
      return { domain: r.domain, site: r.site, role: r.role, wixRegistration: r.wixRegistration,
               managementType: r.managementType };
    }
    const e = expiry[r.domain] || {};
    return { ...r, expirationDate: e.expirationDate, autoRenew: r.autoRenew ?? e.autoRenew };
  }).filter(keep);

  return { total: rows.length, matched: domains.length, domains,
           complete: Boolean(assigned) && assigned.isAllDataReturned !== false, expiryRead };
}
```

Each row has `domain`, `site` (the site's name, or `null` when it is on no site), `role` (`primary`,
`redirect` or `null`), `wixRegistration` and `managementType`. A Wix-registered row also has
`expirationDate` and `autoRenew` when the Premium purchases carry them. Read each row with the table in
[Reading the result](#reading-the-result): a row with `wixRegistration` `false` never gets an expiry or a
renewal. The rows have their own shape: `site` and `role` stand in for the single lookup's `siteName` and
`where`, and there is no `redirectsTo`. With `complete: false`, a redirect domain may be missing, but it
is never listed as on no site.

- `complete: false`: the domains on sites could not all be read. Say the list may be missing some of
  the domains that are on a site; a question about domains on no site is still answered in full.
- `expiryRead: false`: the expiry and renewal could not be read. Answer a question about them with
  "Wix can't report it right now"; the other columns still stand.
- A question that needs a field the rows don't carry (add-ons, SSL) is not answered from here: say Wix
  can't report it. A DNS propagation or DNS records question for one of the domains goes to
  [Analyse Domain DNS](analyse-domain-dns.md).

Answer a list in one table, one row per domain, with only the columns the question needs. A count is
`matched`. When more than 25 domains match, give the count, show the first 25, and offer the rest.

## Boundaries

No WHOIS, registrant, registrar or owner lookup, no valuation, and nothing about a domain that is not
in the account. Anything beyond reading a domain's state is another skill's task. Say what you found,
then hand over:

- Why a domain isn't connecting or showing the site, its DNS propagation, or its DNS records: [Analyse Domain DNS](analyse-domain-dns.md). Changing a record: [Update Domain DNS](update-domain-dns.md).
- Buying a domain: [Domain Search, Purchase and Connect](domain-search-purchase-and-connect.md).
- Bringing in a domain registered with another provider, or a subdomain: [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md).
- Putting a domain on a site, changing its role there, moving it, or taking it off: [Assign Domain](assign-domain.md).
- Whether a name is available to register: [Check Domain Availability](check-domain-availability.md).
- Renewing a domain: no skill covers it yet, so stop there.
