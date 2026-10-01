# Bookings — playbook

The booking machinery ships as files — services reads (paged, filtered by category and location),
availability (appointment AND class, with a course's seats and a class's sessions), the site's
display time zone, add-ons, the schema-driven booking form, and the exact `createBooking → cart →
checkout-or-place` sequence, typed end-to-end. **The presentation is yours**: you design and implement the
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
| `wix/bookings/types.ts` | the DTOs (`ServiceSummary`, `ServiceDetail`, `BookingCategory`, `LocationOption`, `Slot`, `Session`, `CourseAvailability`, `AddOnGroup`, `BookingFormField`, `BookingResult`) — contracts below |
| `wix/bookings/services.ts` | `fetchServices` (one page, filtered), `fetchServiceBySlug`, `fetchBookingCategories`, `fetchLocations` — the transport; the rules and DTO mappers (price by rate type, deposits, CTA state, locations) are in `services-core.ts` beside it (shared with the REST layer) |
| `wix/bookings/booking.ts` | `fetchSlots`, `fetchNextAvailableSlots`, `fetchBookingsSettings`, `fetchSessions`, `fetchOfferedDays`, `fetchCourseAvailability`, `fetchAddOnGroups`, `fetchBookingForm`, `bookService` — the transport; the request bodies, the slot/session/add-on mappers, and the checkout-or-place rule are in `booking-core.ts` beside it (shared with the REST layer) |
| `wix/bookings/services-store.ts` · `booking-flow-store.ts` | the listing and booking state machines, framework-free (`createServicesStore()`, `createBookingFlowStore(service)` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/bookings/useServices.ts` | React binding of `services-store.ts`: listing + category/location filters + paging — contract below |
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
2. **The booking surface** — slot picking one day at a time (a strip of the days that have
   availability, then that day's times bucketed into morning, afternoon and evening; full sessions
   disabled), week paging at the strip's ends with "next available", the time-zone line, staff
   filter (only when >1 staff), participants, deposit
   choice, add-ons, the schema-driven form, the CTA labelled from `ctaState`, and the confirmed
   state — or, for a course, its dates, seats, and one CTA — on `useBookingFlow`, which owns ALL
   booking logic; you own how it looks.
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
- **Listing:** a real service card — image, name, type badge (Appointment / Class / Course; "Online"
  when `conferencing`), `durationLabel` and the price line, link — in the first screen; the price
  line is `price` with "From " before it when `priceFrom`, `basePrice` struck through beside a
  discounted price, `discountName` when present, nothing when `price` is ""; classes/courses show
  `offeredDays` ("Mon, Wed") once loaded; category pills only when `categories.length > 1`, a
  location filter only when there is more than one option (`locations` + "Other locations" when
  `hasOtherLocations`); a "Load more" affordance while `hasMore`; `services === null` → skeleton
  tiles, `[]` → your honest empty state. A filter is a link: `/services?category=<id>`,
  `/services?location=<id>` (the store reads and writes them).
- **Service page (appointment / class):** name, price, and the first bookable day's times in the
  first screen **at 390px wide too** — the image is a bounded band on a phone, not a full-screen
  hero. **One day at a time:** a horizontal strip of the days in `days` (weekday and day number),
  the active day's slots under it bucketed into morning / afternoon / evening, and the week pagers
  at the strip's ends. Never list every day's times at once: a week of a busy calendar is well over a
  hundred chips and the form ends up below a wall of numbers. Switching day drops a slot chosen on
  another day. "Times in {timeZoneLabel}" once known, with a switch only when
  `customerCanChangeTimeZone`; the staff filter only when `service.staff.length > 1` (photos when
  `imageUrl`); a slot chip keyed by `slot.key`, disabled with "Full" when `!bookable` ("Full, waitlist"
  when `waitlistCapacity`), "N left" when `remainingCapacity` is small; a week with no times says so
  and offers `nextAvailable[0]` through `jumpTo(dayKey)` (`nextAvailable === null` → still looking,
  `[]` → none); a participants control only when `maxParticipants > 1`; the deposit / pay-in-full
  choice only when `service.deposit?.fullUpfrontAllowed`; add-on groups when `addOnGroups.length`,
  with their `addOnsTotal`; upcoming `sessions` for a class as a list (informational — booking is
  the slot); the form under the times, the CTA under the form.
- **Service page (course):** the same header, then `service.course` dates, the flow's `offeredDays`,
  `course.spotsLeft` ("Full" when `course.full`), the sessions list while it runs, the form, one CTA
  — there is no slot picker (`days` is `[]`); `ctaState === "viewCourse"` (full or ended) disables it.
- **CTA label:** from `ctaState` — "Book" / "Request to book" / disabled — then the money: "· deposit
  {deposit.amount}" when `payDeposit` and an amount is known, "— free" when `service.free`, else
  "· {price}" ("· from {price}" when `priceFrom`); nothing when `price` is "".
- **Confirmed state:** rendered only from `confirmed`; a visitor returning from the hosted checkout
  is not a success signal. Its copy follows `ctaState`: "You're booked" + "a confirmation email is
  on its way" for `book` (the booking sends email + SMS); "Request sent" + "you'll hear back once it's
  approved" for `requestToBook` — never promise a confirmed seat for a request.
- **A slug that resolves to nothing** shows only the not-found state — no heading or empty picker
  rendered around it.
- **Copy:** nothing the owner didn't supply — no invented reviews, availability pressure, or
  guarantees; no Wix IDs or technical words in visible text.

### The contracts your components consume

Everything you need to build on the shipped code; read the source only when something is off.

```ts
// ServiceSummary (tiles) — display-ready, every money value already a string ("" = unknown, omit it):
// { id, slug, name, tagLine, type: "APPOINTMENT"|"CLASS"|"COURSE",
//   rateType: "FIXED"|"VARIED"|"CUSTOM"|"NO_FEE"|"SUBSCRIPTION",
//   price /* "€75" | "From"-able "€30" | "Ask for a quote" | "Free" | "" */, priceFrom /* prefix "From " */,
//   basePrice /* struck-through pre-discount price or "" */, discountName, calculatedAtCheckout, hasPricingPlans,
//   free, durationMinutes|null, durationLabel /* "1 hr 30 min" | "" */, imageUrl /* https or "" */,
//   categoryId|null, categoryName, scheduleId|null,
//   staff: [{ id, name, imageUrl }], locations: [{ id|null, name, type: "BUSINESS"|"CUSTOM"|"CUSTOMER" }],
//   conferencing, hasAddOns, requiresManualApproval, onlineBookingEnabled, tooLateToBook,
//   ctaState: "book"|"requestToBook"|"viewCourse" /* from policy; the flow adds a course's fullness */,
//   defaultCapacity|null, maxParticipantsPerBooking|null,
//   deposit: { amount /* "€20" | "" (percentage) */, fullUpfrontAllowed } | null,
//   offeredDays: Weekday[] /* "MONDAY"… — classes/courses, filled by the listing store */ }
// ServiceDetail adds: description, formId, paymentOption, cancellationFeeEnabled,
//   course: { startDate|null, endDate|null, ended } | null   /* ISO instants; COURSE only */.
// BookingCategory = { id, name }.  LocationOption = { id, name }.

// useServices({ initialServices?, initialHasMore?, initialCategories?, initialLocations?,
//               initialCategoryId?, initialLocationId?, pageSize? = 20, syncUrl? = true }) →
// { services: ServiceSummary[]|null /* null = loading → skeletons */, hasMore, loadingMore, loadMore(),
//   categories, activeCategoryId, setActiveCategoryId(id|null),
//   locations: LocationOption[], hasOtherLocations, activeLocationId, setActiveLocationId(id|null),  // id | OTHER_LOCATIONS_ID | null
//   error }
// Filters are applied by Wix (a fresh first page per selection; services goes null meanwhile) and
// mirrored to ?category= / ?location=; the store reads them on start.

// useBookingFlow(service: ServiceDetail) →
// { days: [{ dayKey, dayLabel, slots: Slot[] }] | null,   // day-grouped; null = loading; [] for a COURSE
//   windowStart, nextWeek(), prevWeek(), jumpTo(dayKey),  // 7-day paging on day boundaries (prev clamps to today)
//   nextAvailable: Slot[] | null,                         // next bookable times beyond the window; null = loading, [] = none / not applicable
//   staffId, setStaffId(id|undefined),                    // picker only when service.staff.length > 1; seeded from ?resource=
//   selectedSlot, setSelectedSlot(slot|null),             // ignores a !bookable slot
//   // Slot = { key, startLocal, endLocal, dayKey, label, bookable, totalCapacity|null, remainingCapacity|null,
//   //          waitlistCapacity|null, scheduleId|null, eventId|null, eventTitle, location|null, staff: [{id,name}] }
//   timeZone|null, timeZoneLabel /* "Eastern Time (EDT)" | "" */,
//   displayTimeZone: "BUSINESS"|"CUSTOMER", customerCanChangeTimeZone, setDisplayTimeZone(zone),
//   course: { totalCapacity|null, spotsLeft|null, full } | null,   // COURSE seats; null while loading / ended
//   offeredDays: Weekday[],                               // a class/course's weekdays ("MONDAY"…); [] for appointments
//   sessions: Session[] | null, hasMoreSessions, loadMoreSessions(),  // class (and running course) sessions, 7 a page
//   // Session = { id, title, startLocal, endLocal, dayKey, dayLabel, label, durationMinutes, staff, totalCapacity|null, spotsLeft|null, isFullyBooked, isCancelled }
//   participants, maxParticipants, setParticipants(n),    // seats in this booking; control only when maxParticipants > 1
//   payDeposit, setPayDeposit(bool),                      // only when service.deposit?.fullUpfrontAllowed
//   addOnGroups: [{ id, name, prompt, maxSelectable|null, addOns: [{ id, name, price, durationMinutes|null, maxQuantity|null }] }],
//   addOns /* { [addOnId]: quantity } */, toggleAddOn(id), setAddOnQuantity(id, n), canSelectMore(groupId),
//   addOnsTotal /* formatted or "" */, addOnsMinutes,     // shown, NOT yet sent with the booking (see hard rules)
//   formFields: [{ target, label, type, options?, required }], // never empty (contact-basics fallback); only required ones gate canBook
//   values, setValue(target, value),                      // inputs write here, keyed by target
//   ctaState, canBook,                                    // label the CTA from ctaState; gate it on canBook
//   book(): Promise<BookingResult>,                       // paid → the browser navigates to the Wix checkout;
//   booking, confirmed, error }                           // free/offline → confirmed is set (REAL success)
// A window, staff, or zone change clears selectedSlot and sets days to null while the new week loads.
// book() rejects on refusal (slot taken, invalid form) AND records .error — render it beside the CTA.
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state machines
behind the hooks do arrive — `wix/bookings/services-store.ts`, `booking-flow-store.ts` — so you
never rewrite them: create a store per surface, `subscribe`, render from `getState()`, call its
actions. Their `ServicesState` / `BookingFlowState` interfaces are the render contract; read those.
What you write is the rendering — tiles, the slot picker, the form, the CTA — and for that read
these first; they are tested code for exactly that behaviour:

1. `components/bookings/ServiceBookingView.tsx` — the booking surface as working code: the course
   panel (dates, seats), the time-zone line, the staff filter only when there is more than one staff
   member, the day strip with the week pagers at its ends, the active day's slot chips in morning /
   afternoon / evening buckets (disabled "Full"), the empty week pointing at `nextAvailable`,
   the sessions list, participants, deposit choice, add-ons, one input per `formFields` entry typed
   from its `type` (a `<select>` when it has `options`), the CTA disabled until `canBook` and labelled
   from `ctaState` + the money, `error` inline, and the confirmed state rendered only from
   `confirmed` with copy by `ctaState`.
2. `components/bookings/ServicesView.tsx` — category pills only when `categories.length > 1`, the
   location filter only when there is more than one option, skeleton tiles while `services === null`,
   the honest empty state, "Load more" while `hasMore`, and `ServiceCard`: image with the type (and
   "Online") badge, name, tagLine, "duration · price line", offered days, locations.

All under `templates/bookings/app/`.

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
`fetchBookingCategories`, `fetchLocations` from `./js/wix/services.js`; `fetchSlots`,
`fetchNextAvailableSlots`, `fetchBookingsSettings`, `fetchSessions`, `fetchOfferedDays`,
`fetchCourseAvailability`, `fetchAddOnGroups`, `fetchBookingForm`, `bookService` from
`./js/wix/booking.js`. The state machines ship too: `createServicesStore` from
`./js/wix/services-store.js` (the listing — `start()` once the page is up, `setActiveCategoryId`,
`setActiveLocationId`, `loadMore`) and `createBookingFlowStore(service)` from
`./js/wix/booking-flow-store.js` (the booking surface — `fetchServiceBySlug(slug)` first, then the
store: days, week paging, `nextAvailable`, staff filter, course seats, sessions, participants,
deposit, add-ons, `formFields`, `setValue`, `ctaState`, `canBook`, `book()`). No components ship — you write the rendering in plain JS: one
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
server:** port `js/wix/services.ts` and `services-core.ts` to your language — the same four
functions (a page of services with its filters, one service, categories, locations) returning the
same DTO shapes as dicts, one anonymous visitor token per process for these public reads (mint and refresh per `client.ts`) — and render the listing and the service page in
your templates to the contracts above, so service names and prices are in the HTML; page tags from
the `ServiceDetail`. **Booking in the browser:** the booking surface on
`./js/wix/booking-flow-store.js` with the rendered `ServiceDetail` (a JSON script tag, or
`fetchServiceBySlug(slug)` from `./js/wix/services.js`), exactly as the static wiring above — the
browser owns the visitor's token, so the server never handles per-visitor tokens, and the booking,
its cart, and the checkout redirect are the visitor's. Routes stay `/services`, `/services/<slug>`.
Add your public https origin to the OAuth app's allowed domains before checkout can return.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the reads, run at build time with one anonymous token; the generator must emit a page for every
slug `fetchServices()` returns — follow `hasMore` across its pages. Run `deploy.mjs bookings --stack static --out <build dir>` so
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

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded directly — hash routes, or one HTML file per route, decided before the first route is written; any URL handed to Wix as a return target must be one the host serves (SKILL.md step 1).

## Hard rules

- **Booking logic only through the shipped exports** — `useBookingFlow`/`bookService` own the
  sequence (createBooking → cart holds the seat, carries the contact and location → checkout-or-place
  decided from the calculated cart), the payment-option derivation, ANY_RESOURCE, the slot's
  location, a course's schedule booking, participants, the deposit flag, the notifications, and the
  formSubmission shape. Never re-derive any of it, never call `confirmBooking`, never hand-build a
  checkout URL.
- **The CTA and the confirmed copy follow `ctaState`** — "Request to book" / "Request sent" for
  `requestToBook`, no booking CTA for `viewCourse`. A request is not a confirmed seat.
- **Add-ons are shown and selectable, not yet booked** — `addOnGroups`/`addOns`/`addOnsTotal` render
  the owner's extras and their price, but `book()` does not send them (the Create Booking field for
  chosen add-ons is not yet verified); tell the visitor they are added at the venue, or leave add-ons
  out of the surface. Never invent a payload field for them.
- **Money strings are final** — render `price`, `basePrice`, `deposit.amount`, `addOnsTotal` as given;
  "" means unknown, so omit it. Never format amounts yourself or assume a currency.
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

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it as
`dashboardUrl`); a service id fills the placeholder from the seed result.

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Services | `bookings/services` |
| Edit a service | `bookings/services/form/{serviceId}` |
| Calendar | `bookings/calendar` |
| Bookings list | `bookings/bookings/bookings-list` |
| Staff | `bookings/staff` |
| Availability | `bookings/availability` |
| Booking form | `bookings/settings/booking-form-page` |
| Policies | `bookings/settings/policies` |
| Accept payments — connect a payment method | `wix-cashier/payments` |
| Upgrade the plan — online payments need premium | full URL: `https://www.wix.com/upgrade/website?metaSiteId={siteId}` |

Completing a booking online — free services included — needs a payment method on the site ("manual
payments" is enough for free and pay-in-person); taking real online payments also needs a premium
plan. Until then `book()` surfaces "the site is not accepting payments" and hosted checkout says
"We can't accept online payments." Hand both links above in the close; don't treat it as a code failure.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-bookings.mjs` from the project root.
Seed services that exercise the UI (an APPOINTMENT with duration+price, a free one, a CLASS with
recurring `weekly` sessions, a COURSE when it fits the business; a "From" price, a quote, a deposit,
a manual-approval service, a waitlist, a second staff member or location where the brief allows; an
image per service).
