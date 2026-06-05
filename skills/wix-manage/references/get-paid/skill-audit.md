---
name: "Get-paid — Skill Audit"
description: Per-skill audit table for the get-paid L1 domain (planned home for the Payments & finance L2). Tracks API-doc verification, Claude redundancy, migration status.
---

# Get-paid — Skill Audit

## Files

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `create-payment-links.md` | Payment Links API | Likely Yes (production legacy) | TBD | Multi-shape orchestration: store products (catalog items) vs custom line items vs variants; due dates; email sending | 📦 Legacy flat |
| `how-to-setup-wix-payments.md` | Wix Payments connect + Site Payment Method Types | Likely Yes (production legacy) | TBD | Onboarding flow: eligibility → business verification → bank setup → method enablement; **dashboard-only steps clearly flagged** (cannot be automated via API) | 📦 Legacy flat |
| `payment-links-for-bookings.md` | Payment Links + Bookings | Likely Yes (production legacy) | TBD | Cross-domain link: booking ID → payment link with redirect handling | 📦 Legacy flat |
