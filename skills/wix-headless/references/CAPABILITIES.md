# Wix vertical index

A catalog of the Wix business verticals. It does two jobs:

1. **Discovery** maps the user's words to the right vertical(s) — read every *Intent* line against what they asked for, and pick each vertical that genuinely fits.
2. For the verticals this skill builds end-to-end, it also says **what a complete site for that vertical looks like** — the features it must have and the details that make it feel finished.

> **Read this against the operation — `create` vs `connect`.**
> - **Intent** matching (job 1) always applies — it picks the capabilities to install and seed, no matter the operation.
> - **Required site features** and **Implementation checklist** (job 2) describe a site **built from scratch** — they are the target for **`create`**, and they tell **backend-only** what to ask the host to build. They are **not a spec to impose on `connect`.** In `connect` the user brought a finished design; **wire only what that design actually needs** (e.g. a single wedding page with an RSVP → set up the RSVP and wire it; do *not* add an events-listing page or per-event pages just because the vertical's required-features list names them). Use the checklist there only as a soft hint for what an already-present surface should show — never to add surfaces the design doesn't have.

This file is **the what, never the how** — plain language only. No endpoints, methods, payloads, appDefIds, or SDK packages. The *how* lives in the live docs (Seed navigates the REST docs; the Handoff navigates the SDK docs); the *which apps to install* lives in `SETUP.md`.

Each built vertical has three parts (the latter two scoped to `create`/backend-only per the note above):

- **Intent** — the words that point to it.
- **Required site features** — the surfaces and capabilities the site must have to be usable. These are non-negotiable for a complete site; if one needs a backend feature switched on, Seed sets it up, and the Handoff tells the host to build the rest.
- **Implementation checklist** — the presentation details a finished site shows, so it doesn't feel half-built. The Handoff carries these into the guide it returns.

## Built verticals — installed, seeded, and described in the Handoff

The verticals the skill operates end-to-end today: **stores · blog · cms · forms · events · bookings · pricing-plans · restaurants · portfolio** (with `forms` as the floor when nothing richer is named).

### stores — sell products
- **Intent:** sell / shop / products / catalog / merch / store.
- **Required site features:** a product list or grid; a page per product; categories to browse by; a cart; a checkout.
- **Implementation checklist:** show each product's image, name, and price; show options and variants (size, colour…) where they exist; show availability / out-of-stock; a quantity picker and an add-to-cart that updates a visible cart; the product description; link each product to its category.

### blog — publish posts
- **Intent:** blog / posts / articles / publication / news.
- **Required site features:** a list of posts; a page per post; categories or tags to browse by topic.
- **Optional (intent-gated):** reader **comments** on a post — build **only if the brief asks for discussion/interaction.** Comments hard-depend on members/login, so adding them unrequested drags in an unrequested login gate; they are **not** part of the baseline blog surface (see `inline-recipes/how-to-code-a-blog.md` §Comments).
- **Implementation checklist:** show the **author** (name and photo) on each post; show the publish date and the reading time; show the cover image; render the full formatted content — headings, images, quotes, lists — not flattened to plain text; show the post's category and tags; a clear path back to the full list.

### cms — structured content collections
- **Intent:** collection / directory / portfolio-as-data / structured content / "persist my app's data".
- **Required site features:** an index/list view of the collection; a detail page per item. (Visitor reads are public; visitor writes go through a form.) **(Opt-in, with members)** when the brief asks for per-user-private data ("my saved items", a personal list) or member-only content **and** members login is in the run, a collection can instead be **member-scoped** — each member sees/edits only their own rows, or any logged-in member reads shared member-only content. Added only on that intent, never by default; see the members cross-cutting entry and `setup-cms.md`.
- **Implementation checklist:** show each item's main fields with clear labels; link the list to each item's detail page; show a sensible empty state when there are no items yet.

### forms — capture leads
- **Intent:** contact / lead / signup / waitlist / "let people reach me" / generic custom data capture / nothing dynamic named. **Not for RSVP** — confirming attendance to an event or occasion (a wedding, party, or gathering) is the **events** vertical, which has a built-in RSVP registration form; route there even when it's a single occasion with no tickets. Use `forms` only when no event is involved.
- **Required site features:** a visible form; a confirmation after submitting; basic field validation.
- **Implementation checklist:** render every field with a clear label; mark which fields are required; a clear submit button; show a thank-you / success state after sending; show a friendly message if the submit fails.

### events — events and registration
- **Intent:** event / ticket / RSVP / registration / attendees / "confirm attendance" / a wedding, party, or gathering people respond to. **Covers RSVP to a single occasion** (one wedding, one party) — not only multi-event listings, and not only ticketed events. An invitation with an RSVP is this vertical, not `forms`.
- **Required site features:** the event's details and a way to register or RSVP. **RSVP events come with a built-in registration form** (name + email are always included), so the site needs an RSVP action — *not* a hand-built form with custom fields. For a multi-event site, also a list of events and a page per event.
- **Implementation checklist:** show the event's title, date and time, and location; show the description; show ticket types where they exist (ticketed events); a register/RSVP action; collect additional-guest names where extra guests are allowed; a confirmation after registering.

### bookings — appointments and classes
- **Intent:** book / appointment / schedule / class / session / reserve a slot — a **service or appointment with a provider** (a stylist, trainer, tutor, clinic, studio).
- **Not bookings — route to `restaurants` instead:** a **table at a restaurant** is a Table Reservations concern, not a bookable service; and a **special dining occasion guests reserve** — a wine tasting, cheese pairing, chef's table, or tasting-menu evening at a restaurant — is a **restaurants → Table Reservations *experience*** (see the restaurants entry), **not** a bookings service. Reach for `bookings` only when what's booked is a standalone service/class with a provider, never a seat at a restaurant.
- **Required site features:** a list of services; a page per service; a way to pick a time and book it.
- **Implementation checklist:** show each service's name, duration, and price; show the staff or provider; show the available time slots; a book action; a confirmation after booking.

### pricing-plans — memberships and subscriptions
- **Intent:** membership / subscription / plans / paid tiers.
- **Required site features:** a plans / pricing page; a way to choose and subscribe to a plan. **Subscribing requires a logged-in member** — the plans grid is public, but the *subscribe* action and any *my subscription* surface need the **members** cross-cutting capability (below); it's a hard dependency, not optional.
- **Implementation checklist:** show each plan's name, price, and billing cycle; list what each plan includes (the perks); a clear "choose plan" action; highlight a recommended tier where it makes sense.

### restaurants — menus and food
- **Intent:** menu / restaurant / cafe / food / dish list / order food / dine-in / **reserve a table** / a **special dining occasion guests reserve** (wine tasting, cheese pairing, chef's table, tasting-menu evening).
- **Required site features:** a menu organized into sections; each item with a name, description, and price. **Add-ons, each on demand (separate apps/features; see `SETUP.md`):** online ordering, table reservations, and — **when the brief names special dining occasions** — **experiences** (a reservation that *is* a curated occasion at the restaurant, e.g. a wine-and-cheese pairing), which ride on the Table Reservations app.
- **Experiences vs bookings — decide here:** an **experience** is a **reservation that is itself a special dining occasion at the restaurant** — it books seats at the restaurant's own location and carries its own name, per-guest price, schedule, and booking form. Use it for pairing sessions, tastings, and chef's tables. Use the separate **`bookings`** vertical only for a **service/appointment/class with a provider** that isn't a seat at the restaurant. For anything a restaurant hosts and seats, prefer an experience.
- **Implementation checklist:** show the menu grouped into sections in order; each item's name, description, price, and labels (vegan, spicy…) and modifiers / variants where they exist; an order action if online ordering is wired; a reserve-a-table action if reservations are wired; **if experiences are wired, list each experience with its name, description, per-guest price, and schedule, and a reserve-seats action.**

### portfolio — showcase projects
- **Intent:** portfolio / showcase / gallery of projects / creative work / case studies.
- **Required site features:** a gallery of projects; projects grouped by collection; a page per project.
- **Implementation checklist:** show each project's cover, title, and description; group / filter by collection; on the project page show its details (role, year…) and media in order with a viewer / lightbox; a clear path back to the gallery. (Text-only seed shows the structure; media is omitted.)

## Cross-cutting capabilities — usable, but ride on a parent vertical

These are **not standalone verticals** — they aren't seeded on their own and don't go in `verticals[]`. Most have no app to install (eCommerce installs as a dependency; coupons need no install; members' identity layer is the OAuth app). But they **are fully usable**, and the agent should reach for them when a built vertical is present and intent calls for them. They attach to whatever catalog vertical the run already set up. Don't list these as "not-yet-wired" — they're wired *through* their parent. (One conditional install exists: the **members** *profile* layer needs the Wix Members Area app — see its entry and `SETUP.md`.)

- **eCommerce** — the shared cart, checkout, orders, and payments layer. It has no catalog of its own; it's **installed automatically as a dependency** by Stores, Bookings, and Events, and it's how every purchase actually completes. The frontend uses it via `@wix/ecom` (+ `@wix/redirects`) — already carried in the Handoff for those verticals. Reach for the eCommerce Cart/Checkout APIs (find the *how* in the docs) whenever a purchase flow needs to be built or customized. *Intent: checkout / cart / "let people buy".*
- **coupons** — discount codes and promotions applied at checkout. **No standalone app** — requires a parent already installed (stores / bookings / events / pricing-plans). When intent calls for discounts and such a parent is present, **create coupons on demand** scoped to that parent — find the create method in the docs (`DOC_DISCOVERY.md`) and surface `@wix/marketing` in the Handoff. *Intent: coupon / promo code / discount.*
- **members** — the **identity layer**: member sign-up / log-in / log-out and member-gated surfaces. **Not seeded, and login needs no app install** (it's the headless OAuth app) — so it doesn't go in `verticals[]`. **Reading member profile data** (name / photo / roles / badges, an editable my-account page), however, needs the **Wix Members Area app installed** (`SETUP.md`) — keep the identity layer and the profile layer separate. Sign-up and log-in are the **same** mechanism (one login page logs in *or* registers). Two things vary. **(1) The frontend axis** — Astro ships built-in `/api/auth/login` routes, non-Astro drives a manual `OAuthStrategy` handshake (the two `how-to-code-members-*.md` recipes). **(2) The login *surface*, chosen by intent — not by project type.** The default is the **Wix-hosted login page** (zero UI to build); reach for a **custom login page** (you build a branded/in-app form, and can collect custom sign-up fields like full name / username / address) **only when the brief explicitly asks for a custom login form or custom sign-up fields** (`how-to-code-members-custom-login.md`). Custom login works on **any** project type (managed or self-managed) — the choice is the user's stated intent, so don't gate it on managed-vs-self-managed. **Hard dependency edge → pricing-plans**: subscribing to a plan requires a logged-in member, so whenever `pricing-plans` is present, members is implied (surface login + my-subscription). **Soft edges** to the other verticals' "my …" surfaces (my orders / my bookings / my registrations) and to **blog comments** (see the blog recipe) — the action runs as an anonymous visitor; only the account view of it needs a member. A logged-in member reading **their own** data needs **no `auth.elevate`** (that's the separate admin/permission axis). *Intent: login / sign up / account / my profile / members area / member-only / gated content / subscriber / paywall — plus any pricing-plans intent (membership / subscription / paid tiers), which can't be purchased without it.*

## Other verticals — recognized for intent, not yet wired

If a user's intent points squarely at one of these, surface it plainly as **not-yet-wired** rather than forcing a poor fit. Extending the skill to one means adding its install in `SETUP.md` and its seed *what* in `SEED.md`, then giving it a full section above. Each entry below names the **blocker** that kept it out — read it before promising anything. Where an API path genuinely exists, the agent **may wire it ad hoc from the live Wix docs** (find the REST create method via `DOC_DISCOVERY.md`, and the SDK module as in `SDK_HANDOFF.md`), but it must state the blocker honestly rather than promise a complete site.

- **forum** — community discussion boards: categories, threads, member posts. **Deprecated** — the Forum APIs are being discontinued and there's no headless create-post path; the Groups replacement exposes no public create-post API. Don't wire; if discussion is essential, suggest blog comments or a custom solution. *Intent: forum / community / discussion board.*
- **benefit-programs** — Wix Loyalty: points, rewards, and tiers that grant members perks. **Program activation is dashboard-only** — it can't be fully bootstrapped headlessly — but once loyalty is active, rewards/tiers have REST/SDK (`@wix/loyalty`) the agent can seed from the docs. *Intent: loyalty / rewards / member perks / benefits.*
- **suppliers-hub** — supplier-side B2B product catalog management. **Partner-only** — requires a signed business agreement with Wix and isn't installable on a normal metasite; out of scope unless the user is an approved Wix partner. *Intent: supplier / wholesale / B2B catalog.*
