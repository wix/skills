---
name: "Create Booking Service from Prompt"
description: "Create a booking service from a user prompt — e.g. 'create a yoga class for $50', 'set up consultations for $75', 'add a personal training appointment', 'create a 6-week photography workshop', 'create a hidden free test course with 8 online sessions'. Determines the service type (APPOINTMENT, CLASS, or COURSE) and delegates to the type-specific recipe. For COURSE services with session dates/counts, follow the course recipe's separate Calendar bulkCreateEvents step; Services V2 alone does not create bookable course sessions."
---

# Create Booking Service from Natural Language Prompt

## When to Use

- User describes a service they want to create using natural language (e.g., "create a yoga class for $50", "set up consultation sessions", "add a personal training appointment", "create a hidden free test course with 8 online sessions")
- The intent is autonomous creation — fill in reasonable defaults rather than asking the user for every field

## Step 1: Determine Service Type

| User mentions | Type | Recipe |
|---|---|---|
| consultation, appointment, meeting, 1-on-1, one-on-one, session | `APPOINTMENT` | [Create Appointment Service](./create-appointment-service.md) |
| class, yoga, pilates, group session, group workout, bootcamp class | `CLASS` | [Create Class Service](./create-class-service.md) |
| workshop, program, course, training program, multi-session, fixed series, 8 sessions | `COURSE` | [Create Course Service](./create-course-service.md) |
| (unclear or unspecified) | `APPOINTMENT` | [Create Appointment Service](./create-appointment-service.md) |

## Step 2: Follow the Type-Specific Recipe

Once the service type is determined, follow the corresponding recipe linked above. Each recipe covers:

1. Gathering business context (staff where required, categories, duplicate check)
2. Applying type-specific defaults (pricing, capacity, duration, staff assignment)
3. Creating the service via `bulkCreateServices`
4. For COURSE services with session dates/counts, creating separate Calendar events via `bulkCreateEvents` on the returned `service.schedule.id`
5. Navigating to the service form for user review
6. Providing a summary of what was created and assumptions made
