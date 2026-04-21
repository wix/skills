---
name: "Domain Connection"
description: Connect an external domain or subdomain to a Wix site. Supports both pointing (external DNS) and nameserver (Wix DNS) connection methods, with setup instructions and propagation monitoring.
---
# Domain Connection

Use this recipe when a user:
- Wants to connect a domain they own to their Wix site
- Asks to set up a custom domain for their site
- Needs to connect a subdomain to a Wix site
- Wants to switch a domain from one site to another
- Says something like "connect my domain", "set up my domain", "use my own domain"

## Prerequisites

- The domain must already be registered/purchased (use the Domain Search and Purchase recipe if not)
- The target Wix site must have an active Premium plan
- Account-level API access

## Required APIs

- **Create Connected Domain**: [API Reference](https://dev.wix.com/docs/api-reference/account-level/domains/connected-domains/connected-domain-v1/create-connected-domain) -- `POST https://www.wixapis.com/domains/v1/connected-domains`
- **Get Connected Domain Setup Info**: [API Reference](https://dev.wix.com/docs/api-reference/account-level/domains/connected-domains/connected-domain-setup-info-v1/get-connected-domain-setup-info) -- `GET https://www.wixapis.com/domains/v1/connected-domain-setup-info/{connectedDomainId}`
- **Get Connected Domain**: [API Reference](https://dev.wix.com/docs/api-reference/account-level/domains/connected-domains/connected-domain-v1/get-connected-domain) -- `GET https://www.wixapis.com/domains/v1/connected-domains/{connectedDomainId}`

All are **account-level APIs** -- use account-level authentication.

---

## Step 1: Gather Information

Before connecting, collect the following from the user:

1. **Domain name** -- the full domain including TLD (e.g. `mybusiness.com` or `shop.mybusiness.com`)
2. **Target site** -- which Wix site to connect to. Use the `ListWixSites` tool to list available sites and let the user pick.
3. **Connection method** -- ask the user to choose:
   - **Pointing** (recommended default) -- the domain stays with its current DNS provider, user updates A and CNAME records there. Best when the user has other services (email, etc.) on the same domain.
   - **Nameservers** -- Wix takes over DNS management entirely. Simpler setup but all DNS moves to Wix. Warn that existing DNS records (email MX, etc.) will need to be re-created in Wix.
   - If the user doesn't have a preference or is unsure, default to **Pointing**.
4. **Assignment type** -- `PRIMARY` (main domain for the site) or `REDIRECT` (redirects to the primary domain). Default to `PRIMARY` if the user doesn't specify.

After creating the connection (Step 2), **immediately** proceed to get setup info (Step 3) and present everything to the user in one response. Don't wait for the user between these steps.

For **subdomains** (e.g. `shop.mybusiness.com`), don't ask about connection method -- subdomains always use CNAME records.

---

## Step 2: Create the Connected Domain

**Endpoint**: `POST https://www.wixapis.com/domains/v1/connected-domains`

### For a root domain via pointing:

```json
{
  "connectedDomain": {
    "domain": "mybusiness.com",
    "connectionType": "POINTING",
    "siteInfo": {
      "assignmentType": "PRIMARY"
    }
  }
}
```

### For a root domain via nameservers:

```json
{
  "connectedDomain": {
    "domain": "mybusiness.com",
    "connectionType": "NAMESERVERS",
    "siteInfo": {
      "assignmentType": "PRIMARY"
    }
  }
}
```

### For a subdomain:

```json
{
  "connectedDomain": {
    "domain": "shop.mybusiness.com",
    "siteInfo": {
      "assignmentType": "PRIMARY"
    }
  }
}
```

**Important**:
- Do NOT pass `connectionType` for subdomains
- `connectionType` options for root domains: `POINTING` or `NAMESERVERS`
- If the user wants to suppress Wix email notifications about the domain, add `"suppressNotifications": true`

### Success Response:

```json
{
  "connectedDomain": {
    "id": "mybusiness.com",
    "domain": "mybusiness.com",
    "connectionType": "POINTING",
    "siteInfo": {
      "id": "57d71937-e772-44ab-a89a-e4d0a7d9d814",
      "assignmentType": "PRIMARY"
    },
    "dnsPropagationStatus": "IN_PROGRESS",
    "createdDate": "2026-04-20T12:00:00.000Z",
    "updatedDate": "2026-04-20T12:00:00.000Z"
  }
}
```

---

## Step 3: Get DNS Setup Instructions

After creating the connection, retrieve the DNS records the user needs to configure.

**Endpoint**: `GET https://www.wixapis.com/domains/v1/connected-domain-setup-info/{domain_name}`

**Example**: `GET https://www.wixapis.com/domains/v1/connected-domain-setup-info/mybusiness.com`

### Response for POINTING connection:

```json
{
  "connectedDomainSetupInfo": {
    "connectedDomainId": "mybusiness.com",
    "pointingRecords": {
      "aRecord": {
        "hostName": "mybusiness.com",
        "ttl": 3600,
        "values": ["185.230.63.107"]
      },
      "cnameRecord": {
        "hostName": "www.mybusiness.com",
        "ttl": 3600,
        "value": "pointing.wixdns.net"
      }
    },
    "registrar": {
      "name": "GoDaddy",
      "nameServers": ["ns01.domaincontrol.com", "ns02.domaincontrol.com"]
    }
  }
}
```

### Response for NAMESERVERS connection:

```json
{
  "connectedDomainSetupInfo": {
    "connectedDomainId": "mybusiness.com",
    "nameserverRecord": {
      "nsRecord": {
        "hostName": "mybusiness.com",
        "ttl": 3600,
        "values": ["ns1.wixdns.net", "ns2.wixdns.net"]
      }
    },
    "registrar": {
      "name": "GoDaddy",
      "nameServers": ["ns01.domaincontrol.com", "ns02.domaincontrol.com"]
    }
  }
}
```

### Response for subdomain:

```json
{
  "connectedDomainSetupInfo": {
    "connectedDomainId": "shop.mybusiness.com",
    "subdomainRecords": {
      "cnameRecords": [
        {
          "hostName": "shop.mybusiness.com",
          "ttl": 3600,
          "value": "pointing.wixdns.net"
        }
      ]
    },
    "registrar": {
      "name": "GoDaddy",
      "nameServers": ["ns01.domaincontrol.com", "ns02.domaincontrol.com"]
    }
  }
}
```

---

## Step 4: Provide Setup Instructions to User

Based on the connection type, give the user clear instructions using the registrar name from the setup info.

### For POINTING connections:

Tell the user to log into their registrar ({registrar name}) and update these DNS records:

1. **A Record**:
   - Host: `@` (or blank, depending on registrar)
   - Value: the IP from `pointingRecords.aRecord.values`
   - TTL: 1 hour

2. **CNAME Record**:
   - Host: `www`
   - Value: the value from `pointingRecords.cnameRecord.value`
   - TTL: 1 hour

Remind the user to delete any existing A records for the root domain before adding the new one.

### For NAMESERVERS connections:

Tell the user to log into their registrar ({registrar name}) and replace their current nameservers:

- **Current nameservers** (to remove): values from `registrar.nameServers`
- **New nameservers** (to set): values from `nameserverRecord.nsRecord.values`

Warn the user that switching nameservers transfers all DNS management to Wix. If they have other DNS records (e.g. email MX records), those will need to be re-created in the Wix DNS manager after the switch.

### For subdomains:

Tell the user to add a CNAME record at their registrar:

- Host: the subdomain prefix (e.g. `shop`)
- Value: the value from `subdomainRecords.cnameRecords[0].value`
- TTL: 1 hour

---

## Step 5: Monitor Propagation

After the user confirms they made the DNS changes, check the connection status.

**Endpoint**: `GET https://www.wixapis.com/domains/v1/connected-domains/{domain_name}`

### Key field: `dnsPropagationStatus`

| Status | Meaning | Action |
|--------|---------|--------|
| `COMPLETED` | DNS is properly configured and propagated | Tell the user their domain is live |
| `IN_PROGRESS` | DNS changes are propagating | Normal, can take up to 48 hours. Suggest checking back later |
| `FAILED` | DNS records are misconfigured | Use the **Domain DNS Diagnosis and Fix** recipe to investigate and auto-fix |

---

## Error Handling

| Error | Description | Action |
|-------|-------------|--------|
| `Invalid domain - available for purchase` | Domain isn't registered yet | Guide user to purchase the domain first (use Domain Search and Purchase recipe) |
| `NON_PREMIUM_SITE` | Site doesn't have Premium plan | Tell user they need a Premium plan to connect a custom domain |
| `DOMAINS_ALREADY_EXISTS` | Domain already connected | Domain is connected to another site or with different settings. The user may need to disconnect it first |
| `Invalid connection type` | Wrong connection type for domain type | For subdomains, don't pass connectionType. For root domains, use POINTING or NAMESERVERS |
| `DOMAINS_PERMISSION_DENIED` | Auth issue | Use account-level authentication |
| `DOMAINS_DOMAIN_NOT_PERMITTED` | Domain not allowed for this account | Check account permissions |

---

## Example Flows

### Flow 1: Connect external domain via pointing

1. User: "I want to connect mybusiness.com to my Wix site"
2. List sites, user picks "My Business Site"
3. Ask: "Would you like to connect via pointing (you manage DNS at your registrar) or nameservers (Wix manages DNS)?"
4. User picks pointing
5. Call Create Connected Domain with `connectionType: "POINTING"`
6. Call Get Setup Info to get required DNS records
7. Tell user: "Go to your GoDaddy account and set these records: A record @ -> 185.230.63.107, CNAME www -> pointing.wixdns.net"
8. User confirms changes made
9. Check propagation status

### Flow 2: Connect domain via nameservers

1. User: "Connect mydomain.com to my site, I want Wix to handle everything"
2. List sites, user picks their site
3. Call Create Connected Domain with `connectionType: "NAMESERVERS"`
4. Call Get Setup Info to get nameserver values
5. Tell user: "Go to your registrar and replace your nameservers with ns1.wixdns.net and ns2.wixdns.net. Note: if you have email or other services on this domain, you'll need to re-create those DNS records in the Wix DNS manager."
6. User confirms changes made
7. Check propagation status

### Flow 3: Connect a subdomain

1. User: "I want to connect shop.mybusiness.com to my store site"
2. List sites, user picks their store site
3. Call Create Connected Domain with just the subdomain (no connectionType)
4. Call Get Setup Info to get CNAME value
5. Tell user: "Add a CNAME record at your registrar: shop -> pointing.wixdns.net"
6. User confirms
7. Check propagation status
