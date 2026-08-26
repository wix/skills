---
name: "Calendar Recipes"
description: "Business availability and working hours — set the default business hours a site's services and staff are bookable within, using calendar events on the business schedule. Use for anything users call business hours, opening hours, working hours, availability windows, or schedules."
---

# Calendar Recipes

Base availability lives on the business schedule as working-hours calendar events. The most common failure here is reaching for the Site Properties API, which looks like it should hold opening hours but does not affect bookability — the recipe covers the correct call and that distinction. Individual staff schedules and per-service policies belong to Bookings, not here.

## Recipes

### [Configure Default Business Hours](https://dev.wix.com/docs/api-reference/business-management/calendar/skills/configure-default-business-hours)
Use when setting or changing the hours a business is open and bookable, including which API actually governs availability.
