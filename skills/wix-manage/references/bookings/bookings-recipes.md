---
name: "Bookings Recipes"
description: "Appointment scheduling — create appointment, class and course services, set staff and their working hours, booking policies and waitlists, multi-resource services, external calendar sync, run the end-to-end booking and payment flow, and diagnose why a service is not bookable. Use for anything users call bookings, appointments, classes, courses, sessions, scheduling, staff, calendar availability, or reservations."
---

# Bookings Recipes

Service type drives everything: **APPOINTMENT** (one-on-one, needs a staff member), **CLASS** (group, recurring sessions) and **COURSE** (group, fixed run of sessions) have different required fields. If the user's wording makes the type clear, go straight to **Create Appointment Service**, **Create Class Service** or **Create Course Service**; if it does not, **Create Booking Service from Prompt** resolves the type first. **Create and Update Booking Services** is the general CRUD reference for editing existing services.

Two things commonly block bookability after a service exists: staff have no working hours (**Bookings Staff Setup** — create staff, assign a schedule, then create working-hours events, in that order) and the business has no default hours at all (see the calendar recipes). When a service should be bookable but is not, **Diagnose Bookings Availability Issues** answers that directly rather than guessing.

For the rest: **Booking Service Policy Setup** for booking and cancellation rules and waitlists, **Multi-Resource Service Creation** when a session needs rooms or equipment alongside staff, **External Calendar Integration** for Google, Outlook or Apple sync, **End-to-End Booking Flow** to take a booking through availability and payment, and **Booking System Integration Gaps** for the undocumented Bookings-to-eCommerce payment patterns.

## Recipes

### [End-to-End Booking Flow](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/end-to-end-booking-flow)
Use to actually book something: find the service, check time slots, create the booking, take payment through checkout.

### [Create and Update Booking Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-and-update-booking-services)
Use as the general CRUD reference: service types, pricing, location and schedule fields, and editing existing services.

### [Bookings Staff Setup](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/bookings-staff-setup)
Use to add staff and give them working hours — create staff, assign the schedule, then create the working-hours events.

### [Booking Service Policy Setup](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/booking-service-policy-setup)
Use for booking and cancellation policies and waitlist settings on a service.

### [Multi-Resource Service Creation](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/multi-resource-service-creation)
Use when a session needs resources beyond staff — rooms, equipment — with automatic allocation.

### [External Calendar Integration](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/external-calendar-integration)
Use to connect Google, Outlook or Apple calendars, including the OAuth flow and sync configuration.

### [Booking System Integration Gaps](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/booking-system-integration-gaps)
Use for booking payments through eCommerce — booking-to-catalog-item transformation and async payment confirmation.

### [Create Booking Service from Prompt](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-booking-service-from-prompt)
Use when the user's request does not clearly name a service type — it resolves appointment versus class versus course, then creates it.

### [Create Appointment Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-appointment-service)
Use for one-on-one services (consultations, sessions, personal training) — staff assignment is required.

### [Create Class Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-class-service)
Use for group services with recurring sessions (yoga, pilates, group fitness) — capacity and session defaults.

### [Create Course Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-course-service)
Use for a fixed run of group sessions (workshops, bootcamps, programmes) — capacity and session count.

### [Diagnose Bookings Availability Issues](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/diagnose-bookings-availability-issues)
Use when a service should be bookable but is not, or the owner asks why nothing is available.

### [Bookings Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/bookings-dashboard-navigation)
Use when the user wants the services list, a service editor, the calendar, bookings list, staff, availability, resources or settings.
