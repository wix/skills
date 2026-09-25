# Bookings — playbook

The booking machinery ships as files — services reads, availability (appointment AND class),
the schema-driven booking form, and the exact `createBooking → cart → checkout-or-place`
sequence, typed end-to-end. **The presentation is yours**: you design and implement the
service card, the listing surface, and the booking surface on the shipped hooks/DTOs, plus
the home page and the brand. You never write booking logic; you never skip designing.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the two
pages' island imports. Files you **create**: your listing and booking components, plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(s.imageUrl, "33vw")} alt={s.name} />`; `imgSrc()` / `imgSrcSet()` / `formatMoney()` underneath |
| `wix/bookings/types.ts` | the DTOs (`ServiceSummary`, `ServiceDetail`, `BookingCategory`, `Slot`, `BookingFormField`, `BookingResult`) — contracts below |
| `wix/bookings/services.ts` | `fetchServices`, `fetchServiceBySlug`, `fetchBookingCategories` — the transport; the rules and DTO mappers are in `services-core.ts` beside it (shared with the REST layer) |
| `wix/bookings/booking.ts` | `fetchSlots`, `fetchBookingForm`, `bookService` — the transport; the request bodies, the slot and form mappers, and the checkout-or-place rule are in `booking-core.ts` beside it (shared with the REST layer) |
| `wix/bookings/services-store.ts` · `booking-flow-store.ts` | the listing and booking state machines, framework-free (`createServicesStore()`, `createBookingFlowStore(service)` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/bookings/useServices.ts` | React binding of `services-store.ts`: listing + category filter — contract below |
| `hooks/bookings/useBookingFlow.ts` | React binding of `booking-flow-store.ts`: the whole booking state machine — contract below |
| `components/bookings/ServicesView.tsx` (+ `ServiceCard`) · `ServiceBookingView.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If storefront is also deployed, its layout won — add a Services nav link there |
| `pages/services.astro` | SSR listing — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/services/[slug].astro` | SSR detail + booking with owner-editable SEO — **keep the frontmatter and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly; swap the island import. The booking island stays `client:only="react"` (availability is timezone-specific) |

## What you build — the design job

1. **The service card + listing surface** — your tile (image, type badge, duration/price
   presentation) and rhythm, with skeletons while loading and an honest empty state — on
   `useServices`.
2. **The booking surface** — day-grouped slot picking, week paging, staff filter (only when
   >1 staff), the schema-driven form, the book CTA (label free vs priced), and the confirmed
   state — on `useBookingFlow`, which owns ALL booking logic; you own how it looks.
3. **The home page** — hero, featured services (fetch in frontmatter → your components),
   brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens.

### What a complete booking site shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins where it differs. Look at the
services before designing (appointments vs classes, categories, staff, prices, images) and design
for this business, not a stereotype of its category. Then, by default:

- **Home:** what the business offers and one booking action in the first screen; real services
  under truthful headings; not a repeat of the listing.
- **Listing:** a real service card — image, name, duration and price, link — in the first screen;
  category pills only when there is more than one category; `services === null` → skeleton tiles,
  `[]` → your honest empty state.
- **Service page:** name, price, and the first bookable day's times in the first screen **at 390px
  wide too** — the image is a bounded band on a phone, not a full-screen hero; week paging beside
  the times; the staff filter only when `service.staff.length > 1`; the form under the times, the
  CTA under the form with its label from `service.free` / `service.price`; a week with no times says
  so and points to the next one.
- **Confirmed state:** rendered only from `confirmed`; a visitor returning from the hosted checkout
  is not a success signal.
- **A slug that resolves to nothing** shows only the not-found state — no heading or empty picker
  rendered around it.
- **Copy:** nothing the owner didn't supply — no invented reviews, availability pressure, or
  guarantees; no Wix IDs or technical words in visible text.

### The contracts your components consume

Everything you need to build on the shipped code; read the source only when something is off.

```ts
// ServiceSummary (tiles) — display-ready:
// { id, slug, name, tagLine, type: "APPOINTMENT"|"CLASS", price /* "€75.00" | "Free" */,
//   free, durationMinutes|null, imageUrl /* https or "" */, categoryId|null, staff: [{id,name}] }
// ServiceDetail adds: description, formId, paymentOption, cancellationFeeEnabled.
// BookingCategory = { id, name }.

// useServices({ initialServices?, initialCategories? }) →
// { services: ServiceSummary[]|null /* null = loading → skeletons */,
//   categories: BookingCategory[], activeCategoryId, setActiveCategoryId(id|null), error }
// Category filtering is client-side (a bookings catalog is small and fully fetched).

// useBookingFlow(service: ServiceDetail) →
// { days: [{ dayKey, dayLabel, slots: Slot[] }] | null,   // day-grouped; null = loading
//   windowStart, nextWeek(), prevWeek(),                  // 7-day paging (prev clamps to today)
//   staffId, setStaffId(id|undefined),                    // show a picker only when service.staff.length > 1
//   selectedSlot, setSelectedSlot(slot|null),             // Slot = { startLocal, endLocal, dayKey, label, scheduleId|null, eventId|null, staff }
//   formFields: [{ target, label, type, options? }],      // never empty (contact-basics fallback)
//   values, setValue(target, value),                      // inputs write here, keyed by target
//   canBook,                                              // gate the CTA on this
//   book(): Promise<BookingResult>,                       // paid → the browser navigates to the Wix checkout;
//   booking, confirmed, error }                           // free/offline → confirmed is set (REAL success)
// A window or staff change clears selectedSlot and sets days to null while the new week loads.
// book() rejects on refusal (slot taken, invalid form) AND records .error — render it beside the CTA.
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state machines
behind the hooks do arrive — `wix/bookings/services-store.ts`, `booking-flow-store.ts` — so you
never rewrite them: create a store per surface, `subscribe`, render from `getState()`, call its
actions. Their `ServicesState` / `BookingFlowState` interfaces are the render contract; read those.
What you write is the rendering — tiles, the slot picker, the form, the CTA — and for that read
these first; they are tested code for exactly that behaviour:

1. `components/bookings/ServiceBookingView.tsx` — the booking surface as working code: day
   groups with slot chips, week paging controls, the staff filter only when there is more than one
   staff member, one input per `formFields` entry typed from its `type` (a `<select>` when it has
   `options`), the CTA disabled until `canBook`, labelled free vs priced, `error` inline, and the
   confirmed state rendered only from `confirmed`.
2. `components/bookings/ServicesView.tsx` — category pills only when `categories.length > 1`,
   skeleton tiles while `services === null`, the honest empty state, and `ServiceCard`: image with
   the type badge, name, tagLine, "duration · price".

All under `references/bookings/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   storefront layout instead if both verticals are deployed).
2. Write your components under `src/components/bookings/` (new names — don't overwrite the
   references), swap the island imports in `pages/services.astro` and
   `pages/services/[slug].astro`. Listing island: `client:load` with the SSR props; booking
   island: `client:only="react"`. **Author your surfaces in as few messages as possible** —
   batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs bookings --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts`
(the visitor client, configured with the public client id), `media.ts`, `money.ts`, and
`wix/bookings/` — `services.ts`, `booking.ts`, `types.ts`, the `*-core.ts` rules, and the two
stores `services-store.ts`, `booking-flow-store.ts`. None of it is React. The hooks and components
don't ship on this stack; the stores replace the hooks, and you write the components in your
framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createServicesStore(options)` per listing (`start()` when
  mounted, `stop()` when unmounted), `createBookingFlowStore(service)` per booking surface (the
  `ServiceDetail` from `fetchServiceBySlug`; `start()` in the browser only — availability is
  timezone-specific). State in, actions out — exactly the hooks' contracts above;
- your tiles, slot picker, form, and CTA to the defaults in "What a complete booking site shows" —
  the shipped `ServiceBookingView.tsx` and `ServicesView.tsx` are readable as behaviour specs.

Routes `/services`, `/services/:slug` (via `fetchServiceBySlug`, null → your 404); dev server on
4321; a static build goes through `npx @wix/cli@latest release` with `site.outputDirectory`
pointing at the build folder, an SSR build is hosted by you. Service-page tags from the
`ServiceDetail` (name, tagLine, description).

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs bookings --stack static --out site` put the REST layer in `site/js/wix/` (browser
ESM, the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` —
pages, styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project
root (config, plan, seed output) is never the upload. Same function names and DTOs as the table
above, so the contracts on this page hold unchanged: `fetchServices`, `fetchServiceBySlug`,
`fetchBookingCategories` from `./js/wix/services.js`; `fetchSlots`, `fetchBookingForm`,
`bookService` from `./js/wix/booking.js`. The state machines ship too: `createServicesStore` from
`./js/wix/services-store.js` (the listing — `start()` once the page is up, `setActiveCategoryId`)
and `createBookingFlowStore(service)` from `./js/wix/booking-flow-store.js` (the booking surface —
`fetchServiceBySlug(slug)` first, then the store: days, week paging, staff filter, `formFields`,
`setValue`, `canBook`, `book()`). No components ship — you write the rendering in plain JS: one
render function per surface that reads `getState()`, called from `subscribe`, with the surface's
controls calling the store's actions. `book()` navigates the full document to the hosted checkout
for a paid service on its own (`window.location.origin` must be on the OAuth app's allowed domains
so checkout can return); for a free or pay-in-person service it sets `confirmed`. Pages are
`services.html` and `service.html?slug=…` (Wix static hosting serves files, not directories — name
the file and link to it). Set `document.title` and the meta description from the `ServiceDetail`
once it loads. The visitor token persists in `localStorage` on its own; never mint per page.
`npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs bookings --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **Reads on the
server:** port `js/wix/services.ts` and `services-core.ts` to your language — the same three
functions returning the same DTO shapes as dicts, one anonymous visitor token per process for these
public reads (mint and refresh per `client.ts`) — and render the listing and the service page in
your templates to the contracts above, so service names and prices are in the HTML; page tags from
the `ServiceDetail`. **Booking in the browser:** the booking surface on
`./js/wix/booking-flow-store.js` with the rendered `ServiceDetail` (a JSON script tag, or
`fetchServiceBySlug(slug)` from `./js/wix/services.js`), exactly as the static wiring above — the
browser owns the visitor's token, so the server never handles per-visitor tokens, and the booking,
its cart, and the checkout redirect are the visitor's. Routes stay `/services`, `/services/<slug>`.
Add your public https origin to the OAuth app's allowed domains before checkout can return.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the reads, run at build time with one anonymous token; the generator must emit a page for every
slug `fetchServices()` returns. Run `deploy.mjs bookings --stack static --out <build dir>` so
`js/wix/` is inside the output the pages import from, point `site.outputDirectory` at that folder,
`wix release`. Pages sit at different depths (`/`, `/services/…`): give the templates one base path
to `js/wix/` (a template variable, or root-relative `/js/wix/…`), never a relative `./js/wix/` — it
breaks one level down. The frozen listing is the first paint; availability and booking still run
client-side on the service page through `createBookingFlowStore()` from
`./js/wix/booking-flow-store.js`, exactly as on a static site, so the booking contract above
applies. Close with the live URL, the rebuild + release command, and one line for the owner:
dashboard edits to services reach the site when that command runs; availability and booking are
live regardless.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/services` → your listing; `/services/:slug` →
fetch with `fetchServiceBySlug(slug)` client-side, then your booking surface on
`useBookingFlow(service)`. Deploy wrote the public client id into `wix/config.ts`; nothing else
to configure.

## Hard rules

- **Booking logic only through the shipped exports** — `useBookingFlow`/`bookService` own the
  sequence (createBooking → cart holds the seat → checkout-or-place), the payment-option
  derivation, ANY_RESOURCE, and the formSubmission shape. Never re-derive any of it, never
  call `confirmBooking`, never hand-build a checkout URL.
- **The form is schema-driven** — render `formFields` as given (values keyed by `target`);
  never hardcode field names beyond what the fallback already guarantees.
- **Gate the CTA on `canBook`** and surface `error` — `book()` can reject (slot taken,
  validation); that message is for the visitor.
- **The confirmed state must reflect REAL success**: render it only from `confirmed` (set by
  the free/offline branch). A visitor returning from the hosted checkout redirect is NOT a
  success signal — don't fake a confirmation page off the return URL.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens — one design system across shipped and written
  code. No parallel theme files, no hardcoded palette values. Where they don't (`lib`, `static`, a
  port): style with whatever your stack does well, on one token set of your own; the rule that
  survives is the token set, not Tailwind.
- Live data or an honest empty state — never mock services, slots, or availability.
- Keep the detail page's SEO pieces exactly as shipped (Astro).
- **Browsing and booking need no login.** They run on the Wix visitor session the shipped client
  already holds; don't gate services or booking behind sign-in unless the brief asks for accounts.
- **Call every hook before any conditional return.** Hooks first, branches after.

## Point the user to their dashboard

Give the owner the dashboard link plus the Bookings services/calendar pages — the deploy
step's JSON printed `dashboardUrl`; append `/bookings/services` for service management.
Taking real online payments needs a premium plan + a connected payment method — mention it.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-bookings.mjs` from the project root.
Seed services that exercise the UI (an APPOINTMENT with duration+price, a free one, a CLASS
with future sessions when it fits the business; an image per service).
