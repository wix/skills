# Events — playbook

The events machinery ships as files — event reads (paged list, by slug, by id, a recurring
series' dates, the category pills), the visitor-public ticket-tier read (every pricing method,
availability, sale period, the tax and fee lines checkout adds), the exact `reserve →
hosted-checkout redirect` sequence, RSVP on the organizer's own form, the post-checkout order read,
the registration controls, and the SEO plumbing, typed end-to-end. **The presentation doesn't ship
— you build it** on the shipped hooks/DTOs: the event card and the events index, the event page's
layout, the home page, and the brand. You never write registration logic; you never skip designing.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the two
island imports in the shipped pages. Files you **create**: your listing component (skeleton below)
and your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes, ratio)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(e.imageUrl, "33vw", 2 / 3)} alt={e.title} />`; `imgSrc()` / `imgSrcSet()` / `formatMoney()` underneath |
| `wix/events/types.ts` | the DTOs (`EventSummary`, `EventDetail`, `TicketTier`, `TicketSelection`, `SelectionTotals`, `RsvpForm`, `OrderSummary`, `RegistrationResult`) — contracts inlined below |
| `wix/events/events.ts` | `fetchEventsPage` / `fetchEvents` (live events, soonest first, paged), `fetchEventBySlug`, `fetchEventById` (the post-checkout confirmation read), `fetchOccurrences` (a recurring series' dates), `fetchCategories` (the pills) — the transport; the rules and DTO mappers are in `events-core.ts` beside it (shared with the REST layer) |
| `wix/events/registration.ts` | `fetchTicketTiers`, `startTicketCheckout`, `submitRsvp` — the exact reserve→redirect sequence and the RSVP body built from the organizer's form; rules in `registration-core.ts` beside it |
| `wix/events/orders.ts` | `fetchOrder(eventId, orderNumber)` — the confirmation page's order (invoice, status, ticket PDF); mapper in `orders-core.ts` |
| `wix/events/events-store.ts` · `registration-store.ts` · `order-store.ts` | the listing, registration and confirmation state machines, framework-free (`createEventsStore()`, `createRegistrationStore(event)`, `createOrderStore({ orderNumber, eventId })` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/events/useEvents.ts` | React binding of `events-store.ts`: listing, category filter, load more — contract below |
| `hooks/events/useEventRegistration.ts` | React binding of `registration-store.ts`: tiers, quantities, donation amounts, totals, checkout, the RSVP form — contract below |
| `hooks/events/useEventConfirmation.ts` | React binding of `order-store.ts`: the event, the order, the tickets-ready poll — contract below |
| `components/events/EventRegistrationView.tsx` | the registration controls for one event — branches on the registration state and type (closed / scheduled / paused; the tier picker with fixed, free, donation and pricing-option tiers, sold-out and sale-period badges, tax and fee lines, running totals and the gated CTA; the organizer's RSVP form with the guest picker and its confirmed / waitlisted / declined states; the external link) — **wire as-is** in your event page's registration column (`<EventRegistrationView client:only="react" event={event} />`); build your own on `useEventRegistration` only when the brief wants more |
| `components/events/EventConfirmationView.tsx` | the hosted checkout's thank-you island — reads `?orderNumber=&eventId=`, the order's status, invoice and ticket download once Wix has generated the tickets, the event for context, an honest "no order" state on a direct visit, and a confirmation without details when the order can't be read — **wire as-is** |
| `components/events/EventsView.tsx` (+ `EventCard`) | **reference** listing — correct and plain; the shipped `events.astro` mounts it so the site works before you design; you build your own on `useEvents` and swap the import |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — shared across verticals). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | the site chrome — **yours to brand** (keep the `seo-tags` slot + the global.css import). If another vertical is also deployed, its layout won — add an Events nav link there |
| `pages/events.astro` | SSR listing (the first page via `fetchEventsPage`) — **keep the frontmatter**, swap the island import to YOUR listing component |
| `pages/events/[slug].astro` | SSR event page with owner-editable SEO — **keep the frontmatter and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly; the markup between them (including the "other dates" list of a recurring series) is yours to redesign around the shipped registration island (`client:only="react"`) |
| `pages/event-confirmation.astro` | the hosted checkout's thank-you landing (`?orderNumber=&eventId=`) — **keep the route**; the shipped checkout callbacks point at it |

## What you build — the design job

1. **The event card + events index** — your tile (image, date eyebrow, title, venue/online,
   price-from, sold-out badge) and rhythm, the category filter (only when >1 category), a
   "load more" control when `hasMore`, skeletons while loading, an honest empty state — on `useEvents`.
2. **The event page's layout** — hero image, date, venue and address, about, other dates of a
   recurring series, with the shipped `EventRegistrationView` as the registration column; design
   the page for the brand (an editorial split, a sticky registration column, a full-bleed hero).
   Registration logic never leaves the shipped component and hook.
3. **The home page** — hero, next/featured events (fetch in frontmatter → your components),
   brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass). Style
everything with Tailwind utilities on the tokens.

### What a complete events site shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins when it asks for something
else. Look at the seeded events before designing (how many, ticketed or RSVP, images, categories).

- **Home:** what the events are and the next one in the first screen; real events under truthful
  headings; a link to the index.
- **Index:** a real card — image, date, title, venue, price-from, link — in the first screen; the
  category filter only when the pills number more than one; `events === null` → skeletons, `[]` →
  an honest empty state; `error` → a short inline message; `hasMore` → a load-more control.
- **Event page:** image, date, title, venue and the registration control in the first screen at
  390px wide too — a bounded image band on a phone (`max-h-[45vh]`), the registration column
  under it, the two-column split from `md`; `aboutParagraphs` after the registration control,
  never between the date and the action; `address` under the venue name; `addToCalendar.google`
  as a link when present; a map only from `coordinates` (an `<iframe>` of
  `https://www.google.com/maps?q=${lat},${lng}&output=embed`, or your provider) — never a
  geocode of your own.
- **Registration:** the shipped `EventRegistrationView` — `TICKETING` shows the tier picker,
  `RSVP` the organizer's form, `EXTERNAL` the link out, closed / scheduled / paused their states;
  confirmed and waitlisted read differently.
- **Confirmation:** `/event-confirmation` — the shipped island; the only success surface for a
  ticket order.
- **Copy:** nothing the organizer didn't supply — no invented "X spots left", no fake urgency, no
  Wix IDs in visible text. `TicketTier.limitPerCheckout` is a per-order cap, not a remaining count.

### The contracts your components consume (everything you need — read the source when something is off)

```ts
// EventSummary (tiles) — display-ready:
// { id, slug, title, shortDescription /* plain text */, status: "UPCOMING"|"STARTED"|"ENDED"|"CANCELED"|"DRAFT",
//   dateLabel /* Wix's formatted schedule in the event's zone, or the organizer's TBD message */,
//   startDateIso, endDateIso /* "" when TBD */, timeZoneId /* IANA — the `timeZone` for any Intl formatting you do */,
//   dateTbd, dateTbdMessage, hideEndDate, showTimeZone,
//   locationName, locationType: "VENUE"|"ONLINE"|"TBD", imageUrl,
//   registrationType: "RSVP"|"TICKETING"|"EXTERNAL"|"NONE",
//   priceLabel /* "From €45" | "Free" | "" */, soldOut, categories: [{ id, name }] /* manual categories only */,
//   recurrenceStatus /* "ONE_TIME" | "RECURRING" | … */, recurringCategoryId /* "" unless part of a series */ }
// EventDetail adds: aboutParagraphs: string[], formatted: { startDate, startTime, endDate, endTime },
//   address /* "" for ONLINE/TBD */, coordinates: { lat, lng } | null,
//   registrationStatus /* raw Wix status */, registrationOpen /* accepting now */, registrationClosed /* CLOSED_* */,
//   registrationOpensAtIso, registrationOpensAtLabel /* SCHEDULED_RSVP */, registrationPaused, waitlistOnly, membersOnly,
//   rsvpResponseType: "YES_ONLY"|"YES_AND_NO", rsvpForm: RsvpForm | null, externalUrl, eventPageUrl,
//   addToCalendar: { google, ics }, taxSettings: { name, ratePercent, includedInPrice, appliedToDonations } | null,
//   ticketLimitPerOrder.
// RsvpForm: { controls: [{ id, type: "INPUT"|"TEXTAREA"|"DROPDOWN"|"RADIO"|"CHECKBOX"|"NAME"|"ADDRESS_SHORT"|"ADDRESS_FULL"|"DATE",
//   system, inputs: [{ name /* the key you answer under */, label, mandatory, type, options, maxLength }] }],
//   guestControl: { label, maxGuests, namesLabel } | null }
// TicketTier: { id, name, description, pricingType: "FIXED"|"FREE"|"GUEST"|"OPTIONS",
//   price /* "€45.00" | "Free" | "€10.00 – €25.00" | "" */, free, minPrice /* GUEST */, currency,
//   options: [{ id, name, price, notes }] /* OPTIONS */, notes: string[] /* "+€9.45 VAT", "+€1.36 ticket service fee", "VAT included" */,
//   limitPerCheckout /* 0 = sold out */, soldOut, saleStatus, available /* on sale and not sold out */,
//   saleStartsLabel /* "Goes on sale …" while scheduled */, saleEndsLabel, feeType }
// OrderSummary: { number, status, statusLabel, settled /* FREE|PAID */, email, createdLabel,
//   items: [{ name, price, quantity, total }], subtotal, couponDiscount, paidPlanDiscount: { amount, ratePercent } | null,
//   tax: { name, ratePercent, amount } | null, fee: { amount, ratePercent } | null, total,
//   ticketsPdfUrl, ticketCount, ticketsReady }

// fetchEventsPage({ limit = 20, offset, categoryId?, status: "upcoming"|"past"|"all" = "upcoming" }) → { events, total, hasMore }
// fetchEvents(sameOptions) → EventSummary[]; fetchOccurrences(recurringCategoryId) → EventSummary[]

// useEvents({ initialEvents?, initialTotal?, pageSize?, status? }) →
// { events: EventSummary[]|null /* null = loading → skeletons */,
//   categories: [{ id, name }] /* the site's manual categories; falls back to the loaded events' when the read is refused */,
//   activeCategoryId, setActiveCategoryId(id|null),
//   hasMore, loadingMore, loadMore(), error }
// Only UPCOMING/STARTED events arrive by default, soonest first — a past event is never linked as
// registerable; `status: "past"` lists ENDED events for an archive section.

// useEventRegistration(event: EventDetail) →
// { tiers: TicketTier[]|null,                                  // TICKETING only; null = loading
//   quantities, setQuantity(tierId, qty, optionId?),           // clamped 0..limitPerCheckout and to ticketLimitPerOrder; ignored when !available
//   guestPrices, setGuestPrice(tierId, "25.00"),               // GUEST tiers: the amount the visitor pays
//   selections, ticketCount, ticketLimitPerOrder,
//   totals: { subtotal, tax, fee, total } | null,             // Wix's running totals, formatted; the hosted checkout is authoritative
//   canCheckout,                                              // gate the tickets CTA on canCheckout
//   checkout(): Promise<RegistrationResult>,                  // reserve → the browser redirects to Wix checkout
//   rsvpForm, rsvpValues, setRsvpValue(inputName, value | string[]),   // the organizer's form; CHECKBOX answers are arrays
//   guestCount, guestNames, setGuestCount(n), setGuestName(i, name),  // when rsvpForm.guestControl
//   canRsvp,                                                  // gate the RSVP CTA on this
//   rsvp(attending?): Promise<RegistrationResult>,            // attending=false only for YES_AND_NO
//   submitting, confirmed, error }                            // confirmed: { kind: "rsvpConfirmed", status: "YES"|"NO"|"WAITLIST" }
// checkout() and rsvp() reject on refusal (sold out, sale ended, closed registration, payment
// method not configured, a missing mandatory answer) AND record .error as visitor copy — render
// it where the control is. Changing the selection clears a stale error.

// useEventConfirmation({ orderNumber, eventId }) →
// { event: EventDetail|null, order: OrderSummary|null, orderUnavailable, polling, loading }
// The order is polled every 2 s for up to 15 s until order.ticketsReady (Wix generates tickets
// after payment); show the PDF link only then.
```

### The listing component you create — skeleton

Hooks first, branches after (an early return above a hook changes hook order between renders and
React throws). The island renders on the server too (`client:load` SSRs), so nothing in a render
path may throw — render every state totally.

```tsx
// src/components/events/<YourListing>.tsx — YOU build it; events.astro mounts it (swap the import).
import { useEvents } from "../../hooks/events/useEvents";
import { imgAttrs } from "../../wix/media";
import type { EventSummary } from "../../wix/events/types";

export default function EventsIndex(props: { initialEvents?: EventSummary[]; initialTotal?: number }) {
  const { events, categories, activeCategoryId, setActiveCategoryId, hasMore, loadingMore, loadMore, error } = useEvents(props);
  // …you implement the render:
  //   • a filter row only when categories.length > 1 ("All" + one pill per category, the active
  //     one marked by activeCategoryId; setActiveCategoryId(null) clears)
  //   • error → a short inline message
  //   • events === null → skeleton tiles; [] → your honest empty state
  //   • else YOUR grid of YOUR tiles: image via <img {...imgAttrs(e.imageUrl, "(min-width: 1024px) 33vw, 50vw", 2 / 3)} alt={e.title} />
  //     (an empty imageUrl gives {} — render your placeholder then), dateLabel as the eyebrow,
  //     title WRAPPING (no truncate), locationType === "ONLINE" ? "Online" : locationName,
  //     priceLabel when non-empty, a sold-out badge from e.soldOut; the tile links to `/events/${encodeURIComponent(e.slug)}`
  //   • hasMore → a "Load more" button calling loadMore(), disabled while loadingMore
}
```

The event page is the shipped `pages/events/[slug].astro`: keep its frontmatter and SEO pieces
and redesign the markup between them; the registration column stays
`<EventRegistrationView client:only="react" event={event} />`; the "other dates" list comes from
`fetchOccurrences(event.recurringCategoryId)` in the frontmatter (already there). Home:
`fetchEvents({ limit: 3 })` in frontmatter → your cards.

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state
machines behind the hooks do arrive — `wix/events/events-store.ts`, `registration-store.ts`,
`order-store.ts` — so you never rewrite them: create a store per surface, `subscribe`, render from
`getState()`, call its actions. Their `*State` interfaces are the render contract; read those. What
you write is the rendering — index, event page, tier picker, RSVP form, confirmation — and for that
read these first; they are tested code for exactly that behaviour:

1. `components/events/EventRegistrationView.tsx` — the branch on the registration state
   (`registrationClosed` → sold out vs closed; `SCHEDULED_RSVP` → "opens <label>";
   `registrationPaused`) then on `registrationType`; the stepper per tier or per pricing option
   (disabled at 0, at `limitPerCheckout`, and when `!available`), the amount input on a GUEST
   tier, the "Sold out" / "Sale ended" badges and the "Goes on sale" / "Sale ends" lines, the
   `notes` under each price, the `totals` block; the CTA gated by `canCheckout` / `canRsvp` and
   `submitting`; `error` rendered beside the control; the organizer's form rendered control by
   control (text, textarea, select, radio, checkbox, date; the guest count select and one name
   input per guest); the waitlist-only and members-only copy; the confirmed vs waitlisted vs
   declined copy.
2. `components/events/EventConfirmationView.tsx` — the honest "no order" state on a direct visit;
   the order's status, invoice lines and ticket download once `ticketsReady`; the event fetched by
   `eventId` for context; the calendar links; the confirmation without details when
   `orderUnavailable`.
3. `components/events/EventsView.tsx` — the filter pills, the skeleton grid, the empty state, the
   card's fields in order, the load-more control.

All under `templates/events/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   existing layout instead if another vertical is deployed).
2. Write your listing component under `src/components/events/` (a new name — don't overwrite the
   references) and swap the import in `pages/events.astro` (`client:load` with the SSR props
   `initialEvents` + `initialTotal`). Redesign the markup of `pages/events/[slug].astro` around
   the shipped registration island (`client:only="react"`). Keep `pages/event-confirmation.astro`'s
   route.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs events --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts` (the
visitor client, configured with the public client id), `media.ts`, `money.ts`, and `wix/events/`
— `events.ts`, `registration.ts`, `orders.ts`, `types.ts`, the `*-core.ts` rules, and the three
stores `events-store.ts`, `registration-store.ts`, `order-store.ts`. None of it is React. The hooks
and components don't ship on this stack; the stores replace the hooks, and you write the components
in your framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createEventsStore({ initialEvents?, initialTotal? })` per
  listing (`start()` when mounted, `stop()` when unmounted), `createRegistrationStore(event)` per
  event page, `createOrderStore({ orderNumber, eventId })` on the confirmation page. State in,
  actions out — exactly the hooks' contracts above;
- your tier picker, RSVP form, and confirmation to the reference files above.

Routes `/events`, `/events/:slug` (via `fetchEventBySlug`, null → your 404), `/event-confirmation`
(the checkout callbacks point at it); dev server on 4321; a static build goes through
`npx @wix/cli@latest release` with `site.outputDirectory` pointing at the build folder, an SSR
build is hosted by you. Page title and description from the event's `title` / `shortDescription`.

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs events --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM,
the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` —
pages, styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project
root (config, plan, seed output) is never the upload. Same function names and DTOs as the table
above, so the contracts on this page hold unchanged: `fetchEventsPage`, `fetchEvents`,
`fetchEventBySlug`, `fetchEventById`, `fetchOccurrences`, `fetchCategories` from
`./js/wix/events.js`; `fetchTicketTiers`, `startTicketCheckout`, `submitRsvp` from
`./js/wix/registration.js`; `fetchOrder` from `./js/wix/orders.js`. The state machines ship too:
`createEventsStore` from `./js/wix/events-store.js` (`start()` once the page is up;
`setActiveCategoryId`, `loadMore`), `createRegistrationStore` from
`./js/wix/registration-store.js`, and `createOrderStore` from `./js/wix/order-store.js`. No
components ship — you write the rendering in plain JS: one render function per surface that reads
`getState()`, called from `subscribe`, with the surface's controls calling the store's actions.
Pages are `events.html`, `event.html?slug=…`, `event-confirmation.html` — Wix static hosting
serves files, not directories, so the hosted checkout must return to those files: create the
registration store with its paths, `createRegistrationStore(event, { paths: { confirmation:
"/event-confirmation.html", event: "/event.html?slug=" + encodeURIComponent(event.slug) } })` (Wix
appends `?orderNumber=&eventId=` to the confirmation URL; read them there into
`createOrderStore`). Set `document.title` and the meta description from `title` /
`shortDescription` once the event loads. The visitor token persists in `localStorage` on its own;
never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs events --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **Reads on the
server:** port `js/wix/events.ts` and `events-core.ts` to your language — the same functions
returning the same DTO shapes as dicts, one anonymous visitor token per process for these public
reads (mint and refresh per `client.ts`); the query body is literal (`filter.status $in
UPCOMING/STARTED`, `sort dateAndTimeSettings.startDate ASC, createdDate DESC`, a positive
`paging.limit` and `paging.offset`, the `fields` array — a body without the limit answers
`total: N, events: []` with no error) — and render the index and the event page in your templates
to the contracts above, so titles and dates are in the HTML. **Registering in the browser:** the
tier picker and the RSVP form on `./js/wix/registration-store.js` (pass the rendered `EventDetail`
as JSON in a script tag, plus the `paths` your routes use), the confirmation page on
`./js/wix/order-store.js` — exactly as the static wiring above; the browser owns the visitor's
token, so the server never handles per-visitor tokens. Routes stay `/events`, `/events/<slug>`,
`/event-confirmation`. Add your public https origin to the OAuth app's allowed domains before
checkout can return.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the reads, run at build time with one anonymous token; the generator emits every event page
(a URL generator over `fetchEvents({ limit })` — raise `limit` or page with `offset` past 20).
Run `deploy.mjs events --stack static --out <build dir>` so `js/wix/` is inside the output the
pages import from, point `site.outputDirectory` at that folder, `wix release`. Pages sit at
different depths (`/`, `/events/…`): give the templates one base path to `js/wix/` (a template
variable, or root-relative `/js/wix/…`), never a relative `./js/wix/` — it breaks one level down.
The frozen index is the first paint; the category filter still runs client-side on it through
`createEventsStore({ initialEvents })`. Registration runs in the browser as above. Close with the
live URL, the rebuild + release command, and one line for the owner: dashboard edits to events
reach the site when that command runs; registration is live regardless.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite config
plugins — deploy already added the dep). Routes: `/events` → your listing; `/events/:slug` →
`fetchEventBySlug(slug)` client-side (null → your 404 view), then your event page with the shipped
`EventRegistrationView`; `/event-confirmation` → the shipped `EventConfirmationView` (the checkout
callbacks point at that path). Deploy wrote the public client id into `wix/config.ts`; nothing
else to configure.

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded directly — hash routes, or one HTML file per route, decided before the first route is written; any URL handed to Wix as a return target must be one the host serves (SKILL.md step 1).

## Hard rules

- **Registration logic only through the shipped exports** — `useEventRegistration` /
  `createRegistrationStore` / `startTicketCheckout` / `submitRsvp` own the sequence
  (visitor-public tier read, reserve with the line items' `ticketInfo`,
  `createRedirectSession({ eventsCheckout })`, rsvpV2 with the organizer's form). Never re-derive
  any of it, never hand-build a checkout/ticket-form URL, never route it through an API route or
  elevate — the whole flow runs client-side as the visitor.
- **Branch on the registration state, then the type** — `registrationClosed` (sold out vs
  closed), `registrationStatus === "SCHEDULED_RSVP"` (opens at `registrationOpensAtLabel`),
  `registrationPaused`; then `registrationType`: never render an RSVP event with a ticket picker
  or a ticketed event with an RSVP form. Where the shipped components deploy that is
  `EventRegistrationView`.
- **The RSVP form is the organizer's** — render `rsvpForm.controls` (every control, its inputs
  by `name`, `mandatory` marked, `options` as the only choices) and `guestControl`; never
  hardcode the fields or drop a control: Create RSVP rejects a missing mandatory answer or an
  unknown input (`INVALID_FORM_RESPONSE`). The built-in name and email inputs are part of the form.
- **Gate CTAs on `canCheckout` / `canRsvp`** and surface `error` — `checkout()`/`rsvp()` can
  reject (sold out, sale ended, closed, payment method not configured, a missing answer); the
  message is for the visitor.
- **Confirmed states reflect REAL success**: RSVP → render only from `confirmed` (and say
  "waitlisted", not "confirmed", for status `WAITLIST`; a `waitlistOnly` event's CTA says "join
  the waitlist"). Tickets → the only success surface is `/event-confirmation` with Wix's
  `?orderNumber=` params; a visitor merely returning to the event page is NOT a success signal.
  Order details render only from the fetched `order`; when it is unavailable the page still
  confirms and says the tickets arrive by email.
- **Prices and labels come from the DTOs as-is** — `priceLabel`, `TicketTier.price`, `notes`,
  `totals`, `OrderSummary` amounts; no arithmetic of your own, no currency symbols of your own.
  `totals` mirrors Wix's own picker; the hosted checkout is what actually charges.
- **Dates in the event's zone** — `dateLabel`, `saleStartsLabel`, `registrationOpensAtLabel` are
  already; anything you format from `startDateIso` passes `timeZone: event.timeZoneId`.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens — one design system across shipped and written
  code. Where they don't (`lib`, `static`, a port): style with whatever your stack does well, on
  one token set of your own.
- Live data or an honest empty state — never mock events, tiers, or "X spots left".
- Keep the event page's SEO pieces exactly as shipped (Astro).
- **Call every hook before any conditional return.** Hooks first, branches after.
- **Browsing and registering need no login.** They run on the visitor session the shipped client
  already holds; don't gate events behind sign-in unless the brief asks for accounts. A
  `membersOnly` event is the exception Wix itself imposes — the shipped form says so; a login
  flow is the members vertical's job, not yours to improvise here.

### Visitor-scope reads that can be refused

Two reads run in the browser on the visitor token exactly as Wix's own headless demo does, but Wix
doesn't guarantee them for every site's visitor scope, so the shipped code degrades instead of
failing: `fetchCategories` (Query Categories) — when refused, the pills come from the categories on
the loaded events; `fetchOrder` (Get Order on the confirmation page) — when refused,
`orderUnavailable` is set and the page confirms without invoice lines or the PDF link (the
confirmation email carries them). Never elevate or proxy either through a server route to "fix" it.

## Point the user to their dashboard

Give the owner the dashboard link plus the Events page — the deploy step's JSON printed
`dashboardUrl`; append `/events` for event management. **Selling paid tickets needs a connected
payment method and a premium plan** (free/RSVP events work without) — until then `checkout()` surfaces
"Ticket sales aren't switched on yet" and hosted checkout says "We can't accept online payments."
Hand both links in the close: Accept payments `{dashboardUrl}/wix-cashier/payments` and Upgrade the
plan `https://www.wix.com/upgrade/website?metaSiteId={siteId}`; don't treat it as a code failure. The
organizer's tax settings, fee type, ticket limits, RSVP form fields and guest control are all
dashboard settings the site renders as-is.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-events.mjs` from the project root. Seed
events that exercise the UI (a ticketed event with 2 tiers, another ticketed one, a free RSVP
event; future dates; an image per event) unless the brief says otherwise.
