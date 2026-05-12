---
name: "Check and Fix Domain DNS"
description: "End-to-end flow for diagnosing and resolving domain connection issues. Lists the user's connected domains, checks DNS propagation status, determines management type, and either applies an automatic fix (Wix-managed) or provides manual steps (externally managed / POINTING)."
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
3. **Get management type** — determine if the domain is Wix-managed or externally managed
4. **Resolve the issue** — auto-fix (Wix-managed) or provide manual steps (external)

---

## Required APIs

| Purpose | Method | Endpoint |
|---------|--------|----------|
| List connected domains | `GET` | `https://www.wixapis.com/domains/v1/connected-domains` |
| Get DNS propagation status | `GET` | `https://www.wixapis.com/domains/v1/dns-propagations/{domainName}` |
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
      "id": "...",
      "domain": "mybusiness.com",
      "connectionType": "DNS",
      "assignmentType": "PRIMARY",
      "siteId": "..."
    },
    {
      "id": "...",
      "domain": "anotherdomain.com",
      "connectionType": "POINTING",
      "assignmentType": "PRIMARY",
      "siteId": "..."
    }
  ],
  "pagingMetadata": { "hasNext": false }
}
```

**Key fields:**
| Field | Description |
|-------|-------------|
| `domain` | The domain name including TLD (e.g., `mybusiness.com`) |
| `connectionType` | How the domain is managed: `DNS` (Wix manages the DNS zone), `POINTING` (external DNS, A/CNAME records point to Wix), or `REGISTRATION` (domain registered and fully managed through Wix) |
| `assignmentType` | `PRIMARY` or `REDIRECT` |

**Handling results:**
- Present the domain names to the user and ask which one they need help with.
- If the list is empty, ask the user to type the domain name manually and proceed to Step 2.
- If only one domain is returned and the user's request clearly refers to it, you may proceed without asking.
- If `pagingMetadata.hasNext` is `true`, fetch the next page before presenting the full list.

**Store** `connectionType` from this response — you will need it in Step 3 to avoid a second API call.

---

## Step 2: Check DNS Propagation Status

Call the DNS Propagation API using the domain name as the ID.

**Request:**
```
GET https://www.wixapis.com/domains/v1/dns-propagations/{domainName}
```

Replace `{domainName}` with the selected domain (e.g., `mybusiness.com`).

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
    },
    "dnsResolverIncludesWixNs": false
  }
}
```

**Status values and actions:**

| Status | Meaning | Action |
|--------|---------|--------|
| `SUCCEEDED` | DNS is correctly configured and propagated | Tell user everything looks correct; see Path A below |
| `IN_PROGRESS` | DNS changes are propagating | Tell user to wait (can take up to 48 hours); see Path B below |
| `FAILED` | DNS records are misconfigured | Proceed to Step 3 |
| `UNKNOWN_STATUS` | Status couldn't be determined | Treat as `FAILED`; proceed to Step 3 |

**Error handling:**
- If the API returns a `PERMISSION_DENIED` error: respond with "I'm currently unable to check the DNS status due to an internal issue. DNS changes can take up to 48 hours. Please check your domain again later at [Domains](https://manage.wix.com/studio/domains)." Then stop.
- If the domain isn't found in the propagation system yet (404): advise the user that propagation monitoring may not be set up for this domain yet and point them to [Domains](https://manage.wix.com/studio/domains).

**Store** `failureInfo` and `dnsResolverIncludesWixNs` for use in Step 4.

### Path A: Status = SUCCEEDED

DNS is correctly configured. Respond:

> "Great news! Your domain's DNS records are correctly configured and propagated."

If the user still reports their site isn't working:
> "If your site still isn't accessible, here are some things to check:
> 1. Make sure your site is published in the Wix Editor
> 2. Try accessing from a different network or device (local DNS caching can take a few hours)
> 3. Clear your browser cache or try incognito mode
> 4. For newly registered domains, check your email for an ICANN verification message"

Link to [Domains](https://manage.wix.com/studio/domains). **Do NOT proceed to Step 3.**

### Path B: Status = IN_PROGRESS

> "Your DNS changes are still propagating. This can take up to 48 hours to complete globally, though it's often faster."

Link to [Domains](https://manage.wix.com/studio/domains). **Do NOT proceed to Step 3.**

---

## Step 3: Determine Management Type

Use the `connectionType` you already retrieved in Step 1. **No additional API call is needed.**

| `connectionType` | Meaning | Next step |
|-----------------|---------|-----------|
| `REGISTRATION` | Domain was registered through Wix and fully managed by Wix | Go to Step 4 → Wix-managed path |
| `DNS` | Domain uses Wix's DNS zone | Go to Step 4 → Wix-managed path |
| `POINTING` | Domain uses an external DNS provider (A/CNAME records point to Wix) | Go to Step 4 → POINTING path |

Keep this step invisible to the user — transition seamlessly without narrating the API call.

---

## Step 4: Resolve the DNS Issue

Use `connectionType` from Step 3 and `failureInfo` from Step 2.

### Pre-check

Before taking any action, verify there is actually something to fix:
- If `failureInfo` is missing, empty, or `invalidRecords` is empty: respond with "Your DNS records appear to be correctly configured. If your site still isn't working, check that it's published, your SSL certificate is active, or try clearing browser cache. [Domains](https://manage.wix.com/studio/domains)" — then stop.

---

### Path: REGISTRATION or DNS (Wix-managed)

#### Step 4a: Check for NS-only issue

If `invalidRecords` contains **only** `INVALID_NS_RECORD` and nothing else:

> "Your nameserver records aren't pointing to Wix yet. NS records can't be auto-fixed — you'll need to update them manually. Go to [Domains](https://manage.wix.com/studio/domains), find your domain, and set nameservers to the Wix values shown there (e.g., ns0.wixdns.net, ns1.wixdns.net). Changes can take up to 48 hours to propagate."

Stop. Do NOT call the DNS zone update API for NS-only issues.

#### Step 4b: Offer automatic fix

Ask the user:
> "I found some DNS record issues. Would you like me to fix them automatically, or would you prefer step-by-step instructions to fix them yourself?"

Present two clear options (e.g., "Fix it for me" / "Show me how").

#### Step 4c: If user chooses automatic fix

Call the DNS Zone Update API:

**Request:**
```
PATCH https://www.wixapis.com/domains/v1/dns-zones/{domainName}
```

**Request body:**
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

**Rules for building additions/deletions:**
- Only include records from `failureInfo.invalidRecords`:
  - `INVALID_A_RECORD` → use values from `failureInfo.invalidARecordInfo` for additions/deletions
  - `INVALID_CNAME_RECORD` → use values from `failureInfo.invalidCnameRecordInfo` for additions/deletions
- **Do NOT include NS records** — NS record changes require manual intervention.
- Do NOT send empty arrays for additions or deletions if there's nothing in that category; omit the field instead.

**Error handling:**

| Error | Response |
|-------|----------|
| `ALREADY_EXISTS` / `DOMAINS_ALREADY_EXISTS` | "Your DNS records appear to already be configured correctly. DNS changes can take up to 48 hours. Check status at [Domains](https://manage.wix.com/studio/domains)." |
| `DOMAIN_DUPLICATE_RECORDS` | "There's a conflict with duplicate DNS records. Go to [DNS settings](https://manage.wix.com/studio/domains), find the duplicate records, and remove the incorrect ones." |
| `DOMAIN_UPDATE_EMPTY_UPDATE_REQUEST` | "Your DNS records are already correct — nothing to fix. If your site still isn't working, check if it's published or clear browser cache." |
| `INVALID_NS_RECORD` | "Auto-fix isn't possible because nameserver records can only be changed manually. Update your NS records to Wix nameservers (e.g., ns1.wixdns.net, ns2.wixdns.net) via [Domains](https://manage.wix.com/studio/domains)." |

**On success:**
> "Your DNS records have been updated successfully. Changes can take up to 48 hours to propagate globally. Monitor status at [Domains](https://manage.wix.com/studio/domains)."

#### Step 4d: If user chooses manual fix

Show the manual steps template:

> "Here's how to update your DNS records in Wix:
>
> 1. Open your [Domains](https://manage.wix.com/studio/domains) in Wix.
> 2. Find [domain_name] and click to open DNS settings.
> 3. Update these records:
>    [For each invalid record type from failureInfo.invalidRecords:]
>    - Record type: [A/CNAME]
>    - Host: [hostname from expectedDnsRecords]
>    - Current value: [from actualDnsRecords]
>    - Correct value: [from expectedDnsRecords]
> 4. Save your changes.
>
> DNS updates can take up to 48 hours to propagate."

---

### Path: POINTING (externally managed)

For POINTING domains, Wix does **not** manage the DNS zone. **Do NOT call the DNS zone update API** — it will fail because Wix has no zone file for this domain.

1. Explain why auto-fix isn't possible:
   > "Your domain is registered with another provider and uses their DNS servers, so I can't fix the records automatically. You'll need to update the DNS settings at your domain registrar. I'll show you exactly which records to change."

2. Show only the records that are invalid (from `failureInfo.invalidRecords`):

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

**Do NOT mention NS records for POINTING domains** — they are irrelevant (the user keeps their external nameservers).

3. Provide step-by-step guidance:

> "Steps to update at your domain registrar:
> 1. Log in to your domain registrar's website
> 2. Find DNS settings or DNS management
> 3. Update or create the records shown above
> 4. Save changes
>
> DNS updates can take up to 48 hours to propagate. If you need help finding your DNS settings, let me know which registrar you're using."

---

## Guardrails

- Do NOT use wording implying an external registrar for `REGISTRATION` or `DNS` domains.
- Do NOT call the DNS zone update API for `POINTING` domains.
- Do NOT mention NS records for `POINTING` domains.
- Do NOT call the DNS zone update API with empty `additions` AND empty `deletions`.
- Do NOT skip the pre-check in Step 4 — verify `failureInfo` is non-empty before acting.
- Do NOT proceed to Step 3/4 if DNS status is `SUCCEEDED` or `IN_PROGRESS`.

---

## Example Flows

### Flow 1: Wix-managed domain with A record issue (auto-fix)

1. Fetch connected domains → user picks `mybusiness.com` (`connectionType: DNS`)
2. Check DNS propagation → `status: FAILED`, `invalidRecords: [INVALID_A_RECORD]`
3. Store `connectionType: DNS` from Step 1 — no extra call needed
4. Show auto-fix option → user says "Fix it for me"
5. PATCH `https://www.wixapis.com/domains/v1/dns-zones/mybusiness.com` with correct A record additions and wrong record deletions
6. "Your DNS records have been updated successfully."

### Flow 2: POINTING domain with wrong A record (manual steps)

1. Fetch connected domains → user picks `exampledomain.com` (`connectionType: POINTING`)
2. Check DNS propagation → `status: FAILED`, `invalidRecords: [INVALID_A_RECORD]`
3. `connectionType` is `POINTING` → skip DNS zone update
4. Explain that DNS is managed externally and show exact A record values to update at registrar

### Flow 3: DNS already propagated

1. Fetch connected domains → user picks `mysite.com`
2. Check DNS propagation → `status: SUCCEEDED`
3. Respond: "Great news! Your domain's DNS records are correctly configured."
4. If site still not working, provide troubleshooting tips (published, cache, ICANN)

### Flow 4: NS-only issue on Wix-managed domain

1. Fetch connected domains → user picks `newdomain.com` (`connectionType: REGISTRATION`)
2. Check DNS propagation → `status: FAILED`, `invalidRecords: [INVALID_NS_RECORD]` only
3. Do NOT show auto-fix widget
4. Respond: "Your nameserver records aren't pointing to Wix yet. NS records can't be auto-fixed..." with manual instructions
