---
name: "Create Booking Service from Prompt"
description: "Create a booking service from a user prompt — e.g. 'create a yoga class for $50', 'set up consultations for $75', 'add a personal training appointment', 'create a 6-week photography workshop'. Determines the service type (APPOINTMENT, CLASS, or COURSE) and delegates to the type-specific recipe."
---

# Create Booking Service from Natural Language Prompt

## When to Use

- User describes a service they want to create using natural language (e.g., "create a yoga class for $50", "set up consultation sessions", "add a personal training appointment")
- The intent is autonomous creation — fill in reasonable defaults rather than asking the user for every field

## Step 1: Determine Service Type

| User mentions | Type | Recipe |
|---|---|---|
| consultation, appointment, meeting, 1-on-1, one-on-one, session | `APPOINTMENT` | [Create Appointment Service](./create-appointment-service.md) |
| class, yoga, pilates, group session, group workout, bootcamp class | `CLASS` | [Create Class Service](./create-class-service.md) |
| workshop, program, course, training program, multi-session | `COURSE` | [Create Course Service](./create-course-service.md) |
| (unclear or unspecified) | `APPOINTMENT` | [Create Appointment Service](./create-appointment-service.md) |

## Step 2: Follow the Type-Specific Recipe

Once the service type is determined, follow the corresponding recipe linked above. Each recipe covers:

1. Gathering business context (staff where required, categories, duplicate check)
2. Applying type-specific defaults (pricing, capacity, duration, staff assignment)
3. Creating the service via `bulkCreateServices`
4. Navigating to the service form for user review
5. Providing a summary of what was created and assumptions made
