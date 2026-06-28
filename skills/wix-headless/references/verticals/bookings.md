---
name: bookings
description: "Service-based booking — services catalog (with location + category filters and staff selection), availability calendar, and booking flow for appointments and classes, plus course enrollment, via Wix Bookings."
triggers: ["booking", "appointment", "schedule", "reserve", "class", "session", "course", "enroll", "program", "workshop", "consult", "therapy", "lesson", "coaching", "trainer", "tutor", "salon", "spa", "clinic"]
requires: []

features:
  - name: "Services catalog"
    description: "Browse bookable appointment, class, and course services with descriptions, duration/dates, and pricing — filterable by category and (for multi-location businesses) by location."
  - name: "Staff selection"
    description: "On multi-staff services, choose a specific staff member (or any) and see that staff's availability."
  - name: "Online booking"
    description: "Pick an available time slot on a day-grouped availability calendar, complete the service's booking form, and confirm."
  - name: "Course enrollment"
    description: "Enroll in a multi-session course as a whole series — see the session schedule, instructor, available spots, and dates — then complete the same booking form. No per-slot calendar."
  - name: "Secure checkout"
    description: "Free or pay-in-person bookings confirm instantly; paid services hand off to Wix's secure hosted checkout."

apps:
  - name: "Wix Bookings"
    appDefId: "13d21c63-b5ec-5912-8397-c3a5ddb27a97"

routes:
  - route: "/services"
  - route: "/services/[slug]"
    name: "Service Detail"
  - route: "/booking-confirmation"
    name: "Booking Confirmation"
  - route: "Hosted by Wix"
    name: "Secure Checkout"

disabled: false
---

# Bookings Pack

Loaded when the user's prompt implies offering appointments, classes, or sessions.

> **Discovery contract.** Phase 1 reads only the frontmatter above to compose the plan's Pages table. Phase 2+ implementation (seeding, page composition, theming) lives in this skill's own `references/astro/templates/bookings/` + `references/bookings/INSTRUCTIONS.md`.
>
> - Seed recipe: `<SKILL_ROOT>/references/bookings/SERVICES_DATA.md` (service creation via Wix Bookings REST API).
>
> No per-pack `seed`, `components`, `componentsCss`, or `pages` blocks live in this skill anymore.
