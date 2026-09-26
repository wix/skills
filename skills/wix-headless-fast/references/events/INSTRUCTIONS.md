# Events — playbook

The events machinery ships as files — event reads (list, by slug, by id), the visitor-public
ticket-tier read, the exact `reserve → hosted-checkout redirect` sequence, RSVP, the registration
controls, and the SEO plumbing, typed end-to-end. **The presentation doesn't ship — you build it**
on the shipped hooks/DTOs: the event card and the events index, the event page's layout, the home
page, and the brand. You never write registration logic; you never skip designing.

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
| `wix/events/types.ts` | the DTOs (`EventSummary`, `EventDetail`, `TicketTier`, `RegistrationResult`) — contracts inlined below |
| `wix/events/events.ts` | `fetchEvents` (live events, soonest first), `fetchEventBySlug`, `fetchEventById` (the post-checkout confirmation read) — the transport; the rules and DTO mappers are in `events-core.ts` beside it (shared with the REST layer) |
| `wix/events/registration.ts` | `fetchTicketTiers`, `startTicketCheckout`, `submitRsvp` — the exact reserve→redirect sequence and the RSVP body; rules in `registration-core.ts` beside it |
| `wix/events/events-store.ts` · `registration-store.ts` | the listing and registration state machines, framework-free (`createEventsStore()`, `createRegistrationStore(event)` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/events/useEvents.ts` | React binding of `events-store.ts`: listing + category filter — contract below |
| `hooks/events/useEventRegistration.ts` | React binding of `registration-store.ts`: tiers, quantities, checkout, the RSVP form — contract below |
| `components/events/EventRegistrationView.tsx` | the registration controls for one event — branches on `registrationType` (tier picker with clamped steppers and the gated CTA; the three-field RSVP form with its confirmed / waitlisted / declined states; the external link; the honest closed state) — **wire as-is** in your event page's registration column (`<EventRegistrationView client:only="react" event={event} />`); build your own on `useEventRegistration` only when the brief wants more |
| `components/events/EventConfirmationView.tsx` | the hosted checkout's thank-you island — reads `?orderNumber=&eventId=`, echoes the order number, fetches the event for context, an honest "no order" state on a direct visit — **wire as-is** |
| `components/events/EventsView.tsx` (+ `EventCard`) | **reference** listing — correct and plain; the shipped `events.astro` mounts it so the site works before you design; you build your own on `useEvents` and swap the import |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — shared across verticals). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | the site chrome — **yours to brand** (keep the `seo-tags` slot + the global.css import). If another vertical is also deployed, its layout won — add an Events nav link there |
| `pages/events.astro` | SSR listing — **keep the frontmatter**, swap the island import to YOUR listing component |
| `pages/events/[slug].astro` | SSR event page with owner-editable SEO — **keep the frontmatter and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly; the markup between them is yours to redesign around the shipped registration island (`client:only="react"`) |
| `pages/event-confirmation.astro` | the hosted checkout's thank-you landing (`?orderNumber=&eventId=`) — **keep the route**; the shipped checkout callbacks point at it |

## What you build — the design job

1. **The event card + events index** — your tile (image, date eyebrow, title, venue/online,
   price-from, sold-out badge) and rhythm, the category filter (only when >1 category),
   skeletons while loading, an honest empty state — on `useEvents`.
2. **The event page's layout** — hero image, date, venue, about, with the shipped
   `EventRegistrationView` as the registration column; design the page for the brand (an
   editorial split, a sticky registration column, a full-bleed hero). Registration logic never
   leaves the shipped component and hook.
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
  category filter only when the events carry more than one category; `events === null` →
  skeletons, `[]` → an honest empty state; `error` → a short inline message.
- **Event page:** image, date, title, venue and the registration control in the first screen at
  390px wide too — a bounded image band on a phone (`max-h-[45vh]`), the registration column
  under it, the two-column split from `md`; `aboutParagraphs` after the registration control,
  never between the date and the action; `addToCalendar.google` as a link when present.
- **Registration:** the shipped `EventRegistrationView` — `TICKETING` shows the tier picker,
  `RSVP` the three-field form, `EXTERNAL` the link out, closed or `NONE` the closed state;
  confirmed and waitlisted read differently.
- **Confirmation:** `/event-confirmation` — the shipped island; the only success surface for a
  ticket order.
- **Copy:** nothing the organizer didn't supply — no invented "X spots left", no fake urgency, no
  Wix IDs in visible text.

### The contracts your components consume (everything you need — read the source when something is off)

```ts
// EventSummary (tiles) — display-ready:
// { id, slug, title, shortDescription /* plain text */, dateLabel /* "6 November 2026, 19:30–23:00 GMT-8" */,
//   startDateIso, locationName, locationType: "VENUE"|"ONLINE"|"TBD", imageUrl,
//   registrationType: "RSVP"|"TICKETING"|"EXTERNAL"|"NONE",
//   priceLabel /* "From €45" | "Free" | "" */, soldOut, categories: [{ id, name }] }
// EventDetail adds: aboutParagraphs: string[], registrationOpen, rsvpResponseType: "YES_ONLY"|"YES_AND_NO",
//   externalUrl, addToCalendar: { google, ics }.
// TicketTier: { id, name, description, price /* "€45.00" | "Free" */, free,
//   limitPerCheckout, saleStatus /* only "SALE_STARTED" is buyable */ }

// useEvents({ initialEvents? }) →
// { events: EventSummary[]|null /* null = loading → skeletons */,
//   categories: [{ id, name }] /* derived from the loaded events */,
//   activeCategoryId, setActiveCategoryId(id|null), error }
// Only UPCOMING/STARTED events arrive, soonest first — a past event is never listed or linked.

// useEventRegistration(event: EventDetail) →
// { tiers: TicketTier[]|null,                    // TICKETING only; null = loading
//   quantities, setQuantity(tierId, qty),        // clamped 0..limitPerCheckout; ignored for tiers not on sale
//   ticketCount, canCheckout,                    // gate the tickets CTA on canCheckout
//   checkout(): Promise<RegistrationResult>,     // reserve → the browser redirects to Wix checkout
//   rsvpValues, setRsvpValue(field, value),      // built-in fields: firstName/lastName/email
//   canRsvp,                                     // gate the RSVP CTA on this
//   rsvp(attending?): Promise<RegistrationResult>, // attending=false only for YES_AND_NO
//   submitting, confirmed, error }               // confirmed: { kind: "rsvpConfirmed", status: "YES"|"NO"|"WAITLIST" }
// checkout() and rsvp() reject on refusal (sold out, sale ended, closed registration, payment
// method not configured) AND record .error — render it where the control is.
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

export default function EventsIndex(props: { initialEvents?: EventSummary[] }) {
  const { events, categories, activeCategoryId, setActiveCategoryId, error } = useEvents(props);
  // …you implement the render:
  //   • a filter row only when categories.length > 1 ("All" + one pill per category, the active
  //     one marked by activeCategoryId; setActiveCategoryId(null) clears)
  //   • error → a short inline message
  //   • events === null → skeleton tiles; [] → your honest empty state
  //   • else YOUR grid of YOUR tiles: image via <img {...imgAttrs(e.imageUrl, "(min-width: 1024px) 33vw, 50vw", 2 / 3)} alt={e.title} />
  //     (an empty imageUrl gives {} — render your placeholder then), dateLabel as the eyebrow,
  //     title WRAPPING (no truncate), locationType === "ONLINE" ? "Online" : locationName,
  //     priceLabel when non-empty, a sold-out badge from e.soldOut; the tile links to `/events/${e.slug}`
}
```

The event page is the shipped `pages/events/[slug].astro`: keep its frontmatter and SEO pieces
and redesign the markup between them; the registration column stays
`<EventRegistrationView client:only="react" event={event} />`. Home: `fetchEvents({ limit: 3 })`
in frontmatter → your cards.

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state
machines behind the hooks do arrive — `wix/events/events-store.ts`, `registration-store.ts` — so
you never rewrite them: create a store per surface, `subscribe`, render from `getState()`, call
its actions. Their `*State` interfaces are the render contract; read those. What you write is the
rendering — index, event page, tier picker, RSVP form, confirmation — and for that read these
first; they are tested code for exactly that behaviour:

1. `components/events/EventRegistrationView.tsx` — the branch on `registrationType`; the stepper
   pair per tier (disabled at 0 and at `limitPerCheckout`, both disabled when the tier isn't on
   sale, with the "Sale hasn't started" / "Sale ended" line); the CTA gated by `canCheckout` /
   `canRsvp` and `submitting`; `error` rendered beside the control; the confirmed vs waitlisted vs
   declined copy; the closed state distinguishing sold out from closed.
2. `components/events/EventConfirmationView.tsx` — the honest "no order" state on a direct visit;
   the order number echoed, never invented order details; the event fetched by `eventId` for
   context; the calendar link.
3. `components/events/EventsView.tsx` — the filter pills, the skeleton grid, the empty state, the
   card's fields in order.

All under `references/events/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   existing layout instead if another vertical is deployed).
2. Write your listing component under `src/components/events/` (a new name — don't overwrite the
   references) and swap the import in `pages/events.astro` (`client:load` with the SSR props).
   Redesign the markup of `pages/events/[slug].astro` around the shipped registration island
   (`client:only="react"`). Keep `pages/event-confirmation.astro`'s route.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs events --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts` (the
visitor client, configured with the public client id), `media.ts`, `money.ts`, and `wix/events/`
— `events.ts`, `registration.ts`, `types.ts`, the `*-core.ts` rules, and the two stores
`events-store.ts`, `registration-store.ts`. None of it is React. The hooks and components don't
ship on this stack; the stores replace the hooks, and you write the components in your framework
to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createEventsStore({ initialEvents? })` per listing
  (`start()` when mounted, `stop()` when unmounted), `createRegistrationStore(event)` per event
  page. State in, actions out — exactly the hooks' contracts above;
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
above, so the contracts on this page hold unchanged: `fetchEvents`, `fetchEventBySlug`,
`fetchEventById` from `./js/wix/events.js`; `fetchTicketTiers`, `startTicketCheckout`, `submitRsvp`
from `./js/wix/registration.js`. The state machines ship too: `createEventsStore` from
`./js/wix/events-store.js` (`start()` once the page is up; `setActiveCategoryId`) and
`createRegistrationStore` from `./js/wix/registration-store.js`. No components ship — you write the
rendering in plain JS: one render function per surface that reads `getState()`, called from
`subscribe`, with the surface's controls calling the store's actions. Pages are `events.html`,
`event.html?slug=…`, `event-confirmation.html` — Wix static hosting serves files, not
directories, so the hosted checkout must return to those files: create the registration store
with its paths, `createRegistrationStore(event, { paths: { confirmation: "/event-confirmation.html",
event: "/event.html?slug=" + event.slug } })` (Wix appends `?orderNumber=&eventId=` to the
confirmation URL; read them there and `fetchEventById`). Set `document.title` and the meta
description from `title` / `shortDescription` once the event loads. The visitor token persists in
`localStorage` on its own; never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs events --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **Reads on the
server:** port `js/wix/events.ts` and `events-core.ts` to your language — the same three functions
returning the same DTO shapes as dicts, one anonymous visitor token per process for these public
reads (mint and refresh per `client.ts`); the query body is literal (`filter.status $in
UPCOMING/STARTED`, `sort dateAndTimeSettings.startDate ASC`, a positive `paging.limit`, the
`fields` array — a body without the limit answers `total: N, events: []` with no error) — and
render the index and the event page in your templates to the contracts above, so titles and
dates are in the HTML. **Registering in the browser:** the tier picker and the RSVP form on
`./js/wix/registration-store.js` (pass the rendered `EventDetail` as JSON in a script tag, plus
the `paths` your routes use), the confirmation page on `./js/wix/events.js`'s `fetchEventById` —
exactly as the static wiring above; the browser owns the visitor's token, so the server never
handles per-visitor tokens. Routes stay `/events`, `/events/<slug>`, `/event-confirmation`. Add
your public https origin to the OAuth app's allowed domains before checkout can return.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the reads, run at build time with one anonymous token; the generator emits every event page
(a URL generator over `fetchEvents()` — the live list is small, but raise `limit` if it isn't).
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
  (visitor-public tier read, reserve, `createRedirectSession({ eventsCheckout })`, rsvpV2). Never
  re-derive any of it, never hand-build a checkout/ticket-form URL, never route it through an API
  route or elevate — the whole flow runs client-side as the visitor.
- **Branch on `registrationType`** — never render an RSVP event with a ticket picker or a
  ticketed event with an RSVP form; respect `registrationOpen`. Where the shipped components
  deploy that is `EventRegistrationView`.
- **The RSVP form is built-in** — exactly first name, last name, email; never fetch a form schema
  or add fields.
- **Gate CTAs on `canCheckout` / `canRsvp`** and surface `error` — `checkout()`/`rsvp()` can
  reject (sold out, sale ended, closed, payment method not configured); the message is for the
  visitor.
- **Confirmed states reflect REAL success**: RSVP → render only from `confirmed` (and say
  "waitlisted", not "confirmed", for status `WAITLIST`). Tickets → the only success surface is
  `/event-confirmation` with Wix's `?orderNumber=` params; a visitor merely returning to the event
  page is NOT a success signal.
- **Prices and labels come from the DTOs as-is** — `priceLabel`, `TicketTier.price`; no computed
  totals, no currency symbols of your own.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens — one design system across shipped and written
  code. Where they don't (`lib`, `static`, a port): style with whatever your stack does well, on
  one token set of your own.
- Live data or an honest empty state — never mock events, tiers, or "X spots left".
- Keep the event page's SEO pieces exactly as shipped (Astro).
- **Call every hook before any conditional return.** Hooks first, branches after.
- **Browsing and registering need no login.** They run on the visitor session the shipped client
  already holds; don't gate events behind sign-in unless the brief asks for accounts.

## Point the user to their dashboard

Give the owner the dashboard link plus the Events page — the deploy step's JSON printed
`dashboardUrl`; append `/events` for event management. **Selling paid tickets needs a premium plan
+ a connected payment method** (free/RSVP events work without) — until then `checkout()` surfaces
"Ticket sales aren't switched on yet"; mention it, don't treat it as a code failure.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-events.mjs` from the project root. Seed
events that exercise the UI (a ticketed event with 2 tiers, another ticketed one, a free RSVP
event; future dates; an image per event) unless the brief says otherwise.
