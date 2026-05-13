---
name: "Check and Fix Domain DNS"
description: "End-to-end flow for diagnosing and resolving domain connection issues. Lists the user's connected domains, checks DNS propagation status, determines management type, and either applies an automatic fix (Wix-managed via NAMESERVERS) or provides manual steps (externally managed via POINTING)."
---

# RECIPE: Check and Fix Domain DNS

Use this recipe when a user reports that:
- Their site isn't accessible / isn't live
- Their domain isn't connecting or isn't working
- They see a DNS error or their domain isn't propagating
- They say something like "my domain isn't live", "my site isn't accessible", "my domain isn't connecting"

This recipe walks through four steps in strict order:
1. **List domains** — show the user their connected domains and ask which one to troubleshoot
2. **Check DNS propagation** — call the DNS Propagation API to get the current status
3. **Get management type** — determine if the domain is Wix-managed or externally managed using `connectionType` from Step 1
4. **Resolve the issue** — auto-fix (NAMESERVERS) or provide manual steps (POINTING / HIDDEN)

---

## Required APIs

| Purpose | Method | Endpoint |
|---------|--------|----------|
| List connected domains | `GET` | `https://www.wixapis.com/domains/v1/connected-domains` |
| Get DNS propagation status | `GET` | `https://www.wixapis.com/domains/v1/dns-propagations/{dnsPropagationId}` |
| Update DNS zone (auto-fix) | `PATCH` | `https://www.wixapis.com/domains/v1/dns-zones/{domainName}` |

**Required scopes:**
- `DOMAINS.READ_CONNECTED_DOMAINS` — to list domains and get connection type
- `DOMAINS.READ_DNS_PROPAGATION` — to check propagation status
- `DOMAINS.MANAGE_DNS_ZONES` — to apply DNS record corrections

> **Important:** All three endpoints require an **account-level API key**. They cannot be authenticated with a standard site-level authorization header.

---

## Step 1: List the User's Connected Domains

Fetch the user's connected domains so they can pick which one to troubleshoot.

**Request:**
```
GET https://www.wixapis.com/domains/v1/connected-domains
```

No request body required. Use cursor paging if `pagingMetadata.hasNext` is `true`.

**Response shape:**
```json
{
  "connectedDomains": [
    {
      "id": "mybusiness.com",
      "domain": "mybusiness.com",
      "connectionType": "NAMESERVERS",
      "siteInfo": {
        "assignmentType": "PRIMARY",
        "siteId": "..."
      }
    },
    {
      "id": "anotherdomain.com",
      "domain": "anotherdomain.com",
      "connectionType": "POINTING",
      "siteInfo": {
        "assignmentType": "PRIMARY",
        "siteId": "..."
      }
    }
  ],
  "pagingMetadata": { "hasNext": false }
}
```

**`connectionType` values:**

| Value | Meaning |
|-------|---------|
| `NAMESERVERS` | Domain's nameservers point to Wix — Wix manages the DNS zone. Auto-fix is possible. |
| `POINTING` | Domain uses an external DNS provider; A/CNAME records point to Wix. Manual fix only. |
| `HIDDEN` | Internal/unknown connection type. Treat as externally managed — manual steps only. |

**`id` field note:** The `id` on a `ConnectedDomain` is identical to the domain name including TLD (e.g. `mybusiness.com`). Use it as the `dnsPropagationId` in Step 2.

**Handling results:**
- Present the domain names to the user and ask which one they need help with.
- If the list is empty, ask the user to type the domain name manually and proceed to Step 2.
- If only one domain is returned and the user's request clearly refers to it, you may proceed without asking.
- If `pagingMetadata.hasNext` is `true`, fetch the next page before presenting the full list.

**Store** `connectionType` — you will need it in Step 3 with no additional API call.

---

## Step 2: Check DNS Propagation Status

**Request:**
```
GET https://www.wixapis.com/domains/v1/dns-propagations/{dnsPropagationId}
```

`dnsPropagationId` is the domain name including TLD (same as `id` from Step 1, e.g. `mybusiness.com`).

**Response shape:**
```json
{
  "dnsPropagation": {
    "id": "mybusiness.com",
    "domain": "mybusiness.com",
    "status": "FAILED",
    "failureInfo": {
      "invalidRecords": ["INVALID_A_RECORD", "INVALID_CNAME_RECORD"],
      "invalidARecordInfo": {
        "expectedDnsRecords": ["23.236.62.147", "35.190.47.231"],
        "actualDnsRecords": ["1.2.3.4"]
      },
      "invalidCnameRecordInfo": {
        "expectedDnsRecords": ["www123.wixdns.net"],
        "actualDnsRecords": ["example.com"]
      }
    }
  }
}
```

**`status` values and actions:**

| Status | Meaning | Action |
|--------|---------|--------|
| `SUCCEEDED` | DNS is correctly configured and propagated | See Path A — do NOT proceed to Step 3 |
| `IN_PROGRESS` | DNS changes are propagating | See Path B — do NOT proceed to Step 3 |
| `FAILED` | DNS records are misconfigured | Proceed to Step 3 |
| `UNKNOWN_STATUS` | Status couldn't be determined | Treat as `FAILED` — proceed to Step 3 |

**Error handling:**
- `PERMISSION_DENIED`: "I'm currently unable to check the DNS status due to an internal issue. DNS changes can take up to 48 hours. Please check your domain at [Domains](https://manage.wix.com/studio/domains)." Stop.
- 404 (domain not tracked yet): Advise propagation monitoring may not be set up and direct to [Domains](https://manage.wix.com/studio/domains).

**Store** `failureInfo` for use in Step 4.

### Path A: Status = SUCCEEDED

> "Great news! Your domain's DNS records are correctly configured and propagated."

If the user still reports their site isn't working:
> "If your site still isn't accessible, here are some things to check:
> 1. Make sure your site is published in the Wix Editor
> 2. Try accessing from a different network or device (local DNS caching can take a few hours)
> 3. Clear your browser cache or try incognito mode
> 4. For newly registered domains, check your email for an ICANN verification message"

Link to [Domains](https://manage.wix.com/studio/domains). **Stop here.**

### Path B: Status = IN_PROGRESS

> "Your DNS changes are still propagating. This can take up to 48 hours to complete globally, though it's often faster."

Link to [Domains](https://manage.wix.com/studio/domains). **Stop here.**

---

## Step 3: Determine Management Type

Use `connectionType` already retrieved in Step 1. **No additional API call needed.**

| `connectionType` | Auto-fix available? | Next step |
|-----------------|---------------------|-----------|
| `NAMESERVERS` | Yes — Wix manages DNS zone | Step 4 → NAMESERVERS path |
| `POINTING` | No — external DNS provider | Step 4 → POINTING path |
| `HIDDEN` | No — treat as external | Step 4 → POINTING path |

Keep this step invisible to the user — transition seamlessly without narrating it.

---

## Step 4: Resolve the DNS Issue

Use `connectionType` from Step 3 and `failureInfo` from Step 2.

### Pre-check

Before acting, verify there is something to fix:
- If `failureInfo` is missing or `invalidRecords` is empty: "Your DNS records appear to be correctly configured. If your site still isn't working, check that it's published, your SSL certificate is active, or try clearing browser cache. [Domains](https://manage.wix.com/studio/domains)" — stop.

---

### Path: NAMESERVERS (Wix-managed)

#### NS-only issue check

If `invalidRecords` contains **only** `INVALID_NS_RECORD`:

> "Your nameserver records aren't pointing to Wix yet. NS records can't be auto-fixed — you'll need to update them manually. Go to [Domains](https://manage.wix.com/studio/domains), find your domain, and set nameservers to the Wix values shown there (e.g., ns0.wixdns.net, ns1.wixdns.net). Changes can take up to 48 hours to propagate."

Stop. Do NOT call the DNS zone update API.

#### Offer automatic or manual fix

Ask the user:
> "I found some DNS record issues. Would you like me to fix them automatically, or would you prefer step-by-step instructions to fix them yourself?"

**If user chooses automatic fix** — call the DNS Zone Update API:

```
PATCH https://www.wixapis.com/domains/v1/dns-zones/{domainName}
```

Body:
```json
{
  "additions": [
    {
      "type": "A",
      "hostName": "@",
      "values": ["23.236.62.147", "35.190.47.231"],
      "ttl": 3600
    }
  ],
  "deletions": [
    {
      "type": "A",
      "hostName": "@",
      "values": ["1.2.3.4"],
      "ttl": 3600
    }
  ]
}
```

Rules:
- Only include records in `failureInfo.invalidRecords`:
  - `INVALID_A_RECORD` → `invalidARecordInfo.expectedDnsRecords` → additions; `actualDnsRecords` → deletions
  - `INVALID_CNAME_RECORD` → `invalidCnameRecordInfo.expectedDnsRecords` → additions; `actualDnsRecords` → deletions
- **Never include NS records** in the PATCH body.
- Omit `additions` or `deletions` entirely if empty — do not send empty arrays.

**Error responses:**

| Error | Response |
|-------|----------|
| `ALREADY_EXISTS` / `DOMAINS_ALREADY_EXISTS` | "Your DNS records appear to already be configured correctly. DNS changes can take up to 48 hours. Check status at [Domains](https://manage.wix.com/studio/domains)." |
| `DOMAIN_DUPLICATE_RECORDS` | "There's a conflict with duplicate DNS records. Go to [DNS settings](https://manage.wix.com/studio/domains), find the duplicate records, and remove the incorrect ones." |
| `DOMAIN_UPDATE_EMPTY_UPDATE_REQUEST` | "Your DNS records are already correct — nothing to fix. If your site still isn't working, check if it's published or clear browser cache." |
| `INVALID_NS_RECORD` | "Auto-fix isn't possible for nameserver records. Update your NS records to Wix nameservers (e.g., ns1.wixdns.net) via [Domains](https://manage.wix.com/studio/domains)." |

**On success:** "Your DNS records have been updated successfully. Changes can take up to 48 hours to propagate globally. Monitor status at [Domains](https://manage.wix.com/studio/domains)."

**If user chooses manual fix:**

> "Here's how to update your DNS records in Wix:
> 1. Open your [Domains](https://manage.wix.com/studio/domains) in Wix.
> 2. Find [domain_name] and click to open DNS settings.
> 3. Update these records:
>    [For each invalid record type from failureInfo.invalidRecords:]
>    - Record type: [A/CNAME]
>    - Host: [hostname from expectedDnsRecords]
>    - Current value: [from actualDnsRecords]
>    - Correct value: [from expectedDnsRecords]
> 4. Save your changes.
> DNS updates can take up to 48 hours to propagate."

---

### Path: POINTING or HIDDEN (externally managed)

**Do NOT call the DNS zone update API** — Wix has no zone file for these domains.

1. Explain:
   > "Your domain is registered with another provider and uses their DNS servers, so I can't fix the records automatically. You'll need to update the DNS settings at your domain registrar. I'll show you exactly which records to change."

2. Show only the invalid records from `failureInfo.invalidRecords`:

**If `INVALID_A_RECORD`:**
```
A Record (for root domain):
  Host:  @ (or your domain name)
  Type:  A
  Value: [all IPs from invalidARecordInfo.expectedDnsRecords]
  Current incorrect value: [actualDnsRecords values]
```

**If `INVALID_CNAME_RECORD`:**
```
CNAME Record (for www):
  Host:  www
  Type:  CNAME
  Value: [from invalidCnameRecordInfo.expectedDnsRecords]
  Current incorrect value: [actualDnsRecords values]
```

**Do NOT mention NS records for POINTING/HIDDEN domains.**

3. Guidance:
   > "Steps: 1) Log in to your domain registrar. 2) Find DNS settings. 3) Update the records above. 4) Save. Changes take up to 48 hours. Let me know which registrar you're using if you need help."

---

## Guardrails

- Do NOT imply external registrar for `NAMESERVERS` domains.
- Do NOT call the DNS zone API for `POINTING` or `HIDDEN` domains.
- Do NOT mention NS records for `POINTING` or `HIDDEN` domains.
- Do NOT PATCH with both `additions` and `deletions` empty.
- Do NOT skip the pre-check — verify `failureInfo` is non-empty before acting.
- Do NOT proceed to Steps 3/4 if DNS status is `SUCCEEDED` or `IN_PROGRESS`.
