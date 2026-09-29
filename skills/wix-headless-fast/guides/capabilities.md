# Capability map: which Wix product owns what, and what this skill ships for it

Read this when the Verticals table in SKILL.md does not settle the match: the brief names a Wix
product or a feature the table does not mention, two rows could fit, or the request sounds like a
vertical this skill does not ship. Every Wix product, its docs path (relative to
`https://dev.wix.com/docs/api-reference/`), the features its introduction page lists, and the
column that matters here: what this skill ships for it. Features come from the introduction pages;
when a product looks wrong or missing, re-derive from `<path>/introduction.md` through `wix-docs`.

"Shipped" means the vertical's data layer, stores, hooks, components and seed cover it; "read only"
means the DTO carries it but nothing acts on it; "not shipped" means the feature is built from the
API reference through `wix-docs` on the same project, with the same rules as every other call.

## Business solutions

| Product | Path | Features (from the introduction page) | This skill |
|---|---|---|---|
| Stores | `business-solutions/stores` | Products, categories, options and variants, inventory, brands, ribbons, info sections, customizations (modifiers), promotions, store locations, site currency, currency conversion | **storefront**: products, categories, options and variants, inventory and low stock, pre-order, ribbons, info sections, modifiers, discount names, subscriptions, back in stock, site currency (set by the seed). Not shipped: brands, store locations, currency conversion |
| eCommerce | `business-solutions/e-commerce` | Cart, checkout, abandoned checkout, orders, transactions, fulfillment, discount rules, recommendations, shipping rates, additional fees, payments, catalog | **storefront**, **restaurants**, **bookings**, **events**, **donations** use it for the cart line, totals (discounts, fees, taxes), coupon code, buyer note and the checkout redirect session; order read on the events and donations thank-you pages. Not shipped: abandoned checkout, fulfillment, shipping rates, recommendations |
| Coupons | `business-solutions/coupons` | Coupons, percentage and fixed discounts, free shipping, buy X get Y, scopes, usage limits, expiry | Applied at the cart by **storefront**; created through a `wix-manage` recipe when the brief asks (no coupon seed) |
| Bookings | `business-solutions/bookings` | Services, appointments, classes, courses, staff, resources, pricing, policies, time slots, bookings, waitlists, external calendar, checkout and orders | **bookings**: appointments, classes and courses, staff, time slots and sessions, rate types, deposits, policies as the call to action, locations, categories, booking to checkout or direct placement. Read only: waitlist flag on a slot, add-ons. Not shipped: non-staff resources, external calendar |
| Rentals | `business-solutions/rentals` | Rental services, hourly and daily durations, customer-selected length, bookable resources, resource attributes, per-hour and per-day pricing, availability, consecutive multi-day bookings | **rentals**: the catalog (Bookings services carrying the Rentals app id), hourly starts then end options, daily starts then the consecutive-day walk, the server-priced quote, the Rentals booking form, booking with the start's resource and the customer's end, checkout-or-place; the seed creates resource types, resources (bookable around the clock) and rental services one at a time. Not shipped: resource attributes and attribute filters, per-resource working hours (which split a multi-day rental into one booking per day), multi-service bookings |
| Meetings | `business-solutions/meetings` | Scheduling links, shareable booking page, duration and location, video or phone or in person, hosts, calendar sync, intake forms, paid meetings, rescheduling | **Not shipped.** Also Bookings underneath; a scheduling-link brief is built through `wix-docs` |
| Restaurants | `business-solutions/restaurants` | Menus, sections, items, variants, modifiers, labels, online orders, operations, fulfillment methods, availability exceptions, service fees, reservations, time slots, experiences | **restaurants**: menus, sections, items, variants, modifier rules, labels, ordering (operations, fulfillment methods, windows), reservations with the location's form and time slots, money from the eCommerce settings. Not shipped: service fees in the menu totals, experiences |
| Events | `business-solutions/events` | Events, ticket definitions, tickets, RSVP, orders and checkout, check-in, guests, guest list, schedule, policies | **events**: listing and event pages, occurrences, RSVP with the organizer's form and guest control, ticket tiers to checkout, order read on the confirmation page, categories. Not shipped: check-in, guest list, schedule |
| Blog | `business-solutions/blog` | Posts, draft posts, categories, tags, post stats, blog roles, paid post subscriptions | **blog**: feed, post pages, categories and tags, authors, metrics, likes, related posts, comments through Community. Seed writes draft posts and publishes them. Not shipped: paid post subscriptions, roles |
| CMS | `business-solutions/cms` | Data items, collections, collection permissions, aggregations, indexes, external databases, backups, background tasks | **cms**: collections and items with filters, sort, distinct values, paging, references, permissions set by the seed. Not shipped: indexes, external databases, backups |
| Pricing Plans | `business-solutions/pricing-plans` | Plans, orders, recurring, single payment, free plans, free trials, cancellation, credits | **pricing-plans**: plans with trials and fees, the plan gate on the member's orders, purchase through the native checkout redirect. Not shipped: cancellation, credits |
| Portfolio | `business-solutions/portfolio` | Projects, project items, collections, settings, gallery layouts, cover media | **portfolio**: collections, projects, galleries with images and video. Not shipped: settings |
| Donations | `business-solutions/donations` | Campaigns, goals, one-time and recurring, predefined and custom amounts, cover fees, progress | **donations**: all of it, through the eCommerce checkout |
| Gift Cards | `business-solutions/gift-cards` | Gift cards, gift card products, redemption codes, balances, denominations, expiry, transactions | Not shipped |
| Benefit Programs | `business-solutions/benefit-programs` | Programs, templates, tiers, credits, redemption, enrollment, balances, eligibility | Not shipped; program activation is dashboard-only |
| Suppliers Hub | `business-solutions/suppliers-hub` | Marketplace products, suppliers, dropshipping, wholesale tiers | Not shipped; partner-only |
| Forum | `business-solutions/forum` | Deprecated (discontinued March 2026) | Not shipped; do not build on it. Discussion is blog comments or Community groups |

## Site-wide products

| Product | Path | Features | This skill |
|---|---|---|---|
| Members & Contacts | `crm/members-contacts` | Contacts, labels, extended fields, notes, members, profiles, authentication, privacy, badges, followers | **members**: sign-up, login, verification, logout, the current member's profile, gated pages. Not shipped: contacts, labels, badges, followers, profile editing |
| Forms | `crm/forms` | Form schemas, submissions, templates, intake forms, interactive sessions, chat settings | **forms**: the schema rendered live, every field kind, rules, steps, submissions with files (paid plans) or through the media-upload capability. Not shipped: templates, interactive sessions, chat |
| FAQ | `business-management/faq-app` | Categories, question entries | **faq**: all of it |
| Site Search | `business-management/site-search` | Search, search schemas | the **site-search** capability: federated search and suggestions over the deployed verticals |
| Media Manager | `assets/media` | Files, folders, upload URLs | the **media-upload** capability (a validated Astro endpoint and a client helper); images in every seed |
| SEO | `business-management/seo` | Site tags, patterns, item tags, resolved tags, redirects | owner-editable item SEO on every Astro item page that has a Wix SEO item type (products, posts, services, events, categories) |
| Community | `crm/community` | Groups, membership, comments, reviews, moderation | Comments only, inside **blog**. Not shipped: groups, reviews |
| Loyalty Program | `crm/loyalty-program` | Points, earning rules, tiers, accounts, rewards, loyalty coupons | Not shipped |
| Online Programs | `business-management/online-programs` | Programs, sections, steps, enrollment, payment | Not shipped (a paid course a member enrolls in is pricing-plans plus gated pages, or this) |
| Locations | `business-management/locations` | Locations, default location, business schedule, special hours | Read by **bookings** and **restaurants** for their locations; not managed |
| Communication, CRM, Automations, Marketing, Payments, Get Paid, Multilingual, Notifications, Branches, Analytics, Calendar | `crm/…`, `business-management/…` | see each introduction page | Not shipped; back-office or infrastructure, driven from `wix-manage` recipes or `wix-docs` when a brief needs one |

## Where things actually live

- Meetings and Rentals ship no APIs of their own: both are Bookings with restricted field values,
  so their contracts are the Bookings ones. A rentals site also needs the Wix Bookings app installed
  (the rentals seed does it): with Rentals alone, availability for an hourly rental with several
  units answers 401 "Booking app not installed".
- Loyalty coupons (`crm/loyalty-program/rewards/coupons`) are a different resource from eCommerce
  Coupons (`business-solutions/coupons`).
- Stores categories are called Collections in Catalog V1 and Categories in Catalog V3; the shipped
  code is V3.
- SEO spans two products: the tag model is `business-management/seo`; Ads.txt and keyword
  suggestions are under `business-management/marketing/seo`.
- Badges and Followers live under `crm/members-contacts/members/activity/`, profiles under
  `members/member-management/members-about-v2`, privacy under `member-management/privacy`.
- There is no roles API and no segments API; contact labels serve segmentation.
- Stores, Coupons and Suppliers Hub have no usable introduction page; start from the menu page and
  the sub-section introductions.

## When the brief lands on "not shipped"

Say so plainly in one line, then build it on the same project and stack from the API reference
through `wix-docs` (search, then the method page), with every other rule unchanged: nothing from
memory, live data or an honest empty state, purchases through Wix. Choose the closest shipped
vertical as the base when one exists (a meetings brief starts from bookings, a loyalty brief from
members), and name the gap in the closing message.
