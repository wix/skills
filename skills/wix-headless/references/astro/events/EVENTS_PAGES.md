# Events — astro pages (SSR)

The `pages` scope of the events vertical. Read `../../events/FLOW.md` first. This file is the astro *wiring*; reference code is at `<SKILL_ROOT>/references/astro/templates/events/`.

## Pages you write

| Page | Role |
|---|---|
| `events/index.astro` | SSR listing grid of upcoming events |
| `EventCard.astro` | Static card (no interactivity) used by the grid |
| `events/[slug].astro` | SSR event detail; mounts `TicketPicker` (ticketed) or `RsvpForm` (RSVP) |
| `event-confirmation.astro` | Post-checkout confirmation, rendered from `?orderNumber=` query params |

## Astro-specific rules

1. **SSR reads are ambient VISITOR reads — NOT elevated.** The listing, detail, and ticket-tier reads are all public, so call them ambiently (no `auth.elevate`, no `@wix/essentials`): `wixEventsV2.getEventBySlug(slug, { fields: [...] })` (detail) and the `wixEventsV2.queryEvents(...)` builder (listing). Elevation over-permissions a public page and is SSR-only, so the same read wouldn't port to a SPA. Do **not** build `createClient({ auth: OAuthStrategy({ clientId: import.meta.env.* }) })` on astro either — that env var is client-only and `undefined` at server render → 500. (The island's checkout is also the visitor side — same identity, both correct.)
2. **Detail by slug:** `wixEventsV2.getEventBySlug(slug, { fields: ["DETAILS","TEXTS","REGISTRATION","URLS"] })` (ambient). Read `event._id`, `event.slug`, `event.title`, `event.shortDescription`, `event.mainImage?.url`, `event.dateAndTimeSettings?.formatted?.dateAndTime`, `event.location?.name`, `event.registration?.initialType` (`TICKETING`|`RSVP`), `event.registration?.tickets?.ticketLimitPerOrder`, `event.registration?.rsvp?.responseType`.
3. **Ticket tiers (ticketed only) — visitor-public read, no elevation:** `orders.queryAvailableTickets({ filter: { eventId }, limit: 50 })` (`import { orders } from "@wix/events"`). Results on `res.definitions`. Per tier read `def._id`, `def.name`, `def.description`, `def.price?.value` (a **string**) + `def.price?.currency`, `def.free`, `def.saleStatus` (`SALE_SCHEDULED`|`SALE_STARTED`|`SALE_ENDED` — treat `SALE_ENDED` as sold out/unavailable), `def.limitPerCheckout`. **Do NOT** use `ticketDefinitions(V2).queryTicketDefinitions` — those are **management** endpoints that 403 the visitor and would force `auth.elevate`. **`limit` is required** (defaults to `0` = metadata only, `definitions: []`).
4. **Listing query — use the `queryEvents` builder** (`wixEventsV2.queryEvents({ fields }).in("status", ["UPCOMING","STARTED"]).ascending("dateAndTimeSettings.startDate").limit(100).find()` → `res.items`). **There is no `customQueryEvents` export.** Always wrap reads in try/catch and degrade to an empty state; never crash the page.
5. **Branch the detail page on type** to mount the right island, both `client:only="react"`: `TICKETING` → `<TicketPicker eventSlug tiers ticketLimitPerOrder>`; `RSVP` → `<RsvpForm eventId allowDecline>`.
6. **Confirmation reads query params only** — Wix's hosted checkout returns to `/event-confirmation?orderNumber=…&eventId=…`. Render from those; do **not** re-fetch a stranger's order on this public page. (RSVP confirms inline in the island — it does not route here.)
7. **Entity ids are `_id`**; prices are strings; filter listings to upcoming/published events (a past event isn't purchasable).

## Shell chain — nav + home (serialized; this agent patches shared files)

This vertical is a **shell patcher** (BUILD-astro.md § "Dispatch the wave" batch B). In addition to its private pages, it inserts at the markers the composed shell exposes — wherever those shell files come from (template-composed or LLM-generated, the marker contract is the same):
- **`src/components/Navigation.astro`** at `<!-- nav:links -->` — an **Events** link to `/events`.
- **`src/pages/index.astro`** at `<!-- home:events -->` — a short events teaser (next event or an "Upcoming events" block linking to `/events`).

Insert at the marker; never restructure the shell. If a marker is absent (the shell was authored without it), **skip that insertion and note it** (`{code:"MARKER_MISSING", marker:"<!-- home:events -->"}`) rather than fabricating a section or restructuring the page. These shared-file writes are why events runs in the serialized shell chain, not the concurrent batch.

## Pre-return file-existence assertion

Before returning `status: "complete"`, verify on disk: `src/pages/events/index.astro`, `src/pages/events/[slug].astro`, `src/pages/event-confirmation.astro`. If any is missing, return `status: "partial"` with `errors: [{ code: "PHASE4_FILE_MISSING", path: "<expected>" }]`.

## Return contract

End with the fenced JSON block (per `../../shared/RETURN_CONTRACT.md`) listing the page files you wrote under `data.creates` + the shell files you patched.
