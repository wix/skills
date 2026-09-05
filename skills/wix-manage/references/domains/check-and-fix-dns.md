---
name: "Domain DNS Check and Fix"
description: "Check DNS propagation status and fix domain connection problems. Use when a user's site isn't live after connecting a domain, a domain stopped working, DNS propagation failed, or the user wants to check if their domain is connected. Covers NAMESERVERS domains (auto-fix via DNS Zone API) and POINTING domains (manual instructions)."
---

# RECIPE: Domain DNS Check and Fix

## When to Use This Recipe

Use this recipe for any of the following:

- **Check domain/DNS status** — "Is my domain connected?", "Check my DNS", "Check domain connection status"
- **DNS propagation problems** — "DNS propagation failed", "My domain still doesn't work after propagation"
- **Site not live** — "My site isn't live after connecting my domain", "My site isn't accessible"
- **Domain stopped working** — "My domain was connected but stopped working", "My domain isn't resolving"
- **DNS errors** — "My domain shows a DNS error", "DNS error on my domain"

Do NOT use this recipe to purchase or register a new domain — use the Domain Search and Purchase recipe instead.

---

## Required APIs

| Purpose | Method | Endpoint |
|---------|--------|----------|
| List connected domains | `GET` | `https://www.wixapis.com/domains/v1/connected-domains` |
| Get DNS propagation status | `GET` | `https://www.wixapis.com/domains/v1/dns-propagations/{dnsPropagationId}` |
| Update DNS zone (auto-fix) | `PATCH` | `https://www.wixapis.com/domains/v1/dns-zones/{domainName}` |

All three require an **account-level API key**. Required scopes:
- `DOMAINS.READ_CONNECTED_DOMAINS`
- `DOMAINS.READ_DNS_PROPAGATION`
- `DOMAINS.MANAGE_DNS_ZONES`

---

## Step 1: Identify the Domain

Fetch all connected domains so the user can select which one to troubleshoot.

```
GET https://www.wixapis.com/domains/v1/connected-domains
```

**Response:**
```json
{
  "connectedDomains": [
    {
      "id": "mybusiness.com",
      "domain": "mybusiness.com",
      "connectionType": "NAMESERVERS",
      "siteInfo": { "assignmentType": "PRIMARY", "siteId": "..." }
    }
  ],
  "pagingMetadata": { "hasNext": false }
}
```

`connectionType` values:
- `NAMESERVERS` — Wix manages the DNS zone; auto-fix is possible
- `POINTING` — external DNS provider; manual fix only
- `HIDDEN` — treat as externally managed; manual fix only

**`id` = domain name including TLD** (e.g. `mybusiness.com`) — use this as `dnsPropagationId` in Step 2.

- Present domains and ask which one to check. If the list is empty, ask the user to type the domain name.
- **Store** `connectionType` — used in Step 3 with no additional API call.

---

## Step 2: Check DNS Propagation Status

```
GET https://www.wixapis.com/domains/v1/dns-propagations/{dnsPropagationId}
```

Use the domain name (e.g. `mybusiness.com`) as `dnsPropagationId`.

**Response:**
```json
{
  "dnsPropagation": {
    "id": "mybusiness.com",
    "status": "FAILED",
    "failureInfo": {
      "invalidRecords": ["INVALID_A_RECORD"],
      "invalidARecordInfo": {
        "expectedDnsRecords": ["23.236.62.147"],
        "actualDnsRecords": ["1.2.3.4"]
      },
      "invalidCnameRecordInfo": {
        "expectedDnsRecords": ["www123.wixdns.net"],
        "actualDnsRecords": ["old.example.com"]
      }
    }
  }
}
```

**Status routing:**

| `status` | What to do |
|----------|------------|
| `SUCCEEDED` | DNS is correct — tell user and stop (see Path A) |
| `IN_PROGRESS` | Still propagating — tell user to wait and stop (see Path B) |
| `FAILED` | Records misconfigured — proceed to Step 3 |
| `UNKNOWN_STATUS` | Treat as `FAILED` — proceed to Step 3 |

**Errors:**
- `PERMISSION_DENIED` → "I'm unable to check DNS status due to an internal issue. DNS changes take up to 48 hours — please check your domain at [Domains](https://manage.wix.com/studio/domains)." Stop.
- `404` → Propagation monitoring not set up; direct user to [Domains](https://manage.wix.com/studio/domains).

**Store** `failureInfo` for Step 4.

### Path A — SUCCEEDED

> "Great news! Your domain [domain] is correctly configured and DNS has propagated. Your site should be live."

If the user says the site still isn't working:
> "DNS is configured correctly. Try these steps:
> 1. Make sure your site is published in the Wix Editor
> 2. Clear your browser cache or try incognito mode
> 3. Try a different device or network (local DNS caching can cause delays)
> 4. For newly registered domains, check for an ICANN verification email"

Link to [Domains](https://manage.wix.com/studio/domains). **Stop — do not proceed to Step 3.**

### Path B — IN_PROGRESS

> "Your DNS changes for [domain] are still propagating — this can take up to 48 hours globally, though it's usually faster. Check back in a few hours."

Link to [Domains](https://manage.wix.com/studio/domains). **Stop — do not proceed to Step 3.**

---

## Step 3: Determine Fix Type

Use `connectionType` from Step 1. No extra API call needed.

- `NAMESERVERS` → Wix manages the DNS zone → proceed to **Step 4: NAMESERVERS path**
- `POINTING` or `HIDDEN` → external DNS → proceed to **Step 4: POINTING path**

---

## Step 4: Fix the DNS Issue

**Pre-check:** If `failureInfo` is missing or `invalidRecords` is empty → "Your DNS records look correct. If your site still isn't working, make sure it's published and try clearing your browser cache. [Domains](https://manage.wix.com/studio/domains)" — stop.

---

### NAMESERVERS Path (Wix-managed DNS)

#### NS-only issues

If `invalidRecords` contains **only** `INVALID_NS_RECORD`:
> "Your nameserver records aren't pointing to Wix yet. This can't be auto-fixed — update them manually at [Domains](https://manage.wix.com/studio/domains) to the Wix nameservers shown there (e.g. ns0.wixdns.net, ns1.wixdns.net). Changes take up to 48 hours."

Stop. Do not call the DNS zone API.

#### Auto-fix or manual

Ask:
> "I found some DNS record issues with [domain]. Would you like me to fix them automatically, or would you prefer step-by-step manual instructions?"

**If automatic fix chosen**, call:

```
PATCH https://www.wixapis.com/domains/v1/dns-zones/{domainName}
```

Body — only include records from `failureInfo.invalidRecords`:
```json
{
  "additions": [
    { "type": "A", "hostName": "@", "values": ["23.236.62.147"], "ttl": 3600 }
  ],
  "deletions": [
    { "type": "A", "hostName": "@", "values": ["1.2.3.4"], "ttl": 3600 }
  ]
}
```

- `INVALID_A_RECORD` → use `invalidARecordInfo.expectedDnsRecords` for additions, `actualDnsRecords` for deletions
- `INVALID_CNAME_RECORD` → use `invalidCnameRecordInfo.expectedDnsRecords` for additions, `actualDnsRecords` for deletions
- Never include NS records in the PATCH
- Omit `additions` or `deletions` if empty — do not send empty arrays

**PATCH error responses:**

| Error | Response |
|-------|----------|
| `ALREADY_EXISTS` / `DOMAINS_ALREADY_EXISTS` | "DNS records already appear correct. Changes can take up to 48 hours — check status at [Domains](https://manage.wix.com/studio/domains)." |
| `DOMAIN_DUPLICATE_RECORDS` | "There are duplicate DNS records. Go to [Domains](https://manage.wix.com/studio/domains) and remove the incorrect duplicates." |
| `DOMAIN_UPDATE_EMPTY_UPDATE_REQUEST` | "DNS records are already correct. If your site still isn't working, check if it's published or clear your browser cache." |
| `INVALID_NS_RECORD` | "Nameserver records can only be changed manually. Update NS records to Wix nameservers via [Domains](https://manage.wix.com/studio/domains)." |

**On success:** "Done! DNS records for [domain] have been updated. Changes take up to 48 hours to propagate. Check status at [Domains](https://manage.wix.com/studio/domains)."

**If manual steps chosen:**
> "To update DNS records in Wix:
> 1. Go to [Domains](https://manage.wix.com/studio/domains) and open DNS settings for [domain]
> 2. Update the following records:
>    [For each invalid record in failureInfo.invalidRecords:]
>    - Type: [A/CNAME] | Host: [from expectedDnsRecords] | Value: [from expectedDnsRecords] | (currently: [actualDnsRecords])
> 3. Save. Changes take up to 48 hours."

---

### POINTING / HIDDEN Path (external DNS)

**Do NOT call the DNS zone PATCH API** — Wix has no DNS zone for these domains.

> "Your domain [domain] uses an external DNS provider, so I can't fix the records automatically. Here's exactly what to update at your registrar:"

Show only invalid records from `failureInfo.invalidRecords`:

**`INVALID_A_RECORD`:**
```
A Record:  Host: @  |  Value: [all IPs from invalidARecordInfo.expectedDnsRecords]
Currently: [actualDnsRecords]
```

**`INVALID_CNAME_RECORD`:**
```
CNAME Record:  Host: www  |  Value: [invalidCnameRecordInfo.expectedDnsRecords]
Currently: [actualDnsRecords]
```

Do NOT mention NS records for POINTING/HIDDEN domains.

> "Steps: 1) Log in to your registrar. 2) Find DNS or Name Server settings. 3) Update the records above. 4) Save — changes take up to 48 hours. Let me know which registrar you use if you need help."

---

## Guardrails

- Do NOT call the DNS zone PATCH API for `POINTING` or `HIDDEN` domains
- Do NOT mention NS records for `POINTING` or `HIDDEN` domains  
- Do NOT proceed to Steps 3/4 when status is `SUCCEEDED` or `IN_PROGRESS`
- Do NOT PATCH if both `additions` and `deletions` would be empty
- Do NOT suggest external registrar steps for `NAMESERVERS` domains
