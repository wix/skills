---
name: bookings
description: "Service-based booking — services catalog, availability calendar, and booking flow via Wix Bookings."
triggers: ["booking", "appointment", "schedule", "reserve", "class", "session", "consult", "therapy", "lesson", "coaching", "trainer", "tutor", "salon", "spa", "clinic"]
requires: []

features:
  - name: "Services catalog"
    description: "Browse bookable services with descriptions, duration, pricing, and provider info."
  - name: "Online booking"
    description: "Pick an available time slot, complete a booking form, and receive confirmation — all without leaving your site."

apps:
  - name: "Wix Bookings"
    appDefId: "13d21c63-b5ec-5912-8397-c3a5ddb27a97"

routes:
  - route: "/services"
  - route: "/services/[slug]"
    name: "Service Detail"
  - route: "/booking-confirmation"
    name: "Booking Confirmation"

disabled: false
---

# Bookings Pack

Loaded when the user's prompt implies offering appointments, classes, or sessions.

> **Discovery contract.** Phase 1 reads only the frontmatter above to compose the plan's Pages table. Phase 2+ implementation (seeding, page composition, theming) lives in this skill's own `templates/bookings/` + `references/bookings/INSTRUCTIONS.md`.
>
> - Seed recipe: `<SKILL_ROOT>/references/bookings/SERVICES_DATA.md` (service creation via Wix Bookings REST API).
>
> No per-pack `seed`, `components`, `componentsCss`, or `pages` blocks live in this skill anymore.
