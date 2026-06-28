---
name: "SMB Create Appointment Service"
description: Create a Wix Bookings APPOINTMENT-type service for 1-on-1 sessions — refusing to finish until at least one staff member with working hours is assigned.
---

## Required capabilities (platform-neutral)

This skill declares the neutral capabilities it needs; the connected platform's tools (the Wix MCP) supply the concrete API calls at runtime.

  - service.create
  - service.get
  - service.set-locations
  - staff.schedule.get                         # confirm staff has working hours
  - site.get-properties

# Create an APPOINTMENT service

## Goal

Create a 1-on-1 bookable service that customers can actually schedule against staff availability. **Refuse to finish until at least one staff member is assigned AND that staff member has working hours on their schedule** — an APPOINTMENT service without an available staffer is non-bookable.

## Flow at a glance

```
Caller passes: service_name + duration + price + staff_member_ids + staff_availability
   ↓
Agent: validate staff have working-hours schedules (staff.schedule.get)
   ↓
Agent → Owner: "Creating '{service_name}', {duration} min, ${price}, with instructors X and Y.
                X works Mon-Fri 9-5; Y works Tue/Thu 18-21. Proceed?"  ← ⛔ STOP, await approval
   ↓
Owner: yes
   ↓
Agent: service.create
   ↓
Agent: HARD STOP if no service.id
   ↓
Agent: VERIFY — service.get + staff.schedule.get for each staff_id
   ↓
Agent → Owner: "Done. {service_name} is bookable. Public page: {url}"
```

## When to use

- **Proactive data signal:** owner finished onboarding for a personal-training, nutrition-coaching, or bodywork subvertical (per Industry.md clusters).
- **Human trigger:** owner says "add a private session" / "set up a consultation" / "create 1-on-1 service".

## Inputs

| name | required | example | notes |
|---|---|---|---|
| service_name | yes | "Personal Training" | Use Industry.md APPOINTMENT cluster names |
| duration_min | no | `60` | Defaults to 60; common values 30/45/60/75/90 |
| price | no | `77` | Industry median (USD 77). `USD` from Vocabulary |
| staff_member_ids | **yes — blocker** | `["staff_abc123"]` | At least one required. Resolve from owner's staff list |
| staff_availability | **yes — blocker** | `{ "staff_abc123": { "MO": [{start: "09:00", end: "17:00"}], ... } }` | Required: defines when this service can be booked |
| location_type | no | `OWNER_BUSINESS` | For online-only services use `CUSTOM` + `is_video_session = true` |

## Steps

### 1. Resolve defaults
- `USD` ← **the live site**, via `site.get-properties` — Wix Bookings has one site-wide currency, and `locale.country` drives the displayed symbol (US-locale site → `$`, IL → `₪`). Do **not** price from the `USD` geo default. If the owner's uploaded pricing implies a different currency than the site's, **reconcile before creating** — confirm with the owner and either set the site currency/locale or keep the site's; never silently price in the wrong currency. (Owner-facing verify rule — report the *real* currency, never show `$` for a `₪` price — lives in `guidance/host-prompt-guardrails.md`.)
- `price` ← Industry.md APPOINTMENT median (`77`) if not provided
- `instructor` ← Vocabulary (`instructor` / `trainer` / `coach` depending on subvertical)
- `policy` defaults: `late_cancellation_limit_minutes = 1440`, `early_booking_limit_minutes = 60` (no last-minute walk-ins by default)

### 2. Validate staff readiness — HARD STOP if not ready
- For each `staff_id` in `staff_member_ids`:
  - read the staff member's working-hours schedule (`staff.schedule.get`)
  - Confirm the staff has at least one block of working hours
- If any staff has no working hours, **block** and ask the owner to set hours for that staff first. Don't proceed — appointment availability comes from the intersection of service definition + staff working hours; without the latter, the service is non-bookable even with the former.

### 3. Confirm the plan with the owner
> Creating **{service_name}** — {duration_min} min, ${price}, with instructors {staff_names}. {staff_X} works {days/hours}; {staff_Y} works {days/hours}. Anyone booking will pick a slot from those hours. Proceed?

### 4. Create the service shell
- Create the service via `service.create` — an APPOINTMENT-type service carrying: name; session
  duration(s) and buffer between sessions; price + currency (payable online and/or in person); location;
  the assigned staff; the booking policy; and video conferencing when `is_video_session`.
- HARD STOP: if the create doesn't return a persisted service with an id, surface the error to the owner
  and ask retry/edit/cancel.

### 5. Set locations explicitly
- If the service uses a non-default location, set it via `service.set-locations` as a separate
  step — location changes are not handled by the general service update.

### 6. VERIFY — appointment is actually bookable
- `service.get` and confirm the assigned staff match the input and the requested session duration
  is present.
- For each assigned staff, `staff.schedule.get` and confirm working hours are still present.
- Optionally run an availability query for the next 7 days to confirm at least one bookable slot returns.

### 7. Report back
- Surface to the owner: service ID, public booking page URL, sample available slot from step 6's availability query.
- Suggest next: if owner uploaded multiple staff but assigned only one, suggest `onboard-second-staff-member-into-the-business` to wire up the rest.

## Decision points

- **Staff has no working hours** → block. Hand off to the owner to set hours via the dashboard, then resume.
- **Multiple staff with overlapping availability** → fine; Wix Bookings handles round-robin assignment by default.
- **Owner wants the appointment to be free** → make it a no-fee service that is still bookable in person (a no-fee service that isn't marked in-person-payable fails validation).
- **Owner wants only video sessions** → use a custom location and set `is_video_session`; enabling conferencing auto-generates the meeting links on booking confirmation.
- **This service uses a shared room/equipment** → attach `resource_type_ids` at the **service level**; Wix then availability-checks the type's resources + staff and allocates a free one at booking. Attachment is **selective** — only pass `resource_type_ids` for services that actually need a resource; most appointment services need none. The pool itself is created **once** by `setup-rooms-and-equipment`, never here. Enforcing the assignment requires a **Business+ plan**; below it the link may be accepted but not enforced — recommend Business+ if the owner wants resource management.

## Outputs

- Service ID
- Public booking page URL
- A sample available slot in the next 7 days (proof of bookability)
- Suggested next skill

## Anti-patterns

- ❌ Creating an APPOINTMENT service with no assigned staff. The Wix Bookings API accepts it, but the customer-facing page will show no slots.
- ❌ Assuming staff with working hours implies bookable. Some staff have working hours blocked by vacation/time-off — the verify step's availability query catches this.
- ❌ Folding a location change into the general service update. Use the dedicated `service.set-locations` capability.
- ❌ Not handing this skill the `staff_availability` input upfront. The onboarding skill must collect staff availability from the uploaded staff list before invoking — empty availability is a guaranteed blocker.
