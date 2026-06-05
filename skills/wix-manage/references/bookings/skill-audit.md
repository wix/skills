---
name: "Bookings — Skill Audit"
description: Per-skill audit table for the bookings L1 domain.
---

# Bookings — Skill Audit

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `booking-service-policy-setup.md` | Services API (policy fields) | Likely Yes (production legacy) | TBD | Policy field semantics: bookingPolicy, cancellationPolicy, waitlist; cross-field invariants | 📦 Legacy flat |
| `booking-system-integration-gaps.md` | Bookings + eCommerce payment | Likely Yes (production legacy) | TBD | Undocumented patterns: booking ID → catalog item transformation; async payment confirmation flow | 📦 Legacy flat (doc-of-gaps) |
| `bookings-staff-setup.md` | Staff API + Calendar Events | Likely Yes (production legacy) | TBD | **Critical 2-step process**: create staff → assign schedule → create working-hours events. Order matters. | 📦 Legacy flat |
| `create-and-update-booking-services.md` | Services API CRUD | Likely Yes (production legacy) | TBD | Service-type-specific shapes (APPOINTMENT/CLASS/COURSE); pricing config; location setup | 📦 Legacy flat |
| `end-to-end-booking-flow.md` | Services + Time Slots V2 + Bookings + eCommerce | Likely Yes (production legacy) | No | Cross-domain orchestrator (service discovery → availability → booking → payment) | 📦 Legacy flat |
| `external-calendar-integration.md` | OAuth + Calendar sync APIs | Likely Yes (production legacy) | TBD | OAuth flow for Google/Outlook/Apple; bidirectional sync config | 📦 Legacy flat |
| `multi-resource-service-creation.md` | Resources API | Likely Yes (production legacy) | TBD | Resource types + individuals; automatic allocation logic | 📦 Legacy flat |
