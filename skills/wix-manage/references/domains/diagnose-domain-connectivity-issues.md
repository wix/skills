---
name: "Diagnose Domain Connectivity Issues"
description: "Diagnoses why a domain isn't resolving or a Wix site is unreachable at its custom domain, beyond ordinary DNS misconfiguration. Checks DNS propagation status first, then explains registry-level status holds (clientHold/serverHold), pending ICANN contact verification, and expired/redemption states -- causes the DNS propagation check and the dashboard's connectivity banner don't detect. Clarifies which causes have a self-serve or API fix and which require Wix Domains support, since no public Domains API exposes a Wix-registered domain's registry-level (EPP) status. Use when a domain returns NXDOMAIN or won't load, especially when DNS records look correct or the dashboard's 'point away from Wix' / connectivity banner seems wrong."
---
# Diagnose Domain Connectivity Issues

## When to use

A site owner reports that their custom domain is **down, unreachable, or returns NXDOMAIN**, or that the dashboard's domain-connectivity banner (e.g. "Your domain is set to point away from Wix") looks **wrong** given that their DNS records appear correct. This recipe separates a genuine DNS-record problem (self-serve, has an API) from causes that live **above DNS** -- a registry-level status hold, a pending/expired ICANN contact verification, or an expired/redemption-period domain -- which DNS checks and the dashboard banner do not detect and which mostly have **no self-serve or API fix**.

> **Scope:** domains registered/billed through Wix. For domains registered elsewhere and only *connected* to Wix (nameservers or pointing), DNS-record issues are still diagnosed the same way, but anything below "Step 2" is out of scope -- the user's own registrar owns registry-level status.

---

## Step 1 -- Rule out a DNS-record problem first

Call [Get DNS Propagation](https://dev.wix.com/docs/api-reference/account-level/domains/dns-propagation/get-dns-propagation):

```bash
curl -X GET 'https://www.wixapis.com/premium/domains/v1/dns-propagations/{domain}' \
  -H 'Authorization: <AUTH>' \
  -H 'wix-site-id: <SITE_ID>'
```

Check `dnsPropagation.status`:

- **`FAILED`** -> this is a real DNS misconfiguration. Read `failureInfo.invalidRecords` and the matching `invalidARecordInfo` / `invalidNsRecordInfo` / `invalidCnameRecordInfo` object, compare `expectedDnsRecords` vs `actualDnsRecords`, and tell the user exactly which record(s) to fix at their DNS provider. Stop here -- this is the cause.
- **`IN_PROGRESS`** -> propagation can take up to 48 hours. If it's been less than that, this is likely just timing, not a bug.
- **`SUCCEEDED`** -> DNS records are correctly configured and propagated. **If the domain still doesn't resolve or the site still doesn't load, the cause is not DNS** -- go to Step 2. Don't tell the user to "keep checking DNS" once this comes back `SUCCEEDED`.

---

## Step 2 -- Check for a registry-level status hold (not visible via any Wix API)

If DNS reports `SUCCEEDED` (or the domain is registered through Wix and there's nothing to configure) but the domain still returns NXDOMAIN or won't load, the domain may be in a **registry-level status** that overrides correct DNS entirely. **No public Wix Domains API exposes this** for a Wix-registered domain -- the Connected Domains API only covers domains registered *elsewhere* and connected to Wix (`GET .../domains/v1/connected-domains/{id}`), and it explicitly excludes domains billed through Wix. There is currently no equivalent "get registration/registry status" endpoint for Wix-registered domains.

The only way to see this state today is a **public WHOIS lookup** -- e.g. `https://www.wix.com/domains/whois?domain={domain}` or any public WHOIS tool -- and reading the domain's status code(s) against [ICANN's EPP status code reference](https://www.icann.org/resources/pages/epp-status-codes-2014-06-16-en):

| EPP status | Meaning | Blocks resolution even with correct DNS? | Self-serve / API fix? |
|---|---|---|---|
| `clientHold` / `serverHold` | Registry (or registrar, for `client*`) has put the domain on hold | **Yes** -- the domain won't resolve at all regardless of DNS records | **No.** Requires Wix Domains support to investigate and lift it with the registrar. |
| `redemptionPeriod` | Domain expired and is in the post-expiry grace/redemption window | Yes | No self-serve fix from the dashboard; follow the [expired domain retrieval flow](https://support.wix.com/en/article/retrieving-an-expired-domain-during-the-redemption-period) if applicable, otherwise contact support. |
| `pendingDelete` | Past redemption, about to be released | Yes | No -- domain can no longer be retrieved; it would need to be repurchased once available. |
| `clientTransferProhibited` | Default protective lock most domains carry | No (this is normal/expected) | N/A -- only relevant if the user is trying to transfer the domain away. |

**If you see `clientHold` or `serverHold`:** tell the user plainly that the domain is on hold at the registry level, that this is independent of their (correct) DNS setup, and that it requires Wix Domains support to resolve -- there's no API call or dashboard action that lifts it. Don't imply that re-saving DNS records, waiting for propagation, or clicking any dashboard "try again" button will fix a registry-level hold.

---

## Step 3 -- Check for a pending/expired ICANN contact verification

ICANN requires registrars to verify a domain's registrant contact email under certain conditions (new registration, or a registrant-email change). If that verification isn't completed in time, the domain can be deactivated. See the public article [ICANN: Reactivating Your Domain](https://support.wix.com/en/article/icann-reactivating-your-domain).

- If the owner recently registered the domain or changed the registrant email, ask whether they received and clicked a contact-verification email.
- If they say they already clicked the verification link but the domain is **still** down: don't assume the verification "didn't count" or ask them to re-click it repeatedly. Confirming an email is only one input into an underlying registrar/registry state that Wix does not expose via API (see Step 2) -- there can be a gap between "the user confirmed" and "the registrar/registry has reflected that." Escalate to Wix Domains support to confirm the confirmation registered on the registrar's side and, if needed, have the hold lifted manually.

---

## Presenting the diagnosis to the user

- Lead with **what you found and where** (DNS propagation status, or the WHOIS status code) -- unlike some other diagnostics, it's fine to mention the WHOIS status code by name here since it's a standard, publicly documented term the user can verify themselves.
- Be explicit about **what has no self-serve fix**: if it's a registry-level hold, say clearly that this needs Wix support and give a realistic expectation (it's a manual, registrar-side check, not instant).
- Don't keep the user in a DNS-troubleshooting loop once DNS propagation has already come back `SUCCEEDED` -- that only wastes their time and misdiagnoses the problem.

---

## Gotchas

- **The dashboard's domain-connectivity banner (e.g. "Your domain is set to point away from Wix") reflects a DNS-record check only.** It can be misleading -- it may keep showing even when DNS is fully correct, if the real cause is a registry hold, a pending/expired ICANN verification, or an expired/redemption domain, none of which that check evaluates. Treat the banner as a hint, not a diagnosis; always confirm with Step 1's DNS Propagation status before trusting it.
- **A registry-level hold overrides correct DNS entirely.** Don't equate "DNS Propagation says `SUCCEEDED`" with "the domain will resolve" -- these are independent layers.
- **Confirming an ICANN contact-verification email doesn't always immediately clear the domain.** Treat "I already verified but it's still down" as a signal to escalate to support, not as a reason to have the user repeat the verification step.
- **There is currently no public API to fetch registry/EPP status for a Wix-registered domain.** Public WHOIS is the only way to see it from outside; don't guess or infer registry status from DNS Propagation or Connected Domain responses -- they don't carry it.

## API Documentation References

- [DNS Propagation API -- Introduction](https://dev.wix.com/docs/api-reference/account-level/domains/dns-propagation/introduction)
- [Get DNS Propagation](https://dev.wix.com/docs/api-reference/account-level/domains/dns-propagation/get-dns-propagation)
- [Connected Domains API -- Introduction](https://dev.wix.com/docs/api-reference/account-level/domains/connected-domains/introduction) (external domains only)
- [ICANN EPP Status Codes](https://www.icann.org/resources/pages/epp-status-codes-2014-06-16-en)
- [Wix Support: ICANN -- Reactivating Your Domain](https://support.wix.com/en/article/icann-reactivating-your-domain)
- [Wix Support: Retrieving an Expired Domain During the Redemption Period](https://support.wix.com/en/article/retrieving-an-expired-domain-during-the-redemption-period)
- Related recipe: [Domain Search and Purchase](domain-search-and-purchase.md)
