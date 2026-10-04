# Rentals — playbook

The rental machinery ships as files — the rental catalog (Bookings services carrying the Wix
Rentals app id, paged), the two availability flows (hourly: a start, then the lengths that start
allows; daily: a start day, then the consecutive days it can run into), the server-priced quote for
a start and length, the schema-driven booking form, and the exact `createBooking → cart →
checkout-or-place` sequence with the rental's resource and the customer's end, typed end-to-end.
**The presentation is yours**: you design and implement the rental card, the listing surface, and
the rental surface on the shipped hooks/DTOs, plus the home page and the brand. You never write
rental logic; you never skip designing.

Wix Rentals has no API of its own: a rental is a Wix Bookings service with five field values (the
Rentals app id, a resource type and its resources, the Rentals form, a duration range). The shipped
code knows this so you don't have to; the bookings vertical is NOT needed alongside this one (the
seed installs the Wix Bookings app itself, as the availability engine), and a site that runs both
keeps them apart by the app id.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the two
pages' island imports. Files you **create**: your listing and rental components, plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes)` — every `<img>` attribute for a DTO image: `<img {...imgAttrs(r.imageUrl, "33vw")} alt={r.name} />`; `imgSrc()` / `imgSrcSet()` / `formatMoney()` underneath |
| `wix/rentals/types.ts` | the DTOs (`RentalSummary`, `RentalDetail`, `RentalLocation`, `StartOption`, `EndOption`, `RentalQuote`, `RentalFormField`, `RentalResult`) — contracts below |
| `wix/rentals/rentals.ts` | `fetchRentals` (one page), `fetchRentalBySlug`, `fetchStarts`, `fetchEndOptions`, `fetchQuote`, `fetchRentalForm`, `rentResource` — the transport; the rules and DTO mappers (the five rentals values, rate and range labels, the request bodies, the daily walk, checkout-or-place) are in `rentals-core.ts` beside it (shared with the REST layer) |
| `wix/rentals/rentals-store.ts` · `rental-flow-store.ts` | the listing and rental state machines, framework-free (`createRentalsStore()`, `createRentalFlowStore(rental)` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/rentals/useRentals.ts` | React binding of `rentals-store.ts`: listing + paging — contract below |
| `hooks/rentals/useRentalFlow.ts` | React binding of `rental-flow-store.ts`: the whole rental state machine — contract below |
| `components/rentals/RentalsView.tsx` (+ `RentalCard`) · `RentalBookingView.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If another vertical is also deployed, its layout won — add a Rentals nav link there |
| `pages/rentals.astro` | SSR listing — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/rentals/[slug].astro` | SSR detail + rental with owner-editable SEO — **keep the frontmatter and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly; swap the island import. The rental island stays `client:only="react"` (availability is time-zone-specific) |

## What you build — the design job

1. **The rental card + listing surface** — your tile (image, "By the hour" / "By the day", the
   rate and range presentation) and rhythm, with skeletons while loading and an honest empty
   state — on `useRentals`.
2. **The rental surface** — the start picker one day at a time (a strip of the days that have
   availability, then that day's times bucketed into morning, afternoon and evening; a daily rental
   shows the strip alone) with window paging at the strip's ends, the length picker for the chosen
   start, the quote, the schema-driven form, the CTA labelled from `ctaState`, and the confirmed
   state — on `useRentalFlow`, which owns ALL rental logic; you own how it looks.
3. **The home page** — hero, featured rentals (fetch in frontmatter → your components), brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens.

### What a complete rentals site shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins where it differs. Look at the
rentals before designing (hourly vs daily, how many units, rates, images) and design for this
business, not a stereotype of its category. Then, by default:

- **Home:** what is for rent and one rental action in the first screen; real rentals under truthful
  headings; not a repeat of the listing.
- **Listing:** a real rental card — image, name, unit badge, `rateLabel` ("$40 / hour") and
  `rangeLabel` ("1 to 8 hours"), link — in the first screen; nothing when a label is ""; a
  "Load more" affordance while `hasMore`; `rentals === null` → skeleton tiles, `[]` → your honest
  empty state.
- **Rental page:** name, rate, and the first available day's starts in the first screen **at 390px
  wide too** — the image is a bounded band on a phone, not a full-screen hero. **One day at a
  time:** a horizontal strip of the days in `days` (weekday and day number), the active day's
  starts under it bucketed into morning / afternoon / evening, and the window pagers at the strip's
  ends (`windowDays` is 7 for hourly, 14 for daily). Never list every day's times at once: a
  rental's resources are usually bookable around the clock, so a week is over three hundred chips
  and the form ends up below a wall of numbers. For a daily rental the strip is the start picker (a
  day is a start). Switching day drops a start chosen on another day. "Times in {timeZone}" for an
  hourly rental once known; a start chip keyed by `start.key`, disabled when `!bookable`; a window
  with no starts says so and offers the next one; once a start is chosen, the length picker from `endOptions`
  (`null` → loading, `[]` → "this start can't be rented for the minimum length — pick another");
  once a length is chosen, the quote (`quote === null` → "calculating", `quote.total` → the total,
  "" → omit); the form under the pickers, the CTA under the form.
- **CTA label:** from `ctaState` — "Rent" / "Request to rent" — then the money: "— free" when
  `rental.free`, "· {quote.total}" once quoted, else "· {rateLabel}"; nothing when both are "".
- **Confirmed state:** rendered only from `confirmed`; a visitor returning from the hosted checkout
  is not a success signal. Its copy follows `ctaState`: "You're all set" + "a confirmation email is
  on its way" for `rent`; "Request sent" + "you'll hear back once it's approved" for
  `requestToRent` — never promise a confirmed rental for a request.
- **A slug that resolves to nothing** shows only the not-found state.
- **Copy:** nothing the owner didn't supply — no invented reviews, availability pressure, or
  guarantees; no Wix IDs or technical words in visible text.

### The contracts your components consume

Everything you need to build on the shipped code; read the source only when something is off.

```ts
// RentalSummary (tiles) — display-ready, every money value already a string ("" = unknown, omit it):
// { id, slug, name, tagLine, unit: "HOUR"|"DAY",
//   ratePerUnit /* "$40" | "Free" | "" */, rateLabel /* "$40 / hour" | "$40 / day" | "Free" | "" */,
//   rateAmount, currency /* numbers for the store's fallback math — never render these */,
//   minUnits, maxUnits /* in the unit; hours may be 0.5 */, rangeLabel /* "1 to 8 hours" | "3 days" | "" */,
//   imageUrl /* https or "" */, resourceTypeId|null, resourceCount,
//   locations: [{ id|null, name, type: "BUSINESS"|"CUSTOM"|"CUSTOMER" }],
//   onlineBookingEnabled, requiresManualApproval, free }
// RentalDetail adds: description, formId|null, paymentOption, cancellationFeeEnabled, scheduleId|null.

// useRentals({ initialRentals?, initialHasMore?, pageSize? = 20 }) →
// { rentals: RentalSummary[]|null /* null = loading → skeletons */, hasMore, loadingMore, loadMore(), error }

// useRentalFlow(rental: RentalDetail) →
// { days: [{ dayKey, dayLabel, starts: StartOption[] }] | null,   // day-grouped; null = loading; [] = none in the window
//   windowStart, windowDays, nextWindow(), prevWindow(), jumpTo(dayKey),  // paging on day boundaries (prev clamps to today)
//   timeZone|null,                                        // the business zone the times are in (from the response)
//   selectedStart, setSelectedStart(start|null),          // ignores a !bookable start; clears the length and the quote
//   // StartOption = { key, startLocal, dayKey, label /* "9:00 AM" | "Mon, Oct 5" */, bookable, location|null,
//   //                 resource: { id, name } | null, scheduleId|null }
//   endOptions: EndOption[] | null, selectedEnd, setSelectedEnd(end|null),   // null = loading (or no start yet); [] = none
//   // EndOption = { endLocal, units, label /* "2 hours · until 11:00 AM" | "3 days · until Wed, Oct 7" */ }
//   quote: { total, totalAmount, units, unit } | null,    // the server's price for start + length; null until both chosen and priced
//   formFields: [{ target, label, type, options?, required }], // never empty (contact-basics fallback); only required ones gate canRent
//   values, setValue(target, value),                      // inputs write here, keyed by target
//   ctaState: "rent"|"requestToRent", canRent,            // label the CTA from ctaState; gate it on canRent
//   rent(): Promise<RentalResult>,                        // paid → the browser navigates to the Wix checkout;
//   renting, confirmed, error }                           // free/offline → confirmed is set (REAL success)
// A window change clears selectedStart, selectedEnd and quote and sets days to null while the new window loads.
// rent() rejects on refusal (start taken, length refused, invalid form) AND records .error — render it beside the CTA.
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state machines
behind the hooks do arrive — `wix/rentals/rentals-store.ts`, `rental-flow-store.ts` — so you never
rewrite them: create a store per surface, `subscribe`, render from `getState()`, call its actions.
Their `RentalsState` / `RentalFlowState` interfaces are the render contract; read those. What you
write is the rendering — tiles, the start and length pickers, the form, the CTA — and for that read
these first; they are tested code for exactly that behaviour:

1. `components/rentals/RentalBookingView.tsx` — the rental surface as working code: the day strip
   (the days with availability, pagers at its ends), the active day's starts in morning / afternoon
   / evening buckets for an hourly rental, the strip as the start picker for a daily one, the
   time-zone line,
   the length picker with its loading and empty states, the quote line, one input per `formFields`
   entry typed from its `type` (a `<select>` when it has `options`), the CTA disabled until
   `canRent` and labelled from `ctaState` + the money, `error` inline, and the confirmed state
   rendered only from `confirmed` with copy by `ctaState`.
2. `components/rentals/RentalsView.tsx` — skeleton tiles while `rentals === null`, the honest empty
   state, "Load more" while `hasMore`, and `RentalCard`: image with the unit badge, name, tagLine,
   "rate · range", locations.

All under `templates/rentals/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the other
   vertical's layout instead if several are deployed).
2. Write your components under `src/components/rentals/` (new names — don't overwrite the
   references), swap the island imports in `pages/rentals.astro` and `pages/rentals/[slug].astro`.
   Listing island: `client:load` with the SSR props; rental island: `client:only="react"`.
   **Author your surfaces in as few messages as possible** — batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs rentals --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts` (the
visitor client, configured with the public client id), `media.ts`, `money.ts`, and `wix/rentals/` —
`rentals.ts`, `types.ts`, `rentals-core.ts`, and the two stores. None of it is React. The hooks and
components don't ship on this stack; the stores replace the hooks, and you write the components in
your framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createRentalsStore(options)` per listing (`start()` when
  mounted, `stop()` when unmounted), `createRentalFlowStore(rental)` per rental surface (the
  `RentalDetail` from `fetchRentalBySlug`; `start()` in the browser only). State in, actions out —
  exactly the hooks' contracts above;
- your tiles, pickers, form, and CTA to the defaults in "What a complete rentals site shows" — the
  shipped `RentalBookingView.tsx` and `RentalsView.tsx` are readable as behaviour specs.

Routes `/rentals`, `/rentals/:slug` (via `fetchRentalBySlug`, null → your 404); dev server on 4321;
a static build goes through `npx @wix/cli@latest release` with `site.outputDirectory` pointing at
the build folder, an SSR build is hosted by you. Rental-page tags from the `RentalDetail`.

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs rentals --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM,
the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` — pages,
styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project root
(config, plan, seed output) is never the upload. Same function names and DTOs as the table above,
so the contracts on this page hold unchanged: `fetchRentals`, `fetchRentalBySlug`, `fetchStarts`,
`fetchEndOptions`, `fetchQuote`, `fetchRentalForm`, `rentResource` from `./js/wix/rentals.js`. The
state machines ship too: `createRentalsStore` from `./js/wix/rentals-store.js` and
`createRentalFlowStore(rental)` from `./js/wix/rental-flow-store.js` (`fetchRentalBySlug(slug)`
first, then the store). No components ship — you write the rendering in plain JS: one render
function per surface that reads `getState()`, called from `subscribe`, with the surface's controls
calling the store's actions. `rent()` navigates the full document to the hosted checkout for a paid
rental on its own (`window.location.origin` must be on the OAuth app's allowed domains so checkout
can return); for a free or pay-in-person rental it sets `confirmed`. Pages are `rentals.html` and
`rental.html?slug=…` (Wix static hosting serves files, not directories). Set `document.title` and the
meta description from the `RentalDetail` once it loads. The visitor token persists in `localStorage`
on its own; never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs rentals --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. **Reads on the server:** port `js/wix/rentals.ts`'s two
catalog reads and `rentals-core.ts`'s mappers to your language (a page of rentals, one rental),
returning the same DTO shapes as dicts, one anonymous visitor token per process for these public
reads (mint and refresh per `client.ts`), and render the listing and the rental page in your
templates so names and rates are in the HTML. **Renting in the browser:** the rental surface on
`./js/wix/rental-flow-store.js` with the rendered `RentalDetail` (a JSON script tag, or
`fetchRentalBySlug(slug)` from `./js/wix/rentals.js`), exactly as the static wiring above — the
browser owns the visitor's token, so the booking, its cart, and the checkout redirect are the
visitor's. Routes stay `/rentals`, `/rentals/<slug>`. Add your public https origin to the OAuth
app's allowed domains before checkout can return.

**Pre-rendered (any static-site generator) → Wix-hosted.** Same port for the reads at build time;
the generator emits a page for every slug `fetchRentals()` returns, following `hasMore`. Run
`deploy.mjs rentals --stack static --out <build dir>`, point `site.outputDirectory` at that folder,
`wix release`. Give the templates one root-relative base path to `js/wix/`. Availability and
renting still run client-side on the rental page through `createRentalFlowStore()`.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite plugins —
deploy added the dep). Routes: `/rentals` → your listing; `/rentals/:slug` → fetch with
`fetchRentalBySlug(slug)` client-side, then your rental surface on `useRentalFlow(rental)`. Deploy
wrote the public client id into `wix/config.ts`; nothing else to configure.

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded
directly — hash routes, or one HTML file per route, decided before the first route is written.

## Hard rules

- **Rental logic only through the shipped exports** — `useRentalFlow`/`rentResource` own the
  sequence (createBooking with the start's resource and the customer's END → cart holds it, carries
  the contact and the Rentals app id → checkout-or-place decided from the calculated cart), the
  payment-option derivation, the price preview's three fields, the daily walk, the notifications,
  and the formSubmission shape. Never re-derive any of it, never call `confirmBooking`, never hand-
  build a checkout URL, never add a duration to a start yourself.
- **Hourly and daily are two flows, one contract** — branch your rendering on `rental.unit`; the
  store already branches the calls (end options are hourly-only; a daily rental's lengths come
  from the walk over `days`).
- **The CTA and the confirmed copy follow `ctaState`** — "Request to rent" / "Request sent" for
  `requestToRent`. A request is not a confirmed rental.
- **Money strings are final** — render `rateLabel`, `ratePerUnit`, `quote.total` as given; "" means
  unknown, so omit it. Never multiply `rateAmount` yourself for display; the quote is the server's.
- **The form is schema-driven** — render `formFields` as given (values keyed by `target`); never
  hardcode field names beyond what the fallback already guarantees.
- **Gate the CTA on `canRent`** and surface `error` — `rent()` can reject (start taken, length
  refused, validation); that message is for the visitor.
- **The confirmed state must reflect REAL success**: render it only from `confirmed`. A visitor
  returning from the hosted checkout redirect is NOT a success signal.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens. Where they don't (`lib`, `static`, a port):
  style with whatever your stack does well, on one token set of your own.
- Live data or an honest empty state — never mock rentals, starts, or lengths.
- Keep the detail page's SEO pieces exactly as shipped (Astro).
- **Browsing and renting need no login.** They run on the Wix visitor session the shipped client
  already holds; don't gate rentals behind sign-in unless the brief asks for accounts.
- **Call every hook before any conditional return.** Hooks first, branches after.

## Point the user to their dashboard

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it
as `dashboardUrl`). Rentals live in the Rentals dashboard page, not the Bookings services page: that
page lists only services carrying the Bookings app id, so on a rentals site it shows an empty "Add a
New Service" wizard. Never send the owner there for their rentals.

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Rentals (the rooms, their prices and hours) | `wix-rental/rental-list` |
| Bookings list | `bookings/bookings/bookings-list` |
| Calendar | `bookings/calendar` |
| Booking form | `bookings/settings/booking-form-page` |
| Policies | `bookings/settings/policies` |
| Accept payments — connect a payment method | `wix-cashier/payments` |
| Upgrade the plan — online payments need premium | full URL: `https://www.wix.com/upgrade/website?metaSiteId={siteId}` |

Completing a rental online — free rentals included — needs a payment method on the site ("manual
payments" is enough for free and pay-in-person); taking real online payments also needs a premium
plan. Until then `rent()` surfaces "the site cannot take online bookings yet" and hosted checkout says
"We can't accept online payments." Hand both links above in the close; don't treat it as a code failure. Resources are seeded bookable around the clock;
opening hours per resource are dashboard work (and split a multi-day rental into one booking per
day) — say so.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-rentals.mjs` from the project root. Seed
resource types with their units and 3–4 rentals that exercise the UI (an hourly one and a daily one
where the business allows, a free or approval-gated one where it fits, an image per rental).

A fresh Rentals install carries Wix's own sample rental ("Conference room", $45 an hour), and the
listing shows it next to the seeded ones. Never delete it, or anything else on the site: the result's
`preexisting[]` names what the listing shows, and the closing message says so with the Rentals
dashboard link so the owner removes it there — never release a kayak shop that rents a conference
room without telling the owner.
