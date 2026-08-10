# Wix vertical index

A catalog of the Wix business verticals. It does two jobs:

1. **Discovery** maps the user's words to the right vertical(s) — read every *Intent* line against what they asked for, and pick each vertical that genuinely fits.
2. For the verticals this skill builds end-to-end, it also says **what a complete site for that vertical looks like** — the features it must have and the details that make it feel finished — so the handoff asks the host for a *real* site, not a bare data dump.

This file is **the what, never the how** — plain language only. No endpoints, methods, payloads, appDefIds, or SDK packages. The *how* lives in the live docs (Seed navigates the REST docs; the Handoff navigates the SDK docs); the *which apps to install* lives in `SETUP.md`.

Each built vertical has three parts:

- **Intent** — the words that point to it.
- **Required site features** — the surfaces and capabilities the site must have to be usable. These are non-negotiable for a complete site; if one needs a backend feature switched on, Seed sets it up, and the Handoff tells the host to build the rest.
- **Implementation checklist** — the presentation details a finished site shows, so it doesn't feel half-built. The Handoff carries these into the guide it returns.

## Built verticals — installed, seeded, and described in the Handoff

The verticals the skill operates end-to-end today: **stores · blog · cms · forms · events · bookings · pricing-plans** (with `forms` as the floor when nothing richer is named).

### stores — sell products
- **Intent:** sell / shop / products / catalog / merch / store.
- **Required site features:** a product list or grid; a page per product; categories to browse by; a cart; a checkout.
- **Implementation checklist:** show each product's image, name, and price; show options and variants (size, colour…) where they exist; show availability / out-of-stock; a quantity picker and an add-to-cart that updates a visible cart; the product description; link each product to its category.

### blog — publish posts
- **Intent:** blog / posts / articles / publication / news.
- **Required site features:** a list of posts; a page per post; readers can leave **comments** on a post; categories or tags to browse by topic.
- **Implementation checklist:** show the **author** (name and photo) on each post; show the publish date and the reading time; show the cover image; render the full formatted content — headings, images, quotes, lists — not flattened to plain text; show the post's category and tags; a clear path back to the full list.

### cms — structured content collections
- **Intent:** collection / directory / portfolio-as-data / structured content / "persist my app's data".
- **Required site features:** an index/list view of the collection; a detail page per item. (Visitor reads are public; visitor writes go through a form.)
- **Implementation checklist:** show each item's main fields with clear labels; link the list to each item's detail page; show a sensible empty state when there are no items yet.

### forms — capture leads
- **Intent:** contact / lead / signup / waitlist / "let people reach me" / nothing dynamic named.
- **Required site features:** a visible form; a confirmation after submitting; basic field validation.
- **Implementation checklist:** render every field with a clear label; mark which fields are required; a clear submit button; show a thank-you / success state after sending; show a friendly message if the submit fails.

### events — events and registration
- **Intent:** event / ticket / RSVP / registration / attendees.
- **Required site features:** a list of events; a page per event; a way to register or RSVP.
- **Implementation checklist:** show each event's title, date and time, and location; show the description; show ticket types where they exist; a register/RSVP action; a confirmation after registering.

### bookings — appointments and classes
- **Intent:** book / appointment / schedule / class / session / reserve a slot / reserve a table.
- **Required site features:** a list of services; a page per service; a way to pick a time and book it.
- **Implementation checklist:** show each service's name, duration, and price; show the staff or provider; show the available time slots; a book action; a confirmation after booking.

### pricing-plans — memberships and subscriptions
- **Intent:** membership / subscription / plans / paid tiers.
- **Required site features:** a plans / pricing page; a way to choose and subscribe to a plan.
- **Implementation checklist:** show each plan's name, price, and billing cycle; list what each plan includes (the perks); a clear "choose plan" action; highlight a recommended tier where it makes sense.

## Other verticals — recognized for intent, not yet wired

If a user's intent points squarely at one of these, surface it plainly as **not-yet-wired** rather than forcing a poor fit. Extending the skill to one means adding its install in `SETUP.md` and its seed *what* in `SEED.md`, then giving it a full section above.

- **eCommerce** — the shared cart, checkout, orders, and payments layer the catalog verticals (Stores, Bookings…) plug into; rarely chosen alone, it rides along when a purchase flow is needed. *Intent: checkout / cart / "let people buy".*
- **restaurants** — menus and online food ordering; a table-reservation intent goes to **bookings** instead. *Intent: menu / restaurant / order food / dine-in.*
- **forum** — community discussion boards: categories, threads, member posts. *Intent: forum / community / discussion board.*
- **portfolio** — showcase collections of projects and work. *Intent: portfolio / showcase / gallery of projects / creative work.*
- **donations** — donation campaigns and contributions. *Intent: donate / fundraise / campaign / nonprofit.*
- **gift-cards** — issue and redeem stored-value gift cards. *Intent: gift card / store credit / voucher.*
- **coupons** — discount codes and promotions applied at checkout. *Intent: coupon / promo code / discount.*
- **benefit-programs** — loyalty/benefit programs that grant members perks. *Intent: loyalty / rewards / member perks / benefits.*
- **suppliers-hub** — supplier-side B2B product catalog management. *Intent: supplier / wholesale / B2B catalog.*
