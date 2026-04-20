---
name: "Domain DNS Diagnosis and Fix"
description: Diagnose and fix DNS issues for domains connected to Wix. Check propagation status, identify misconfigured records, detect the registrar, auto-fix Wix-managed domains, and provide registrar-specific instructions for external domains.
---
# Domain DNS Diagnosis and Fix

Use this recipe when a user:
- Reports their domain or site isn't working / not loading
- Wants to check DNS status after connecting a domain
- Asks to diagnose or troubleshoot domain issues
- Says something like "my domain is broken", "site is down", "DNS not working"

## Prerequisites

- Domain must be connected to a Wix site (use the Domain Connection recipe first if not)
- Account-level API access

## Required APIs

- **Get DNS Propagation**: [API Reference](https://dev.wix.com/docs/api-reference/account-level/domains/domain-connections/dns-propagation/get-dns-propagation) -- `GET https://www.wixapis.com/domain-connections/v1/dns-propagation/{domain_name}`
- **Get Connected Domain Setup Info**: [API Reference](https://dev.wix.com/docs/api-reference/account-level/domains/domain-connections/connected-domains/get-connected-domain-setup-info) -- `GET https://www.wixapis.com/domain-connections/v1/connected-domains/setup-info/{domain_name}`
- **Update DNS Zone**: [API Reference](https://dev.wix.com/docs/api-reference/account-level/domains/domain-dns/dns-zones/update-dns-zone) -- `PATCH https://www.wixapis.com/domain-dns/v1/dns-zones/{domain_name}`

All are **account-level APIs** -- use account-level authentication.

**Important**: Do NOT use shell commands like `dig`, `nslookup`, `curl`, or `whois` to check DNS. Always use the Wix APIs above. They return the exact expected records for the Wix connection, which generic DNS tools don't know about.

---

## Step 1: Check DNS Propagation Status

**Endpoint**: `GET https://www.wixapis.com/domain-connections/v1/dns-propagation/{domain_name}`

**Example Request**:
```
GET https://www.wixapis.com/domain-connections/v1/dns-propagation/mybusiness.com
```

**Example Response**:
```json
{
  "dnsPropagation": {
    "domainName": "mybusiness.com",
    "status": "FAILED",
    "dnsResolverIncludesWixNs": false,
    "failureInfo": {
      "invalidRecords": ["A", "CNAME"],
      "invalidARecordInfo": {
        "expectedDnsRecords": [{ "hostName": "mybusiness.com", "values": ["185.230.63.107"] }],
        "actualDnsRecords": [{ "hostName": "mybusiness.com", "values": ["141.193.213.10", "141.193.213.11"] }]
      },
      "invalidCnameRecordInfo": {
        "expectedDnsRecords": [{ "hostName": "www.mybusiness.com", "values": ["pointing.wixdns.net"] }],
        "actualDnsRecords": []
      }
    }
  }
}
```

### Key Response Fields

| Field | Description |
|-------|-------------|
| `status` | `SUCCEEDED` (healthy), `IN_PROGRESS` (propagating), `FAILED` (misconfigured), `NOT_PUBLISHED` |
| `dnsResolverIncludesWixNs` | `true` = Wix-managed (nameservers point to Wix), `false` = externally managed |
| `failureInfo.invalidRecords` | List of record types that are wrong (e.g. `["A", "CNAME"]`) |
| `failureInfo.invalidARecordInfo` | Expected vs actual A records |
| `failureInfo.invalidCnameRecordInfo` | Expected vs actual CNAME records |
| `failureInfo.invalidNsRecordInfo` | Expected vs actual NS records |

### Handle Each Status

- **SUCCEEDED** -> Tell the user DNS is healthy. If their site still isn't loading, suggest checking if the site is published, clearing browser cache, or waiting for full propagation.
- **IN_PROGRESS** -> DNS changes are propagating. This is normal and can take up to 48 hours. Tell the user to wait and check again later.
- **FAILED** -> DNS records are misconfigured. Continue to Step 2.
- **NOT_PUBLISHED** -> The Wix site isn't published yet. Tell the user to publish their site first.
- No data returned -> The domain may not be connected to any Wix site.

---

## Step 2: Identify the Registrar (for external domains)

If `dnsResolverIncludesWixNs` is `false`, the domain is externally managed. Get the registrar name to provide specific instructions.

**Endpoint**: `GET https://www.wixapis.com/domain-connections/v1/connected-domains/setup-info/{domain_name}`

**Example Request**:
```
GET https://www.wixapis.com/domain-connections/v1/connected-domains/setup-info/mybusiness.com
```

**Example Response**:
```json
{
  "connectedDomainSetupInfo": {
    "domain": "mybusiness.com",
    "registrar": {
      "name": "GoDaddy",
      "nameServers": ["ns77.domaincontrol.com", "ns78.domaincontrol.com"]
    },
    "pointingRecords": [
      { "type": "A", "hostName": "@", "values": ["185.230.63.107"] },
      { "type": "CNAME", "hostName": "www", "values": ["pointing.wixdns.net"] }
    ],
    "nameserverRecords": [
      { "type": "NS", "hostName": "@", "values": ["ns1.wixdns.net", "ns2.wixdns.net"] }
    ]
  }
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `registrar.name` | The domain registrar (e.g. GoDaddy, Namecheap, Google Domains) |
| `registrar.nameServers` | Current nameservers for the domain |
| `pointingRecords` | DNS records needed if user wants to keep their current registrar's nameservers |
| `nameserverRecords` | Nameservers to use if user wants to transfer DNS management to Wix |

---

## Step 3: Diagnose and Fix

Based on the status and management type, follow the appropriate path.

### Path A: Wix-Managed Domain (dnsResolverIncludesWixNs = true)

The domain's nameservers point to Wix, so DNS records can be fixed automatically using the Update DNS Zone API.

**Endpoint**: `PATCH https://www.wixapis.com/domain-dns/v1/dns-zones/{domain_name}`

**Request Body**:
```json
{
  "dnsRecords": {
    "additions": [
      {
        "type": "A",
        "hostName": "mybusiness.com",
        "values": ["185.230.63.107"]
      }
    ],
    "deletions": [
      {
        "type": "A",
        "hostName": "mybusiness.com",
        "values": ["141.193.213.10"]
      }
    ]
  }
}
```

**How to build the fix**:
1. Take the `actualDnsRecords` from `failureInfo` as **deletions** (remove the wrong records)
2. Take the `expectedDnsRecords` from `failureInfo` as **additions** (add the correct records)
3. Call the Update DNS Zone API with both

**Important rules**:
- Ask the user for confirmation before making changes
- Only one record object per DNS record type per call
- To modify, delete the old record and add the new one in the same call
- After fixing, tell the user changes may take up to 48 hours to propagate

### Path B: Externally Managed Domain (dnsResolverIncludesWixNs = false)

DNS records must be updated manually at the domain registrar. Provide clear, registrar-specific instructions.

**Instructions template** (use the registrar name from Step 2):

1. Log in to your **{registrar name}** account
2. Find the DNS settings for **{domain_name}**
3. Update these records:

For each record from `failureInfo.expectedDnsRecords`:
- **Type**: {record type} (A, CNAME, etc.)
- **Host**: {hostName} (use `@` for root domain)
- **Value**: {values}

4. Save the changes
5. Wait for propagation (usually a few minutes to hours, can take up to 48 hours)

After the user reports making changes, offer to re-check using Step 1.

---

## Step 4: Verify the Fix

After the user makes changes (or after auto-fix), re-run Step 1 to verify.

- If status changed to `SUCCEEDED` -> Confirm everything is working
- If status is `IN_PROGRESS` -> Tell the user propagation is happening, check again later
- If status is still `FAILED` -> Review the records again, something may have been missed

---

## Error Handling

| Error | Description | Action |
|-------|-------------|--------|
| No DNS propagation data | Domain not connected to Wix | Guide user to connect the domain first using Domain Connection recipe |
| `access_denied` | Auth issue | Use account-level authentication |
| Update DNS Zone fails | Domain may not be Wix-managed | Verify `dnsResolverIncludesWixNs` is `true` before attempting auto-fix |

---

## Example Flows

### Flow 1: External domain with wrong records

1. User: "My domain andmoshik.com isn't working"
2. Check DNS propagation -> status: `FAILED`, `dnsResolverIncludesWixNs: false`, A records pointing to wrong IP, CNAME missing
3. Get setup info -> registrar: GoDaddy
4. Tell user: "Your domain is managed at GoDaddy and the DNS records are pointing to the wrong place. Here's what needs to change..."
5. Provide the expected A record and CNAME values with GoDaddy-specific instructions
6. After user updates: re-check DNS propagation to confirm

### Flow 2: Wix-managed domain with wrong records

1. User: "Something is wrong with my domain"
2. Check DNS propagation -> status: `FAILED`, `dnsResolverIncludesWixNs: true`, A record is wrong
3. Tell user: "Found the problem - your A record is pointing to the wrong IP. Since your domain uses Wix nameservers, I can fix this automatically. Want me to go ahead?"
4. User confirms -> call Update DNS Zone to delete wrong record and add correct one
5. Tell user: "Fixed! Changes will propagate within a few hours."

### Flow 3: Everything is fine

1. User: "Is my domain working?"
2. Check DNS propagation -> status: `SUCCEEDED`
3. Tell user: "DNS is healthy, all records are correctly configured. If your site still isn't loading, make sure it's published and try clearing your browser cache."
