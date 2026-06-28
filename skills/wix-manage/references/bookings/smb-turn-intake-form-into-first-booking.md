---
name: "SMB Turn Intake Form Into First Booking"
description: When a Wix Forms intake is submitted, surface a personal follow-up that proposes specific classs based on the form responses, owner-approved.
---

## Required capabilities (platform-neutral)

This skill declares the neutral capabilities it needs; the connected platform's tools (the Wix MCP) supply the concrete API calls at runtime.

  - form-submission.get
  - service.query
  - availability.query
  - contact.query
  - contact.create
  - campaign.send

# Turn intake form into first booking

## Goal

A new lead just submitted an intake form. Within an hour, the agent surfaces a personal follow-up that proposes 2-3 specific session times matched to the form responses, owner approves, sends. The faster + more specific the follow-up, the higher the conversion.

## Flow at a glance

```
Trigger: form_submitted event
   ↓
Agent: form-submission.get → pull all form fields (name, email, interest, availability)
   ↓
Agent: find-or-create contact + tag `intake-{form_name}-{date}`
   ↓
Agent: match form's "service interest" + "availability" against actual schedule
   ↓
Agent: availability.query for 3 candidate slots in the lead's window
   ↓
Agent → Owner: draft + 3 proposed slots. ⛔ STOP, await approval
   ↓
Owner: yes
   ↓
Agent: send via email with booking-page deep link per slot
```

## Steps

### 1. Pull the submission
- `form-submission.get(submission_id)` → all fields (typically: name, email, phone, service interest, preferred days/times, goals).

### 2. Find-or-create the contact
- `contact.query` by email → if exists, use; if not, `contact.create` with form fields.
- Tag: `intake-{form_slug}-{date}`.

### 3. Match interest to available services
- Map the form's "service interest" field (e.g. "personal training") to actual `services` of matching type/name.
- If multi-select, pick the top match.

### 4. Find 3 candidate slots
- `availability.query` for the matched service + the lead's preferred window (or next 7 days if no preference).
- Pick 3 spaced across different days/times.

### 5. Draft the follow-up
> Hi {first_name}, thanks for reaching out about {service_name}!
>
> Based on your note that {one-sentence echo of the form's "what are you looking for" field}, here are 3 times that could work:
> 1. **{slot_1_human}** — book here: {link_1}
> 2. **{slot_2_human}** — book here: {link_2}
> 3. **{slot_3_human}** — book here: {link_3}
>
> Or just reply with what works better. — {owner_first_name}

### 6. Surface to owner — ⛔ STOP
- Show: form responses, draft, 3 slots.
- Owner approves / edits.

### 7. Send + tag
- VERIFY messageId. Tag contact `intake-followup-sent-{date}`.

## Decision points

- **Form fields are incomplete** (no service interest) → ask the owner in a single nudge: "Sarah's form didn't say which service she wants — want me to ask?" Don't guess.
- **Multiple services match** → propose the top 2; let the customer pick by replying.
- **No available slots in the lead's window** → propose the closest 3 outside their window; surface as "the slots you asked about are full — closest available are…"

## Anti-patterns

- ❌ Sending without owner approval. Intake responses are warm leads, not list members.
- ❌ Generic "thanks for your interest" with no concrete slots. The whole point is specificity.
- ❌ Waiting > 4 hours to surface. Lead temperature halves after the first hour.
