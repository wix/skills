---
name: "Update Domain DNS"
description: Change the records in the Wix DNS zone of a domain already in the user's Wix account — add a domain-verification code (Google, Microsoft) as a text record, point the site or the bare domain at another host, make a name an alias, set up email, change or remove a record, or switch DNSSEC. Only for domains whose DNS Wix serves; a change that replaces or removes a record, or moves the site or mail, is shown and confirmed first. Not for a site's SEO settings, and not for a domain bought elsewhere that isn't connected yet: that is Connect External Domain or Sub Domain.
---

# Update Domain DNS

Changes the records in a domain's **Wix DNS zone**. It writes to a live domain, so it asks before any change that can
break the site or the mail, and acts straight away only when nothing existing can break (see step 4). It is
only for a domain already in the user's account. It does not
connect, assign or buy a domain (a domain bought elsewhere that isn't in the account yet is [Connect External
Domain or Sub Domain](connect-external-domain-or-sub-domain.md)'s), and it cannot change records kept at
another DNS provider. A question about the settings, or a request to find out what is wrong,
with no change asked for, is [Analyse Domain DNS](analyse-domain-dns.md)'s: it only reads.

Every call runs in the user's own context: as the signed-in user, never as an app, and never with an API
key or an integration token. Never use a call that is only for apps.

**Use the user's words.** Most users never say "DNS" or "record". They say "my site moved to a new host",
"verify my domain with Google", "send my email to Gmail". Work out the record from the request, and
describe the change as "where the domain points", "a verification code" or "the mail settings", with the
technical name in brackets once. Say "DNS" only if they did. Never name an endpoint, a field or an enum value.

## Flow

1. **Normalize the domain**: lowercase, trim whitespace, strip `http://`, `https://` and any path. Keep
   every label the user typed, `www.` included.
2. **Read the settings in one call** ([below](#read-the-settings-in-one-call)): whether Wix serves them, the
   zone, and the zone preview. If Wix does not serve them, say they are kept at the domain's own provider,
   where the change has to be made, and stop. If the user asks to move the domain's nameservers away from
   Wix, or to change them, say that is a change at the registrar and make no write.
3. **Use the zone it returned.** Every change is worked out from the records that are there now.
4. **Work out the change** from [What the user wants](#what-the-user-wants) and show a before/after table:
   record type, host, value now, value after, plus a "DNSSEC" row when it changes. "Value now" lists the
   exact values read from the zone, every one of them, never a summary. Explain each record type in a few
   words the first time (see the plain words below). Then decide whether to ask first:
   - **Ask first, the default.** Any change that replaces or removes an existing record, moves where the site
     or the mail goes, or touches DNSSEC. These can take the site or the mail down, and a wrong value keeps
     being served from caches for a while after it is fixed. Ask "Apply this?" and wait for a yes.
     **A request to make the change is not that yes**: the user has not yet seen which records change or
     what is left alone (such as `www`). Offering a choice is not making it: when you offer options, send
     nothing and leave every other record alone until the user picks, then show the table and ask.
     **Stop after asking.** The turn that shows the table sends nothing.
   - **Already confirmed.** Only an explicit yes counts ("yes", "go ahead", "apply it"): either in the user's
     own message together with the exact values, or as the answer to a before/after table that [Analyse
     Domain DNS](analyse-domain-dns.md) showed, listing every record the fix changes, with the zone the same
     as when it showed it. Exact values alone are not a yes, and neither is the request ("make it use
     203.0.113.10"). Apply it and say what changed. When that table was missing or partial, show your own
     and ask.
   - **Act without asking.** Only a purely additive change: a new record, with a value the user or the
     provider gave, on a host that has no record of that type yet, so nothing existing is replaced or
     removed. Apply it, then show what was added.
5. **Send it** (below) as its own call, never in the script that reads, and only once the change is
   confirmed or purely additive. Then show the result and say changes take time to spread; to follow the
   status use Analyse Domain DNS.

Run every call silently. If the read returns no propagation status, or a write fails, say "Something went
wrong on our end. Please try again in a moment." and, for a write, that nothing was changed. Never retry a
write.

## Read the settings in one call

Read the propagation status, the zone and the zone preview with the one-call read in [Analyse Domain
DNS](analyse-domain-dns.md#read-the-settings-in-one-call): same script, same results. It writes nothing. Its
result `{ "failed": true, "httpStatus": 403 }` means the domain isn't in the account; a zone of
`{ "failed": true, "httpStatus": 404 }` means that zone doesn't exist (for a subdomain, run the call again for
the root domain); any other `failed` result is "Something went wrong on our end." If you cannot run a
script, make the three reads below as separate calls, in this order. Do not retry anything yourself and do
not search the docs.

## Check that Wix serves the settings

The first read of the call above:

```
GET https://www.wixapis.com/premium/domains/v1/dns-propagations/example.com
```

```json
{ "dnsPropagation": { "id": "example.com", "status": "SUCCEEDED", "dnsResolverIncludesWixNs": true } }
```

`dnsResolverIncludesWixNs: true` → Wix serves the settings, continue. `false` → stop as above. Field absent
→ "I can't tell where this domain's settings are kept, so I haven't changed anything." and stop. `403`
`DOMAINS_PERMISSION_DENIED` → "{domain} isn't in your Wix account." and stop.

## Read the zone

The second read of the call above:

```
GET https://www.wixapis.com/domains/v1/dns-zones/example.com
```

```json
{ "dnsZone": { "domainName": "example.com", "dnssecEnabled": false,
    "records": [ { "type": "A", "hostName": "example.com", "ttl": 3600, "values": [ "185.230.63.107" ] },
                 { "type": "CNAME", "hostName": "www.example.com", "ttl": 3600, "values": [ "cdn3.wixdns.net" ] },
                 { "type": "NS", "hostName": "example.com", "ttl": 86400, "values": [ "ns12.wixdns.net", "ns13.wixdns.net" ] } ] } }
```

Use the domain exactly as typed for the zone name. For a subdomain whose own zone answers `404`, read the
root domain's zone instead and work on the subdomain's host names inside it (`shop.example.com`).

## What the user wants

| The user wants | Change |
|---|---|
| **Point the website at another host** | Replace the apex `A` record with the new host's IPv4 address. Change the `www` `CNAME` only if the user gave a host for it: ask "Should `www` go there too?" in the confirmation, and until they answer leave `www` as it is. Never put a CNAME on the apex: if the user only has a host name for the bare domain, ask for its IP address, or offer to point `www` at the name and leave the bare domain as it is. |
| **A verification code** (Google, Microsoft, …) | When the provider asks for a text record, or the code looks like `google-site-verification=…` or `MS=…`, add a `TXT` record on the host the provider names (the bare domain when it names none). If a `TXT` record already exists on that host, keep its values and add the new one. Do not put it in the site's SEO or marketing settings. A code the provider says goes in a page's HTML (a meta tag or a file) is not a domain setting: say so, and make no change here. |
| **Make a name an alias of another** | The bare domain can't be an alias, so change nothing yet. Say so in plain words, and offer one of two things: ask for that host's IPv4 address and use it for the bare domain's `A` record, or make `www` the alias of the name and leave the bare domain as it is. Send nothing and touch no record (`www` included) until the user picks; then show the before/after table and ask for a yes. For any other host (`shop.example.com`), set the host's `CNAME` to the name, first checking that no other record sits on that host. |
| **Email setup** | Add the `MX` records the mail provider gave, on the apex. Get the values from the user or the provider's setup page, never from memory. For SPF, merge into the existing `v=spf1` `TXT` value instead of adding a second one. |
| **Apply the fix [Analyse Domain DNS](analyse-domain-dns.md) proposed** | Replace the records it named with the values it gave; the preview below gives what Wix expects for the apex `A` and the `www` `CNAME`. Change nothing else. This skill does not diagnose: when the user asks to fix a site that isn't loading and no fix was proposed yet, hand over to Analyse Domain DNS first. |
| **Change or remove a record** | Delete it exactly as read; add the new one if it is a change. |
| **Switch DNSSEC** | Send the flag alone, and show it in the table. |
| **Start the zone over, or delete it** | Only when the user asks. See [Create or delete the whole zone](#create-or-delete-the-whole-zone). |

Read what Wix expects (the zone preview):

```
GET https://www.wixapis.com/domains/v1/dns-zones/example.com/preview
```

It returns the same `dnsZone` shape, with the records Wix needs for the domain. Use these values, never ones
from memory.

**Rules for any change:**

- **No CNAME on the apex.** The apex is the bare domain (`example.com`); `www.example.com` and
  `blog.example.com` are not. It can't hold a `CNAME`, so it needs an `A` record.
- **No CAA from here.** The zone has no CAA record type. When the user wants a CAA record changed, say it is
  done at their provider, and that it must include `pki.goog` or `letsencrypt.org` for the certificate.
- **MX can't change for 48 hours** on a newly bought or transferred domain. If an `MX` change is refused,
  say so and when to retry.
- **`NS` and `SOA`**: leave them alone. Edit the zone's `NS` or `SOA` record only when the user names that
  record and Wix serves the zone, and say first that the domain can stop working. "Change my nameservers"
  is not that request: it is a registrar change, with no write (flow step 2).
- **Records that break the site or the mail**: the apex `A` and the `www` `CNAME` stop the site loading;
  `MX` stops mail arriving at the old host. Name that in the confirmation.
- **Plain words for the types.** `A`: the address the domain points to. `AAAA`: the same, for the newer
  address format. `CNAME`: an alias to another name. `MX`: where email is delivered. `TXT`: text used to
  verify ownership and for email rules (SPF). `NS`: which servers manage the domain's settings.

## Update the zone

**Stop before this call.** Send it only when the user's last message is a yes to the table you showed (or
the change is purely additive, see step 4). If it is not, do not send it: show the table and ask "Apply
this?". Never send it together with the reads.

Records only. `dnssecEnabled` is left out, so DNSSEC stays as it is:

```
PATCH https://www.wixapis.com/domains/v1/dns-zones/example.com
Content-Type: application/json

{ "deletions": [ { "type": "A", "hostName": "example.com", "ttl": 3600, "values": [ "185.230.63.107" ] } ],
  "additions": [ { "type": "A", "hostName": "example.com", "ttl": 3600, "values": [ "203.0.113.10" ] } ] }
```

DNSSEC only, when the user asked for it:

```
PATCH https://www.wixapis.com/domains/v1/dns-zones/example.com
Content-Type: application/json

{ "dnssecEnabled": true }
```

The response is `{ "dnsZone": { ... } }`: the zone after the change. Show it as a table of `type`, `hostName`,
`values`. `additions` and `deletions` take up to 50 records each.

**Rules that decide the body**

- **One record per type and host.** Several values of one type live in that record's `values`. Two additions
  of the same type and host are wrong.
- **To add a value to an existing record**: delete that record exactly as read, add it again with all its
  values, old and new.
- **To remove one value of several**: delete the record exactly as read, add it again with the values that
  remain. Deleting it without the re-addition removes the other values too.
- **To change a value**: delete the record exactly as read (type, host, ttl, values), add the new one.
- **`hostName`** is the full name (`www.example.com`), as in the zone. Keep `ttl` as read; use `3600` for a
  new record unless the user says otherwise.
- Value formats: `MX` is `"{priority} {mail host}"`; `TXT` the plain text; `CNAME` the target host; `A` an
  IPv4 address.

## Create or delete the whole zone

Both are destructive and rarely what the user means. Use them only when the user asks to start the zone over
or remove it; say that every record in it is lost, list them, and wait for a yes.

- **Start over**: `POST https://www.wixapis.com/domains/v1/dns-zones` **deletes the existing zone first**, then
  creates one from the body. The new zone must hold the `NS` and `SOA` records, so copy them exactly from the
  zone you read and add the user's records to them. Copy the current `dnssecEnabled` as well: an omitted flag
  turns DNSSEC off.

  ```
  { "dnsZone": { "domainName": "example.com", "dnssecEnabled": false,
                 "records": [ { "type": "NS", "hostName": "example.com", "ttl": 86400, "values": [ "ns12.wixdns.net", "ns13.wixdns.net" ] },
                              { "type": "SOA", "hostName": "example.com", "ttl": 3600, "values": [ "ns12.wixdns.net. support.wix.com. 1 10800 3600 1209600 3600" ] },
                              { "type": "A", "hostName": "example.com", "ttl": 3600, "values": [ "203.0.113.10" ] } ] } }
  ```

  The response is the new `dnsZone`; show it.
- **Remove**: `DELETE https://www.wixapis.com/domains/v1/dns-zones/example.com`. The response is empty: say the
  zone was removed and show nothing.

## Boundaries

No WHOIS, registrar or owner lookup, and nothing about a domain that is not in the account. Domain
connection, assignment and purchase are other tasks.
