---
name: domain-dns-assistant
description: "Domain connection & DNS troubleshooting — diagnoses DNS propagation issues, identifies domain management type, and helps users fix connection problems automatically (for Wix-managed domains) or through manual steps (for externally managed domains). Routes to: check-and-fix-dns."
compatibility: Requires Wix account-level API key with DOMAINS.READ_CONNECTED_DOMAINS, DOMAINS.READ_DNS_PROPAGATION, and DOMAINS.MANAGE_DNS_ZONES scopes.
---

# Domain DNS Assistant — Recipe Index

## What This Skill Does

This skill helps users diagnose and resolve domain connection problems that prevent their Wix site from being accessible. It:

- Lists the user's connected domains
- Checks DNS propagation status
- Identifies whether the domain is managed by Wix or an external registrar
- Automatically fixes DNS records for Wix-managed domains, or provides step-by-step manual instructions for externally managed ones

---

## Domain Connection & DNS

### [Check and Fix Domain DNS](references/domain-connection/check-and-fix-dns.md)
**Technical:** End-to-end flow for diagnosing and resolving domain connection issues. Covers listing connected domains, checking DNS propagation status, determining domain management type, applying automatic fixes via the DNS Zone API, and guiding manual fixes for externally managed (POINTING) domains.
