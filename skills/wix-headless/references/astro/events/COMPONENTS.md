# Events — astro components (client islands)

The `components` scope of the events vertical. Read `../../events/FLOW.md` first (the two modes, the reserve→redirect sequence, the visitor-not-elevated rule). This file is the astro *wiring*; the reference code is at `<SKILL_ROOT>/references/astro/templates/events/`.

## Islands you write

| Island | Role | Drives |
|---|---|---|
| `TicketPicker.tsx` | Per-tier quantity picker for a `TICKETING` event → reserve + redirect to Wix's hosted checkout | `eventsDriver.buyTickets()` |
| `RsvpForm.tsx` | Built-in name + email form for an `RSVP` event → inline confirmation | `eventsDriver.rsvp()` |

`eventsDriver.ts` (the SDK sequence) is **pre-copied** by the orchestrator to `src/components/eventsDriver.ts` — import it, never re-author it.

## Astro-specific rules

1. **Ambient SDK, no client.** The islands call the `@wix` modules through `eventsDriver.ts`, which calls them ambiently (the `@wix/astro` visitor client). No `createClient`, no `OAuthStrategy`, no `clientId`. (Own/static builds DO use `OAuthStrategy` — `../../custom/events/WIRING.md`.)
2. **Visitor context — never elevate the island.** Reserve + redirect + rsvp run as the anonymous visitor. There is **no** `src/pages/api/*` route and **no** `auth.elevate()` in this flow. (Elevation belongs only to the SSR *reads* in the pages scope — never the checkout.) Elevating the redirect breaks it (`clientId` error).
3. **`client:only="react"`.** Both islands are session-specific and redirect/submit — always mount `client:only="react"`, never `client:load`.
4. **Branch on the event type** (passed from the page). `TICKETING` → `TicketPicker` (tiers + quantities). `RSVP` → `RsvpForm` (fixed name+email — the built-in form; do NOT fetch a form schema).
5. **Fail soft on the payment-method gate.** A paid reservation can throw `No payment method configured` — `TicketPicker` shows a friendly "ticket sales aren't switched on yet" message via `isPaymentSetupError` (in the driver). Don't surface a raw error.
6. **No CSS here.** Component classes live in `src/styles/components-events.css` (pre-copied). Use the documented class names (`.ticket-*`, `.rsvp-*`).

## Return contract

End with the fenced JSON block (per `../../shared/RETURN_CONTRACT.md`) listing the component files you wrote under `data.creates`.
