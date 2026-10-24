---
name: wix-vibe-headless
description: "Connect an existing front end to a live Wix site using client-only REST and its public WIX_CLIENT_ID, without an SDK or backend. Covers Stores/cart/checkout, Bookings and Rentals, Blog, Events and tickets, Portfolio, Restaurants, Donations, Forms, CMS, Pricing Plans, and Members with login, social/SSO and gated content. Use when wiring Wix business data and buyer flows into a vibe-coded app, HTML/JSX/Vite project or design export: shopping, appointments, donations, form submissions, memberships, restaurant orders/reservations and member accounts. Ships dependency-free helpers and wiring guides; never provisions or changes owner content and never mocks data. Use wix-headless instead for SDK integration, Wix CLI builds, hosting or new-site creation."
---

# Wix Vibe Headless — client-only REST connectors

Wire an existing front end to a live Wix site **from the browser**, over the site's public
`WIX_CLIENT_ID`, using hand-rolled REST — **no `@wix/sdk`, no backend, no build step, no
dependencies**. One skill, one shared transport, and a copy-as-is REST layer per Wix
business solution. Everything is **read-only over the owner's content**: render live Wix
data or an honest empty state — **never mock, never provision, never invent** products,
posts, events, menus, plans, reviews, or counts.

## When to use this skill

- The user has (or is building) a front end — a vibe-coded app, plain HTML/JSX, a Vite/React
  project, a design-tool export — and wants it to show **live data from their existing Wix
  site** and complete real purchases/bookings, all from the client.
- They hand you a **public `WIX_CLIENT_ID`** and ask to "connect this to my Wix store /
  blog / bookings / events / …".
- They want to replace placeholder/mock data with real Wix content, or add a cart, checkout,
  booking, RSVP, ticketing, reservation, form, or subscribe flow over an app they already have.

## When NOT to use this skill

| Scenario | Use instead |
|---|---|
| Build a **new** Wix site end-to-end from one prompt (discovery → design → build → host) | `wix-headless` |
| The project should use the **Wix SDK** (`@wix/sdk`) and/or the **Wix CLI**, or be **hosted on Wix** | `wix-headless` |
| Manage/configure the site via REST (install apps, seed catalogs, set up business solutions) | `wix-manage` |
| Build a Wix **app extension** (dashboard page, widget, backend, plugin) | `wix-app` |

This skill is the deliberately **client-only, REST-only** path. It is independent from
`wix-headless` (which is SDK + CLI + hosting) — do not mix the two in one project.

## The shared model (applies to every vertical)

- **Auth = one public client id.** `WIX_CLIENT_ID` is a **buyer/visitor-facing** credential —
  it only mints anonymous visitor tokens. It is **not a secret**; hardcoding and committing it
  is fine. The user provides it (their vibe/host platform surfaces a copyable prompt with the
  id filled in). Paste it into `wix-config.js` in place of the `<YOUR-CLIENT-ID>` placeholder.
- **Money/price fields are objects, never scalars.** Every price/amount a Wix API returns —
  Stores `price.actualPrice`, Bookings service `payment.fixed.price`, Events ticket
  `registration.tickets.lowestPrice`, and the rest — has the shape `{ value, currency,
  formattedValue }`. Render **`formattedValue`** (it already includes the currency symbol), or
  fall back to building from `value` + `currency`. **Never** drop the object straight into the UI
  or treat it as a number/string — that renders `[object Object]` or a bare unformatted number.
  **Donations exception:** campaign prices use `{ amount, formattedAmount }`, with a decimal-string
  `amount`; donation cart `options.amount` must instead be a JSON number. Follow the Donations recipe.
- **Visitor token = identity.** `wix-client.js` mints an anonymous visitor token, persists the
  **refresh token to `localStorage`**, and refreshes on expiry. That token IS the identity of
  the cart / reservation / member session — **never re-mint anonymously per load** or the cart
  silently empties.
- **Member login swaps the token set on the same client.** The **members** vertical is *custom*
  login — the front owns its login UI; the member is **never redirected to a Wix-hosted login page**.
  On success it writes the member's tokens into the *same* store the visitor token used
  (`setSessionTokens`), so **every subsequent `wixApiRequest` runs as the member** and the cart/session
  carries over. "My …" surfaces (plans, orders, bookings, registrations) light up only once logged in.
- **⚠️ Once you're building on Wix, keep it on Wix — auth, member data, and other business features
  too.** If you're wiring a Wix storefront/blog/etc. over `WIX_CLIENT_ID`, prefer Wix for the *rest*
  of the app as well, rather than reaching for a host platform's own backend or login. **Especially
  for auth:** when the user wants members, log them in as a **Wix member** (`members` vertical) — don't
  bolt on the host platform's auth. Likewise, member-generated content (likes, reviews, submissions,
  "my …" lists) goes in a **Wix CMS collection** (`cms` vertical), not a host database.
  - **The split-brain trap:** the most common failure is mixing the two — e.g. storing "likes" in the
    host's DB while identifying the member from the Wix session (or logging in with Wix members but
    keying data on a host user id). The two identities never match, ownership filters silently return
    nothing (a like vanishes on refresh), and the data never sits with the rest of the Wix content.
  - **Rule of thumb:** one store and one identity per feature. For a Wix-backed feature that's the Wix
    member + the Wix collection, with ownership on Wix's server-stamped `_owner` (never a hand-stored
    or host-supplied member id). Using a host backend for genuinely host-only data is fine — just
    never straddle a single feature across both.
- **Never mock, never provision.** These scaffolds are read-only over the owner's content. The
  owner adds products/posts/services/events/menus/plans in the **Wix dashboard**. If a
  collection is empty, show the empty state — never fabricate data, reviews, ratings, or counts.
- **Purchases go through Wix.** Checkout/ticketing/plan purchase always complete via the Wix
  redirect-session / Wix-hosted form — **never hand-build a `/checkout` or purchase URL**.
- **Fail loudly.** The helpers throw on out-of-stock, empty carts, unbookable slots, expired
  holds, and payment-still-owed. A green path means it really worked — don't swallow the error.
- **Copy the shipped helpers as-is — don't rewrite their internals.** Wire your UI to the *exported*
  functions; don't "refactor" or reimplement the helper bodies. Several Wix request shapes are exact
  and easy to break (the members `createRedirectSession` body is the classic trap — a rewritten
  version returns 400 and login dies). Extend by *calling* the exports or adding a new
  `wixApiRequest` call for a genuine gap — never by editing the shipped ones.
- **Beyond the snippets, look it up — never guess.** The templates and the shipped
  `references/<vertical>/` helpers are the implementation — build from them first. When you hit a
  genuine gap (a field, an endpoint, or an error the snippets don't cover), extend the client with
  `wixApiRequest` — confirming the exact endpoint, method, and body first. **For that iteration and
  troubleshooting** — finding the right endpoint, reading a method's request/response schema, or
  diagnosing an API error — consult the official Wix API documentation using the documentation
  skill available in your environment to search methods, read pages, and inspect API schemas.
  Reference index: https://dev.wix.com/docs/api-reference.md
- **Provide the user with deep links to the Wix dashboard**: In many cases, the user will need to modify the default vertical data in the Wix dashboard. Always provide the user with these links. The relevant information for each vertical's links is in its `INSTRUCTIONS.md` file.

## How this skill is structured

`<SKILL_ROOT>` is this file's directory (strip `/SKILL.md`). Each vertical supplies integration
code under `references/<vertical>/app/`: REST helpers in `app/rest/`, and, depending on the
vertical, utilities, hooks, context, components, or pages. All use the **shared transport** in
`references/shared/app/` (`app/rest/wix-client.js` + `wix-config.js`, identical for every vertical).
Set `WIX_CLIENT_ID` (and `WIX_METASITE_ID`) in `wix-config.js`. Deploying `references/<vertical>/app/`
and `references/shared/app/` into the app's `src/` puts every file in place — the REST helpers land in
`src/rest/`, so their relative imports resolve.

**Where these files live in the app, and how they get there** (pre-installed at setup, or copied
in) **is your platform's call — follow your platform instructions for that.**

Each vertical's `INSTRUCTIONS.md` specifies its prerequisites, supplied pieces, exported interfaces,
and the presentation you must build. **Read it before implementation**: reuse the supplied pieces
and build the missing presentation without reimplementing shipped logic. Follow the platform's
and vertical's completion guidance where provided.

## Routing — pick the vertical(s) from the request

Load the vertical(s) the user's app needs; a project may combine several (e.g. a restaurant
with a blog, or a store with pricing plans).

Each vertical's integration files ship in `references/<vertical>/app/`; copy that dir plus
`references/shared/app/` into the app's `src/` (base44 does this at install via `deploy.cjs`).

| The user wants… | Vertical | Read |
|---|---|---|
| Online store: products, categories, cart, checkout | **storefront** | `references/storefront/INSTRUCTIONS.md` |
| Donations: fundraising campaigns, one-time or recurring giving, hosted checkout | **donations** | `references/donations/INSTRUCTIONS.md` |
| Appointments: services, time slots, booking, checkout — **and the form attached to a bookable service** | **bookings** | `references/bookings/INSTRUCTIONS.md` |
| Rentals: an item hired for a length **the customer picks** (by the hour or by the day) — Wix Rentals runs on the Bookings APIs, so it is the same vertical | **bookings** | `references/bookings/INSTRUCTIONS.md` ("Rentals") |
| Blog/news: post feed, post pages, categories, tags | **blog** | `references/blog/INSTRUCTIONS.md` |
| Events: browse, event page, RSVP, ticketing — **an RSVP is here, not `forms`**, even for one occasion with no tickets | **events** | `references/events/INSTRUCTIONS.md` |
| Portfolio/showcase: collections, projects, media galleries | **portfolio** | `references/portfolio/INSTRUCTIONS.md` |
| Restaurant: menu, online ordering, table reservations | **restaurants** | `references/restaurants/INSTRUCTIONS.md` |
| Any visitor-fillable form: contact/enquiry, lead, signup, waitlist, application, feedback/survey, quote request, intake or registration. **Not** an event RSVP (`events`), per-service booking form (`bookings`) or donation contribution (`donations`) | **forms** | `references/forms/INSTRUCTIONS.md` |
| CMS content: list/detail, filter/search, data CRUD. **A visitor-fillable form is `forms`** — cms only when the app must read the entries back | **cms** | `references/cms/INSTRUCTIONS.md` |
| Plans & pricing: memberships/subscriptions, subscribe, my plans | **pricing-plans** | `references/pricing-plans/INSTRUCTIONS.md` |
| Member accounts: custom login/sign-up (email+password, Google/Facebook, SSO), account area, gated content | **members** | `references/members/INSTRUCTIONS.md` |

**⚠️ Anything a visitor fills in and submits is `forms` — with four exceptions:**

1. **The app must read the entries back → `cms`.** A public gallery, a listing, a member's "my
   submissions". A visitor cannot read Forms submissions, so those need a collection. Submit-only is
   always `forms`: a form wired to `insertDataItem` works, but gives up the dashboard form builder,
   spam protection, submission notifications and CRM contact mapping, and needs the owner to set
   collection permissions by hand before anyone can submit at all.
2. **Confirming attendance to an event or occasion → `events`.** A wedding, party or gathering —
   events ships a built-in RSVP registration form. Route there even for a single occasion with no
   tickets.
3. **A form attached to a bookable service → `bookings`.**
4. **A contribution to a donation campaign → `donations`.** Recurring giving is not a Pricing Plans purchase; the donation form must preserve the campaign's amount/frequency rules and use its catalog reference.

### When the request doesn't name a Wix Business Solution — ask, or check the site

Don't infer which Wix Business Solution to build (stores, bookings, blog, events, portfolio,
restaurants, CMS, pricing plans, members, etc..) from a vague brief. **Ask the user** one short
question — what do they offer (products? appointments? posts? events?) — or **check what the
site actually has**: call a cheap read from each likely solution's helper (`queryProducts`,
`queryServices`, `queryPosts`, `queryEvents`, …) — authenticated with a visitor token minted
from the `WIX_CLIENT_ID`, or with an admin token if you have one — and build for the solutions
that return real content. A `428` "app not installed" (blog: `401`) means
that solution isn't on the site; sample-looking content ("Sample product 3") proves the app is
installed, not what the business is about. Never default to store/bookings on silence.

## The run

1. **Get `WIX_CLIENT_ID`.** It comes from the user (the handoff prompt from their Wix/vibe
   platform carries it). If it's missing, ask for it before wiring — nothing works without it.
2. **Pick the vertical(s)** from the routing table — and when the request doesn't name any,
   **ask or check the site** (see above) instead of guessing. Open each picked vertical's
   `INSTRUCTIONS.md`.
3. **Ensure the vertical's files are in place** — copy `references/<vertical>/app/` and
   `references/shared/app/` into the app's `src/`, and set `WIX_CLIENT_ID` in `wix-config.js`. (Where
   and how they get there is your platform's call — see its instructions. On base44 the install step
   writes and verifies `wix-config.js` for you, so there's nothing to set by hand.)
4. **Build the presentation and wire the integration** following the vertical's `INSTRUCTIONS.md`.
   Reuse its supplied pieces through their documented interfaces, build the presentation it leaves
   to you, and connect routes/providers as specified. Do not reimplement shipped logic. Style new
   presentation using the existing platform theme.
5. **Complete the applicable platform and vertical guidance**, including any required checks and
   handoff instructions they provide.

> Some flows need Wix-side setup the user completes later (payments connected, the deployed
> domain allow-listed on the OAuth client for hosted-checkout return, collection permissions).
> Those are out of scope here — if a call fails for that reason, flag it and continue; don't
> fall back to mock data.
