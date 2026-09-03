---
name: "Bookings Recipes"
description: "Appointment scheduling — create appointment, class and course services, set staff and their working hours, booking policies and waitlists, multi-resource services, external calendar sync, run the end-to-end booking and payment flow, and diagnose why a service is not bookable. Use for anything users call bookings, appointments, classes, courses, sessions, scheduling, staff, calendar availability, or reservations."
---

# Bookings Recipes

Service type drives everything: **APPOINTMENT** (one-on-one, needs a staff member), **CLASS** (group, recurring sessions) and **COURSE** (group, fixed run of sessions) have different required fields. If the user's wording makes the type clear, go straight to **Create Appointment Service**, **Create Class Service** or **Create Course Service**; if it does not, **Create Booking Service from Prompt** resolves the type first. **Create and Update Booking Services** is the general CRUD reference for editing existing services.

Two things commonly block bookability after a service exists: staff have no working hours (**Bookings Staff Setup** — create staff, assign a schedule, then create working-hours events, in that order) and the business has no default hours at all (see the calendar recipes). When a service should be bookable but is not, **Diagnose Bookings Availability Issues** answers that directly rather than guessing.

For the rest: **Booking Service Policy Setup** for booking and cancellation rules and waitlists, **Multi-Resource Service Creation** when a session needs rooms or equipment alongside staff, **External Calendar Integration** for Google, Outlook or Apple sync, **End-to-End Booking Flow** to take a booking through availability and payment, and **Booking System Integration Gaps** for the undocumented Bookings-to-eCommerce payment patterns.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [End-to-End Booking Flow](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/end-to-end-booking-flow)
**Technical:** Complete booking flow from service discovery to payment. Query services,
check availability with Time Slots V2, create bookings, and process payment via
eCommerce checkout.

### [Create and Update Booking Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-and-update-booking-services)
**Technical:** Full CRUD operations for Wix Bookings services using Services API. Covers
service types (APPOINTMENT, CLASS, COURSE), pricing configuration, location setup, and
schedule management.

### [Bookings Staff Setup](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/bookings-staff-setup)
**Technical:** Creates staff members and configures custom working hours using Staff API
+ Calendar Events API. Critical two-step process: create staff → assign schedule →
create working hours events.

### [Booking Service Policy Setup](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/booking-service-policy-setup)
**Technical:** Sets up booking policies, cancellation rules, and waitlist configuration
using the Services API policy fields. Covers bookingPolicy, cancellationPolicy, and
waitlist settings.

### [Multi-Resource Service Creation](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/multi-resource-service-creation)
**Technical:** Creates resource types and individual resources using Resources API.
Enables services that require multiple resources (rooms + equipment + staff) with
automatic allocation.

### [External Calendar Integration](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/external-calendar-integration)
**Technical:** OAuth-based integration with Google Calendar, Microsoft Outlook, and
Apple Calendar. Covers authentication flows, sync configuration, and bidirectional event
management.

### [Booking System Integration Gaps](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/booking-system-integration-gaps)
**Technical:** Documents undocumented API patterns for booking payments. Covers
Bookings→Ecommerce integration, booking ID transformation to catalog items, and async
payment confirmation flows.

### [Create Booking Service from Prompt](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-booking-service-from-prompt)
**Technical:** Create a booking service from a user prompt — e.g. 'create a yoga class
for $50', 'set up consultations for $75', 'add a personal training appointment', 'create
a 6-week photography workshop', 'create a hidden free test course with 8 online
sessions'. Determines the service type (APPOINTMENT, CLASS, or COURSE) and delegates to
the type-specific recipe. For COURSE services with session dates/counts, follow the
course recipe's separate Calendar bulkCreateEvents step; Services V2 alone does not
create bookable course sessions.

### [Create Appointment Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-appointment-service)
**Technical:** Create an appointment booking service — e.g. 'set up consultations',
'create a 1-on-1 session', 'add a personal training appointment', 'create a meeting
service for $25'. Handles staff assignment (required), session duration, pricing, and
1-on-1 capacity defaults via bulkCreateServices API.

### [Create Class Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-class-service)
**Technical:** Create a class booking service — e.g. 'create a yoga class for $50', 'set
up a pilates class', 'add a group fitness session', 'create a weekly meditation class'.
Handles group capacity, recurring session defaults, and pricing via bulkCreateServices
API. Staff assignment is not used for classes.

### [Create Course Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-course-service)
**Technical:** Create a course booking service — e.g. 'create a 6-week photography
workshop', 'set up a training program', 'add a bootcamp course for $300', 'create a
hidden free test course with 8 sessions'. Handles group capacity, full-course pricing,
bulkCreateServices, and separate course session events via bulkCreateEvents. Staff
assignment is not used for courses.

### [Diagnose Bookings Availability Issues](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/diagnose-bookings-availability-issues)
**Technical:** Answers whether an appointment-based Wix Bookings service currently has
bookable availability — the primary question — and diagnoses the cause only when there's
no availability or the owner asks why. To diagnose, first rules out service-level
blockers the availability endpoint can't see (service hidden, online booking off), then
runs DiagnoseAvailability for ordered, machine-readable staff/setup reasons, with a
manual fallback for booking-policy and capacity causes. Use when someone asks whether a
service has availability, or why a service shows no times / customers can't book it.

### [Bookings Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/bookings-dashboard-navigation)
**Technical:** Builds direct links to Wix Bookings dashboard pages on manage.wix.com —
services list, edit a specific service, calendar, booking list, staff, availability,
resources, and settings pages. Pairs each main Bookings entity with its read API so you
can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user
asks where something is in the Wix dashboard, wants a direct link to a dashboard page,
or you need a dashboard URL to include with the result of an API operation.
