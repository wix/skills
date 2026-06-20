---
name: "SMB Draft Cancellation Notification"
description: When a confirmed class is canceled, draft an apologetic notification to the member that names the instructor and proposes 2-3 concrete rebook slots from the same instructor's upcoming availability.
---

## Required capabilities (platform-neutral)

This skill declares the neutral capabilities it needs; the connected platform's tools (the Wix MCP) supply the concrete API calls at runtime.

  - booking.get
  - service.get
  - availability.query
  - contact.get
  - campaign.send

# Draft cancellation notification + rebook offer

## Goal

A confirmed class was just canceled (owner / staff / system, not the member themselves). Send a short, human, apologetic note that **names the instructor** who would have led the session and offers **2-3 specific slots** with the same instructor in the next `7` days — owner approves once per send, the member gets a concrete next step instead of a dead end.

## Flow at a glance

```
Trigger: booking.canceled (initiator ≠ customer)
   ↓
Agent: booking.get + service.get → service + staff + slot time
   ↓
Agent: contact.get → first name + email consent
   ↓
Agent: availability.query → next 3 slots same instructor, same service
   ↓
Agent → Owner: draft message + slot list. ⛔ STOP per send
   ↓
Owner: yes
   ↓
Agent: send via email; tag contact `cancel-notified-{date}`
```

## When to use

- **Proactive data signal (primary):** `booking.canceled` event fires AND `cancellation_initiator` is `owner`, `staff`, or `system` (not the member).
- **Human trigger:** owner says "cancel {first_name}'s class" or "apologize to {first_name} for the cancellation".

## Inputs

| name | required | example | notes |
|---|---|---|---|
| booking_id | yes | "bk_abc123" | The canceled booking |
| rebook_window_days | no | `14` | How far ahead to search rebook slots |
| rebook_slot_count | no | `3` | How many slots to surface (2 if same instructor has thin availability) |
| cancellation_reason | no | "instructor sick" | If known, threads through the apology copy |

## Steps

### 1. Pull cancellation context
- `booking.get` for `{booking_id}` → service_id, staff_resource_id, original slot time, member contact_id.
- `service.get` for service_id → service name in the owner's catalog (use the real name, never "service").
- HARD STOP if `cancellation_initiator` is the member themselves — they don't need an apology, just an acknowledgment (different skill, not this one).

### 2. Resolve contact + consent
- `contact.get` → first name, marketing consent on `email`.
- HARD STOP if no consent — surface the cancellation to the owner with a "no consent, please call them" prompt rather than sending.

### 3. Find rebook slots
- `availability.query` filtered to:
  - `service_id` = the canceled service
  - `staff_resource_id` = the same instructor (continuity matters in fitness)
  - `from = now`, `to = now + 7`
- Pick `3` slots spaced across days/times to give real choice.
- **Fallback:** if same instructor has < `3` slots in the window, broaden to any instructor on the same service and call that out in the copy ("with instructor {staff_name_2}").

### 4. Draft the message

> Hi {first_name},
>
> Really sorry — we had to cancel your {service_name} with instructor {staff_name} on {original_day_time}. {one-line cancellation_reason if provided}
>
> Here are 3 times you could grab instead, same instructor:
> - {slot_1_day_time}
> - {slot_2_day_time}
> - {slot_3_day_time}
>
> One click and you're back in — or reply and I'll find a different mix.
>
> — {owner_first_name}

Personalisation checklist: first name, the **real service name** (never "your session"), the instructor's name, the originally-booked day/time, and the cancellation reason when the owner provided one.

### 5. ⛔ STOP for owner approval
- Show: member's name, canceled slot, proposed slots, draft message, channel.
- Owner: approve / edit / "let me call them instead" / skip.

### 6. Send + tag
- `campaign.send` (transactional, single-recipient) via `email`.
- VERIFY: confirm `messageId` returned (don't trust 200-OK alone).
- Tag contact: `cancel-notified-{booking_id}-{date}`.

## Decision points

- **No same-instructor slots within the window** → broaden to any instructor on the service; call it out in copy.
- **No availability at all** within `7` → message becomes apology-only, with "I'll reach out as soon as {staff_name}'s schedule opens up" — flag to the owner that the instructor may be under-scheduled.
- **member on a paused plan or canceled subscription** → tag them as `lapsed-with-cancel` and surface to owner for personal outreach rather than auto-send.
- **Owner wants to call instead** → don't send; hand the owner the booking context and step back.

## Outputs

- Apology + rebook-offer message sent (or routed to owner-call)
- Contact tagged `cancel-notified-{booking_id}-{date}`
- instructor's availability surface, if thin, flagged to owner

## Anti-patterns

- ❌ Generic "your booking has been canceled" with no apology and no rebook. That's the PREINSTALLED default — owners do better.
- ❌ Proposing rebook slots with a *different* instructor silently. members in fitness pick their instructor; the swap needs to be named.
- ❌ Auto-sending without owner approval. Cancellation tone is high-stakes; the wrong wording loses the customer faster than silence.
- ❌ Firing on customer-initiated cancellations. They canceled themselves — they don't need to be apologized to.
- ❌ Sending without consent check. Even transactional notifications should respect a do-not-contact tag.
