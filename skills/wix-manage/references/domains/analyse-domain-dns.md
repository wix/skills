---
name: "Analyse Domain DNS"
description: Answer questions about the DNS settings of a domain already in the user's Wix account, whether it is set up correctly, and why its site isn't showing — where the settings are kept, whether they have propagated, the records in its Wix DNS zone and what they should be, which records are wrong or block SSL, and the email records. Read-only. Not for connecting a domain bought elsewhere: that is Connect External Domain or Sub Domain.
---

# Analyse Domain DNS

Answers questions about the DNS of a domain **already in the user's Wix account**, and finds out whether it
is set up correctly for Wix and, if not, what is wrong. It only reads. It changes no record and does not
connect, assign or buy a domain; a domain that isn't in the account yet is [Connect External Domain or Sub
Domain](connect-external-domain-or-sub-domain.md)'s: for a domain the user wants to connect, give no DNS
records and do no research on them, and hand over. For a one-line
status of a domain (type, site, expiry), use [Analyse Domain](analyse-domain.md). To apply a fix, use
[Update Domain DNS](update-domain-dns.md).

Every call runs in the user's own context: as the signed-in user, never as an app, and never with an API
key or an integration token. Never use a call that is only for apps. Wix reports the state it last
observed; it cannot run a live lookup, so never claim to have checked what the domain resolves to right now.

**Use the user's words.** Most users never say "DNS". They ask why a domain "isn't working", "isn't
showing my site" or "says it's not secure". Answer with "the domain's settings" and "where the domain
points", and explain a term in a few words the first time (an A record is "the address the domain points
to"; nameservers are "the servers that manage the domain's settings"). Say "DNS" only if they did. Never
name an endpoint, a field or an enum value.

## Flow

**A domain outside the account ends here.** When the read in step 2 comes back `failed` with `httpStatus`
`403`, the whole answer is this one sentence: "{domain} isn't in your Wix account." Add nothing: not that
its settings can't be checked, not that it isn't set up, no word about DNS, settings, health or who holds
it. Then make no other call: no doc search, no look-up of the user's sites (even when they said "my site"),
no zone or preview read. The one exception: when the user asked to connect the domain, add the hand-over
to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md), and give no DNS
records.

1. **Normalize the domain**: lowercase, trim whitespace, strip `http://`, `https://` and any path. Keep
   every label the user typed, `www.` included: `www.example.com` and `shop.example.com` are hosts of their
   own, and the root domain's status is a different answer.
2. **Read the settings in one call** ([below](#read-the-settings-in-one-call)). It returns the propagation
   status, which says whether Wix serves the settings and what Wix expects, and the zone and its preview.
   A `403` ends the flow, as above.
3. **Route by the question**, adding calls only when the question needs them:

   | The user asks | Do |
   |---|---|
   | What are the domain's settings | [Show the settings](#show-the-settings) |
   | Why the site isn't live, isn't secure, or the domain "isn't working" | [Find out why the site isn't live](#find-out-why-the-site-isnt-live) |
   | What the settings kept at their provider should be | [Records to set](#records-to-set) |
   | Email records | [Email](#email) |

4. **Answer the question and stop.** A plain question about the settings gets its answer and nothing more:
   no fix, no offer to change anything. Only when the checks found something wrong, answer in this order:
   1. The verdict, from the first cause that matches. Report that cause only: do not add what later checks
      might find (an unpublished site, a certificate), unless the user asked about it.
   2. The fix, with the values Wix expects from the read, in plain words: "Point the address of
      example.com (an A record) to {value}; it is {value} now". Write a record type only next to its plain
      words, never alone.
   3. When the fix is in the Wix zone, the whole change as a table (record, host, value now, value after,
      every record it replaces), and then this question as the last line, in these words: "Do you want me
      to change it?". A sentence saying nothing was changed is not the offer.

   Never apply the fix here: [Update Domain DNS](update-domain-dns.md) does, after a yes. When the fix is at
   the user's own provider, say that and give the values instead of the question.

If the call returns `failed` with any other `httpStatus`, say "Something went wrong on our end. Please try
again in a moment."

## Read the settings in one call

If you can run one short script over several Wix API requests, make this one read-only call. It only reads;
`wix.request` stands for an authenticated Wix API request in your environment, and it throws when the
response is not a success. Put the domain in `domain`. Keep the helper inside the one function, do not retry
anything yourself, and do not search the docs. If you cannot run a script, make the same three reads as
separate calls, in the order below (their shapes are shown), and read the results the same way.

```javascript
async function() {
  const domain = "example.com";

  async function read(path) {
    try {
      const { data } = await wix.request({ scope: "account", method: "GET", url: `https://www.wixapis.com/${path}` });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, httpStatus: Number((String(e).match(/\((\d{3})\)/) || [])[1]) || null };
    }
  }

  const propagation = await read(`premium/domains/v1/dns-propagations/${domain}`);
  if (!propagation.ok) return { failed: true, httpStatus: propagation.httpStatus };

  const [zone, preview] = await Promise.all([
    read(`domains/v1/dns-zones/${domain}`),
    read(`domains/v1/dns-zones/${domain}/preview`)
  ]);
  return {
    propagation: propagation.data.dnsPropagation,
    zone: zone.ok ? zone.data.dnsZone : { failed: true, httpStatus: zone.httpStatus },
    preview: preview.ok ? preview.data.dnsZone : { failed: true, httpStatus: preview.httpStatus }
  };
}
```

`{ "failed": true, "httpStatus": 403 }` as the whole result is the not-in-account answer. A zone or preview of
`{ "failed": true, "httpStatus": 404 }` means that zone doesn't exist (for a subdomain, run the call again for
the root domain). The first three reads are the ones in this call; for steps 7 and 8 of [the
checks](#find-out-why-the-site-isnt-live), the site lookups are separate calls, and a lookup that fails is
skipped, not guessed.

## Propagation status

The propagation ID is the domain name. This is the first read of the call above, shown here for its shape:

```
GET https://www.wixapis.com/premium/domains/v1/dns-propagations/example.com
```

```json
{ "dnsPropagation": {
    "id": "example.com", "domain": "example.com", "status": "FAILED",
    "failureInfo": {
      "invalidRecords": [ "INVALID_A_RECORD", "INVALID_CNAME_RECORD" ],
      "invalidARecordInfo": {
        "expectedDnsRecords": [ { "hostName": "example.com", "values": [ "185.230.63.107", "185.230.63.186", "185.230.63.171" ] } ],
        "actualDnsRecords": [] },
      "invalidCnameRecordInfo": {
        "expectedDnsRecords": [ { "hostName": "www.example.com", "values": [ "cdn3.wixdns.net" ] } ],
        "actualDnsRecords": [] } },
    "dnsResolverIncludesWixNs": false } }
```

| Result | Say |
|---|---|
| `status` `SUCCEEDED` | "The domain's settings are correct." |
| `status` `IN_PROGRESS` | "Changes to the domain's settings are still spreading. This can take up to 3 days." When Wix serves the settings (`dnsResolverIncludesWixNs` `true`), still read the zone: a question about the settings is answered from it, and a why-isn't-it-live question compares it with the preview. Records that differ are wrong and waiting won't fix them: report them, and say "wait" only when the zone matches. Do not list failing-record details from this result. |
| `status` `FAILED` | Name the failing record types and what they must be (table below). |
| `status` absent or unknown | "There's no information about this domain's settings yet." |
| `403` `DOMAINS_PERMISSION_DENIED` | "{domain} isn't in your Wix account." Nothing more. |

One row per entry of `failureInfo.invalidRecords`: `INVALID_A_RECORD` → `invalidARecordInfo` (A),
`INVALID_NS_RECORD` → `invalidNsRecordInfo` (NS), `INVALID_CNAME_RECORD` → `invalidCnameRecordInfo` (CNAME).
Each block has `expectedDnsRecords` and `actualDnsRecords`, lists of `{ hostName, values }`. Show a table:
type, host, **should be** (the expected `values`), **is now** (the actual `values` for that host, or "nothing
set"). The expected values are the ones to give the user: never use values from memory.

`dnsResolverIncludesWixNs` tells where the settings live: `true` → Wix serves them, so a fix is made in
Wix; `false` → they are kept at the domain's own provider, so the fix is made there. Say which, because it
decides where the user goes. Every field except `id`, `domain` and `status` can be missing; when
`dnsResolverIncludesWixNs` is missing, say Wix can't tell where the settings are kept, and don't say where the
fix is made.

## Show the settings

Tell the user where the settings are kept, from `dnsResolverIncludesWixNs`: **at Wix** (`true`) or **at the
domain's own provider** (`false`). When Wix serves the settings, use the zone the call returned. Its shape:

```
GET https://www.wixapis.com/domains/v1/dns-zones/example.com
```

```json
{ "dnsZone": { "domainName": "example.com", "dnssecEnabled": false,
    "records": [ { "type": "A", "hostName": "example.com", "ttl": 3600, "values": [ "185.230.63.107", "185.230.63.186", "185.230.63.171" ] },
                 { "type": "CNAME", "hostName": "www.example.com", "ttl": 3600, "values": [ "cdn3.wixdns.net" ] },
                 { "type": "NS", "hostName": "example.com", "ttl": 86400, "values": [ "ns12.wixdns.net", "ns13.wixdns.net" ] },
                 { "type": "SOA", "hostName": "example.com", "ttl": 3600, "values": [ "ns12.wixdns.net. support.wix.com. 1 10800 3600 1209600 3600" ] } ] } }
```

Show a table with the columns "Kind", "Name", "Value" and "What it is", and fill the last column for
every row with the glossary's plain words ("the address the domain points to", "an alias to another
name", "which servers manage the domain's settings"), so the user never meets a record type unexplained.
Leave out `SOA` unless asked. One record per type per host: several values of one type sit in that record's `values`.
`403` `DOMAINS_PERMISSION_DENIED` means the domain isn't in the account. For a subdomain whose own zone
answers `404`, read the root domain's zone instead and look at the subdomain's host names inside it
(`shop.example.com`).

## Find out why the site isn't live

Work down this list in order and stop at the first cause that matches. Every step is a read, except 9.
Steps 3 to 6 read the Wix zone, so they apply only when Wix serves the settings (`dnsResolverIncludesWixNs`
`true`). When it is `false`, the zone at Wix may not exist: skip them, and go to step 7. For steps 3 to 6,
use the zone ([Show the settings](#show-the-settings)) and the zone preview ([Records to set](#records-to-set))
the call returned.
For a subdomain, step 3 compares only the records the preview returns for that host.
Decide step 1 after steps 3 to 6: with `IN_PROGRESS`, a zone that differs from the preview is a cause of its
own (waiting won't fix it), and "wait" is the answer only when those steps find nothing.

| # | Check | Cause when it matches | Who fixes it |
|---|---|---|---|
| 1 | Propagation `IN_PROGRESS`, and steps 3 to 6 found nothing (or Wix doesn't serve the zone) | Changes are still spreading. | Nobody: wait, up to 3 days. |
| 2 | Propagation `FAILED` and `dnsResolverIncludesWixNs: false` | The settings at the provider are wrong. | The user, at the provider: give the expected values. |
| 3 | Wix serves the settings (`true`) and the zone's apex A record is missing or differs from the [preview](#records-to-set) while the apex holds no CNAME (step 4), or its `www` CNAME (unless it is the legacy `www#.wixdns.net` format, step 6) is missing or differs | The records that send visitors to Wix are wrong. | [Update Domain DNS](update-domain-dns.md) restores them. |
| 4 | The zone has a CNAME on the apex (`example.com` itself) | An apex can't be an alias; it needs an A record. | Update Domain DNS replaces it with the preview's A record. |
| 5 | The zone's NS record holds nameservers that aren't Wix's, or from two different clusters (such as `ns12.wixdns.net` with `ns2.wixdns.net`; see the cluster table below) | The domain isn't fully pointing at Wix. | Explain only. A nameserver change is made at the registrar; [Update Domain DNS](update-domain-dns.md) edits the zone's NS record only if the user names that record. |
| 6 | A CNAME uses the old `www#.wixdns.net` format | Still works on an old domain, but isn't allowed for a new connection. | Update Domain DNS swaps in the preview's value, if the user wants it. |
| 7 | The site isn't published | Visitors see nothing even with correct settings. | The user publishes the site. |
| 8 | The domain is on no site | Nothing to show. | [Assign Domain](assign-domain.md) puts it on a site; for a domain registered elsewhere that isn't connected yet, [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md). |
| 9 | The site is live but the browser says "not secure" | The certificate may not be issued yet. When the settings are at an outside provider, a CAA record there may block it: Wix can't see CAA records. | Wait. If the settings are at a provider, also ask the user to check there that any CAA record includes `pki.goog` or `letsencrypt.org`, or remove it. |

For steps 7 and 8, find the site the domain is on. Ask for it as a connected domain (registered elsewhere)
first:

```
GET https://www.wixapis.com/domains/v1/connected-domains/example.com
```

Its `siteInfo.id` is the site ID (absent: step 8). Then read the site:

```
POST https://www.wixapis.com/site-list/v2/sites/query
Content-Type: application/json

{ "query": { "filter": { "id": { "$in": ["SITE_ID"] }, "namespace": { "$in": ["WIX", "HEADLESS"] } } } }
```

Filter the site's ID with `$in`, never `$eq`: the API answers `400` `Illegal metaSiteId filter value` to `$eq`
on `id`. Make these two reads only after the settings read, and only when step 7 or 8 is reached: never in the
same call as the settings read.

A `404` from the connected-domain read is normal, not an error: the domain is registered through Wix, and
[Analyse Domain](analyse-domain.md) gives only the site's name (`where` `unassigned`: step 8). Read the
account's sites that have a connected domain, and keep those whose `displayName` or `name` equals that name:

```
{ "query": { "filter": { "domainConnected": { "$eq": true } }, "cursorPaging": { "limit": 100 } } }
```

One match is the site. Several: ask the user which one. None: don't state anything about the site, and skip
step 7.

The site's `published` is `false` for step 7. Wix can't report a certificate's state, so step 9 is not a
read: when everything above is fine and the user says the browser calls the site "not secure", give the step 9
advice, never a claim about the certificate.

## Records to set

For a domain in the account whose settings are kept at an outside provider (propagation `dnsResolverIncludesWixNs`
`false`), these are the records to set there; the call above already returned the preview. A domain that isn't in the account is not covered: say it isn't
in the account and hand over to [Connect External Domain or Sub
Domain](connect-external-domain-or-sub-domain.md).

```
GET https://www.wixapis.com/domains/v1/dns-zones/example.com/preview
```

Same `dnsZone` shape as above. It is also the reference for domains Wix serves, in the checks above: a
zone record matches when its `values` equal the preview's for that host, compared as sets, ignoring order
and `ttl`. It holds the records Wix needs
**for the host you asked about**. For a root
domain, give every address record the response holds for the apex and for `www`; for a subdomain, give only
the records returned for that host (typically one `CNAME`) and never an apex A record or a `www` record
the response does not hold.

```
GET https://www.wixapis.com/domains/v1/connected-domain-setup-info/example.com
```

```json
{ "connectedDomainSetupInfo": { "connectedDomainId": "example.com",
    "registrar": { "name": "OTHER", "nameServers": [ "ns12.wixdns.net", "ns13.wixdns.net" ] } } }
```

These are the nameservers the registrar must hold for the domain to use Wix's settings. Setup info exists only
for a connected (external) root domain; skip it for a subdomain. When the user asks what to set, give the
records above, and the nameservers when they ask about switching them. Do not choose a route for them.

## Email

Show the zone's `MX` records and any `TXT` record that starts `v=spf1`, in plain words ("your email goes to
{host}"). The values for a mail provider come from that provider's setup page, not from here. Setting them
is [Update Domain DNS](update-domain-dns.md).

## Rules the checks rely on

- **Apex.** The bare domain (`example.com`). It can't hold a CNAME, so it always needs an A (or AAAA) record.
  `www.example.com` and `blog.example.com` are not the apex.
- **CAA** limits who may issue SSL certificates. Certificates come only from Google or Let's Encrypt, so a
  CAA record must include `pki.goog` or `letsencrypt.org`; no CAA record at all is fine. The Wix zone has no
  CAA records and Wix can't show the provider's, so this is something to ask the user to check.
- **Nameservers.** One NS record is enough. `ns1` and `ns2` of a domain must be in the same cluster. A
  nameserver outside this list means the domain isn't pointing at Wix:

  | Cluster | Nameservers |
  |---|---|
  | wix | `ns1.wix.com`, `ns2.wix.com` (old, deprecated), `ns2`, `ns3`, `ns6`, `ns7`, `ns10`, `ns11`, `ns14`, `ns15` `.wixdns.net` |
  | wix2 | `ns0`, `ns1`, `ns4`, `ns5`, `ns8`, `ns9`, `ns12`, `ns13` `.wixdns.net` |

- **Connected by pointing** means the settings stay at the provider: Wix can't change them.
- **Legacy CNAME** `www#.wixdns.net` (such as `gcdn0.wixdns.net`, `balancer.wixdns.net`): kept on old
  domains, never for a new connection.
- **Limits.** A site holds at most 300 connected domains. A newly bought or transferred domain can't change
  its `MX` records for 48 hours.
- **Record glossary.** A: the address the domain points to. AAAA: the same, for the newer address format.
  CNAME: an alias to another name (not allowed on the apex). NS: which servers manage the domain's
  settings. MX: where email is delivered. TXT: text used to verify ownership and for email rules (SPF).
  CAA: who may issue the security certificate.

## Boundaries

Read-only. When the user asks to change a record in the Wix zone, use
[Update Domain DNS](update-domain-dns.md). Settings kept at an outside provider are changed there: state
what they should be and stop. No WHOIS, registrar or owner lookup, and nothing about a domain that is not in
the account.
