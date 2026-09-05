---
name: wix-manage
description: "REST recipes to configure and manage a Wix site's business solutions — stores, bookings, payments, CMS, and more. Open the matching recipe for the exact endpoint, method, and payload before calling — never guess a Wix API, never write Wix dashboard URL from memory. Routes to: stores, bookings, get-paid, CMS, contacts, forms, media, app-installation, pricing-plans, restaurants, ricos rich-content, sites, blog, calendar, domains, events, site-properties, ecommerce, marketing, google-ads, google-business-profile, analytics, accessibility, seo, dashboard-navigation."
compatibility: Requires Wix REST API access (API key or OAuth).
---

# Management Recipes Index

> **Standard call shape for every curl example across these recipes.** The `<AUTH>` placeholder in example curls is shorthand for the `Authorization` header only; body-bearing calls also need `Content-Type: application/json`.

## What Are Management Recipes?

**Management recipes are for REST API operations** that configure, set up, and manage Wix business entities on your site. These recipes use REST API calls and are designed for:

- **Site setup and configuration** — Initial setup of stores, bookings, payments, and other business apps
- **Entity management** — Creating, updating, and deleting products, services, staff members, pricing plans
- **Administrative operations** — Bulk updates, contact labeling, data migrations
- **Backend integrations** — Server-to-server automations, webhooks, data synchronization

These recipes do NOT cover frontend development or SDK usage for displaying data to users.

---

## App Installation

### [Install Wix Apps](references/app-installation/install-wix-apps.md)
Installs Wix apps on a site using Apps Installer API. Covers enabling Velo (Wix Code), app installation, and common app definition IDs.

### [List Installed Apps](references/app-installation/list-installed-apps.md)
Lists all apps installed on a site using Apps Installer API. Useful for verifying app installations before making API calls and diagnosing authorization errors.

### [App Management Dashboard Navigation](references/app-installation/app-installation-dashboard-navigation.md)
"Builds direct links to the app-management dashboard pages on manage.wix.com — the App Market and the installed-apps management page. Pairs installed apps with the List Installed Apps read API. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## SEO

### [Manage a Wix Site's SEO Tags](references/seo/manage-seo-tags.md)
Read and update the SEO tags of a Wix site at the right level — site-wide tags, page-type patterns, or one item's tags. Discover item IDs and pattern variables instead of inventing them, read before every full-replace write, and report resolved tags with the source each one came from.

### [Manage URL Redirects on a Wix Site](references/seo/manage-url-redirects.md)
"Retrieve, create, and delete URL redirects on a Wix site using the public SEO Redirects API. Covers exact and group redirects, language-scoped redirects for multilingual sites, batches of up to 500, and the change flow for a redirect that already exists. This API has no query, search, or update method: List Redirects is the only read-many. Redirects do not chain, so creating one that points at a path another redirect starts from permanently deletes that other redirect; list and check before every write."

---

## Accessibility

### [Scan a Wix Site for Accessibility Issues](references/accessibility/scan-site-accessibility.md)
Run a Wix accessibility scan for a full site, one page, or every page in any supported page collection, including products, blog posts, booking services, events, and restaurant pages. Poll the asynchronous scan to completion, report failed pages separately, retrieve prioritized findings, and use the returned fix guidance to help the user resolve and verify issues.

---

## Analytics

### [Query Site Analytics](references/analytics/query-site-analytics.md)
Retrieve a Wix site's analytics through the Semantic Model API. Covers listing semantic models, inspecting a model's schema (measures, dimensions, parameters), and querying model data with a required time interval, filters, sorting, paging, and human-readable formatting.

### [Analytics Dashboard Navigation](references/analytics/analytics-dashboard-navigation.md)
"Builds direct links to Wix Analytics dashboard pages on manage.wix.com — highlights, reports, per-domain overviews (traffic, behavior, sales, marketing), and performance insights/benchmarks. Pairs analytics data with its read API so you can answer a question via API and hand back a 'see it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Blog

### [How to Create Blog Posts](references/blog/how-to-create-blog-posts.md)
Creates and publishes blog posts using Blog Posts API. Covers resolving the required author memberId (including creating an author member when the site has none), Ricos rich content format, image upload via Media Manager, category/tag assignment, and bulk post creation.

### [Blog Dashboard Navigation](references/blog/blog-dashboard-navigation.md)
"Builds direct links to Wix Blog dashboard pages on manage.wix.com — posts list (published and draft tabs), categories, tags, writers, comment moderation, blog analytics, monetization, and settings. Pairs each main Blog entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Bookings

### [Booking Service Policy Setup](references/bookings/booking-service-policy-setup.md)
Sets up booking policies, cancellation rules, and waitlist configuration using the Services API policy fields. Covers bookingPolicy, cancellationPolicy, and waitlist settings.

### [Booking System Integration Gaps](references/bookings/booking-system-integration-gaps.md)
Documents undocumented API patterns for booking payments. Covers Bookings→Ecommerce integration, booking ID transformation to catalog items, and async payment confirmation flows.

### [Bookings Staff Setup](references/bookings/bookings-staff-setup.md)
"Creates staff members and configures custom working hours using Staff API + Calendar Events API. Critical two-step process: create staff → assign schedule → create working hours events."

### [Create and Update Booking Services](references/bookings/create-and-update-booking-services.md)
Full CRUD operations for Wix Bookings services using Services API. Covers service types (APPOINTMENT, CLASS, COURSE), pricing configuration, location setup, and schedule management.

### [Create Booking Service from Prompt](references/bookings/create-booking-service-from-prompt.md)
"Create a booking service from a user prompt — e.g. 'create a yoga class for $50', 'set up consultations for $75', 'add a personal training appointment', 'create a 6-week photography workshop', 'create a hidden free test course with 8 online sessions'. Determines the service type (APPOINTMENT, CLASS, or COURSE) and delegates to the type-specific recipe. For COURSE services with session dates/counts, follow the course recipe's separate Calendar bulkCreateEvents step; Services V2 alone does not create bookable course sessions."

### [Create Appointment Service](references/bookings/create-appointment-service.md)
"Create an appointment booking service — e.g. 'set up consultations', 'create a 1-on-1 session', 'add a personal training appointment', 'create a meeting service for $25'. Handles staff assignment (required), session duration, pricing, and 1-on-1 capacity defaults via bulkCreateServices API."

### [Create Class Service](references/bookings/create-class-service.md)
"Create a class booking service — e.g. 'create a yoga class for $50', 'set up a pilates class', 'add a group fitness session', 'create a weekly meditation class'. Handles group capacity, recurring session defaults, and pricing via bulkCreateServices API. Staff assignment is not used for classes."

### [Create Course Service](references/bookings/create-course-service.md)
"Create a course booking service — e.g. 'create a 6-week photography workshop', 'set up a training program', 'add a bootcamp course for $300', 'create a hidden free test course with 8 sessions'. Handles group capacity, full-course pricing, bulkCreateServices, and separate course session events via bulkCreateEvents. Staff assignment is not used for courses."

### [Check Bookings Availability (and Diagnose Issues)](references/bookings/diagnose-availability-issues.md)
"Answers whether an appointment-based Wix Bookings service currently has bookable availability — the primary question — and diagnoses the cause only when there's no availability or the owner asks why. To diagnose, first rules out service-level blockers the availability endpoint can't see (service hidden, online booking off), then runs DiagnoseAvailability for ordered, machine-readable staff/setup reasons, with a manual fallback for booking-policy and capacity causes. Use when someone asks whether a service has availability, or why a service shows no times / customers can't book it."

### [End-to-End Booking Flow](references/bookings/end-to-end-booking-flow.md)
Complete booking flow from service discovery to payment. Query services, check availability with Time Slots V2, create bookings, and process payment via eCommerce checkout.

### [External Calendar Integration](references/bookings/external-calendar-integration.md)
OAuth-based integration with Google Calendar, Microsoft Outlook, and Apple Calendar. Covers authentication flows, sync configuration, and bidirectional event management.

### [Multi-Resource Service Creation](references/bookings/multi-resource-service-creation.md)
Creates resource types and individual resources using Resources API. Enables services that require multiple resources (rooms + equipment + staff) with automatic allocation.

### [Bookings Dashboard Navigation](references/bookings/bookings-dashboard-navigation.md)
"Builds direct links to Wix Bookings dashboard pages on manage.wix.com — services list, edit a specific service, calendar, booking list, staff, availability, resources, and settings pages. Pairs each main Bookings entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Calendar

### [Configure Default Business Hours](references/calendar/configure-default-business-hours.md)
Uses Calendar Events API to create WORKING_HOURS events on the business schedule. Covers the critical distinction between Calendar Events API (correct) vs Site Properties API (incorrect) for setting base availability.

> Dashboard links for calendar surfaces (availability, default business hours) are in [Bookings Dashboard Navigation](references/bookings/bookings-dashboard-navigation.md).

---

## CMS

### [CMS Data Items CRUD](references/cms/cms-data-items-crud.md)
"Add, query, update, and delete items in CMS collections. Use this to insert content, bulk insert/update/patch/delete items, query with filters, and manage collection data. Key endpoints: /wix-data/v2/items, /wix-data/v2/bulk/items/*."

### [CMS Data Operations Extended](references/cms/cms-data-operations-extended.md)
Additional CMS data operations including count, upsert (bulk save), and update by filter patterns.

### [CMS eCommerce Catalog Integration](references/cms/cms-ecommerce-catalog-integration.md)
The recommended way to sell existing CMS collection items (tickets, bookings, memberships) through Wix checkout. Add the CATALOG plugin to convert any CMS collection into purchasable products with cart and payment integration.

### [CMS References And Relationships](references/cms/cms-references-and-relationships.md)
"Add, replace, or remove items from MULTI_REFERENCE fields. Use insert-references, replace-references, remove-references endpoints. Required for managing multi-reference relationships - these CANNOT be set via regular insert/update/patch operations. Also covers single references and querying with expanded references."

### [CMS Schema Management](references/cms/cms-schema-management.md)
Create and modify CMS collection structures. Covers listing collections, creating collections with fields, adding/removing fields, and updating collection settings.

### [CMS Draft & Publish Workflow (Draft Items plugin)](references/cms/cms-publishing-flow.md)
"Interact with CMS collections that gate their items behind a draft/publish workflow via the Draft Items plugin. Covers detecting the plugin, locating the paired drafts collection, reading published vs draft items, authoring/editing drafts, and publishing, unpublishing, reverting, and deleting items. Key endpoints: /wix-data/v2/items/publish-draft, /wix-data/v2/items/unpublish, /wix-data/v2/collections/add-draft-items-plugin, and the paired drafts collection referenced by draftItemsPluginOptions.draftsCollectionId."

### [CMS Dashboard Navigation](references/cms/cms-dashboard-navigation.md)
"Builds direct links to the Wix CMS (Content Manager) dashboard pages on manage.wix.com — the collections list and a specific collection's items view. Pairs collections and data items with their read APIs so you can fetch data and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Contacts

### [Bulk Delete Contacts](references/contacts/bulk-delete-contacts.md)
Deletes multiple contacts using filter-based bulk delete. Covers safe deletion patterns, GDPR compliance, soft delete alternatives, and batch processing strategies.

### [Bulk Label and Unlabel Contacts](references/contacts/bulk-label-and-unlabel-contacts.md)
Adds/removes labels from multiple contacts using Contacts API bulk operations. Covers label creation, contact filtering, batch processing, and rate limit handling.

### [Create a Contact](references/contacts/create-a-contact.md)
Creates a contact with the Contacts API. Covers the minimum identifying fields, the single-object shape of `email` and `phone`, and adding a physical address with the ISO 3166-2 subdivision format required for state, region, and province codes.

### [Update a Contact](references/contacts/update-a-contact.md)
Updates an existing contact's email, phone, name, or address with the Contacts API. Covers locating the contact when the user identifies it by name, passing its current revision, and the ISO 3166-2 subdivision format required for state, region and province codes.

### [Contacts Dashboard Navigation](references/contacts/contacts-dashboard-navigation.md)
"Builds direct links to Wix Contacts (CRM) dashboard pages on manage.wix.com — the contacts list, a specific contact's view page, contact import, and the segments page. Pairs each main contacts entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Dashboard Navigation

**Dashboard URLs are recipe data, not general knowledge.** A `manage.wix.com` route is an app-registered slug that appears in no API reference and cannot be derived from the entity's name or its API path (Forms pages live under `wix-forms`, not `contacts/forms`; Stores products under `wix-stores/products`). So for **every** request for a dashboard link — even one that needs no API call, and even when a route feels obvious — open the solution's dashboard-navigation recipe below and copy the route from its table. Answering from memory is the one failure mode these recipes exist to prevent.

### [Dashboard Navigation](references/dashboard-navigation/dashboard-navigation.md)
**Index** — for any "where do I manage X in the dashboard" / "give me a dashboard link" request: the shared URL structure for all dashboard pages (`https://manage.wix.com/dashboard/{metaSiteId}/{route}`, app-ID fallback, legacy redirects, entity deep links), routing to the per-business-solution recipes (e.g. [Bookings](references/bookings/bookings-dashboard-navigation.md), [Stores](references/stores/stores-dashboard-navigation.md)) which live in their solution's section below.

---

## Domains

### [Domain Search, Purchase and Connect](references/domains/domain-search-purchase-and-connect.md)
Buy a domain through Wix or connect one the user already owns — intent, availability, suggestions, site resolution, registration, privacy, cart and checkout, plus the connect path including ownership lookup and binding a domain to a site.

### [Domains Dashboard Navigation](references/domains/domains-dashboard-navigation.md)
"Builds direct links to the domain-management pages on manage.wix.com — the site-level domain settings page and the account-level My Domains page. Pairs domain search/purchase with its read APIs. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

### [Connect an External Domain](references/domains/connect-external-domain.md)
**Technical:** Connect a domain the user already owns elsewhere to a Wix site via pointing or nameservers, using the Connected Domains and DNS Propagation APIs. Covers correctly interpreting DNS propagation status (which does NOT mean the site is actually being served yet) and the safe order of operations for domain migrations, so you don't advise reassigning primary before the new domain is confirmed live.

---

## eCommerce

**Routing — pick the right entry point:**
- **Any sales/business improvement request** (boost sales, promotions, help my business, holiday deals, improve revenue, discounts, shipping, coupons, clearance, gift cards) → use [Recommend: eCommerce Strategy](references/ecommerce/recommend-ecommerce-strategy.md). This is the **default entry point** — it analyzes ALL domains (discounts, shipping, gift cards) and generates cross-domain recommendations. Do NOT ask clarifying questions.
- **Traffic acquisition is NOT an eCommerce-strategy request** ("grow my traffic", SEO, ads, social, content) → do NOT use Recommend: eCommerce Strategy; it only converts visitors a store already has. Route these to marketing.
- **Pricing & promotions** (coupons, discount rules, ribbons, sales) → use the [Pricing & Promotions](references/ecommerce/ecom-pricing.md) dispatcher.
- **Shipping setup** (rates, regions, pickup, free shipping, fix coverage) → use the [Shipping](references/ecommerce/ecom-shipping.md) dispatcher.
- **Gift cards** ("should I sell gift cards", "add a gift card", "what amounts should my gift card have") → these are recommendations, so they go through [Recommend: eCommerce Strategy](references/ecommerce/recommend-ecommerce-strategy.md), which activates its GIFT_CARDS domain and loads the gift-cards goal itself. Issuing/redeeming an individual gift card is the Gift Cards API, not a recommendation.

### [eCommerce: Load Context](references/ecommerce/ecom-load-context.md)
**L1 loader** — loads general site data (siteId, country, currency, industry, catalog analytics) needed by every eCommerce category. Each category dispatcher loads this before tag-matching; runs once per session.

### [Recommend: eCommerce Strategy](references/ecommerce/recommend-ecommerce-strategy.md)
**Entry point for all eCommerce recommendation requests.** Unified skill that analyzes site data across ALL domains (discounts + shipping + gift cards), generates up to 5 cross-domain recommendations, and persists them to the tracking database. Covers discount strategies (seasonal, upsell, stock mover, bundling), shipping optimization (coverage gaps, free shipping, rate strategy, carrier backup), AND selling gift cards (denominations sized from the site's own AOV and catalog prices). Use this for business improvement requests about earning more from existing visitors. **Traffic acquisition (SEO, ads, social, content) is out of scope** — route "grow my traffic" to marketing.

### [Pricing & Promotions](references/ecommerce/ecom-pricing.md)
**Dispatcher** — routes coupon/discount/sale/ribbon/bundle requests to the right leaf recipe (create coupon, create discount rule, troubleshoot discount-not-applying), and routes strategic "run a sale / boost sales" requests to `recommend-ecommerce-strategy`.

### [Shipping](references/ecommerce/ecom-shipping.md)
**Dispatcher** — routes shipping-setup requests (rates, regions, pickup, free shipping, fix coverage, optimize rates) to the right leaf recipe. The Shipping Options + Delivery Profiles APIs have no public docs page; `ecom-shipping-api.md` is the authoritative inline reference.

<details>
<summary>Internal skills (loaded automatically by the dispatchers / orchestrator above — do NOT use directly)</summary>

#### Pricing & promotions leaves (loaded by the Pricing dispatcher or by the strategy orchestrator)
- [Pricing: Create Coupon](references/ecommerce/pricing-promotions/ecom-pricing-create-coupon.md)
- [Pricing: Create Discount Rule](references/ecommerce/pricing-promotions/ecom-pricing-create-discount-rule.md)
- [Pricing: Discount Not Applying](references/ecommerce/pricing-promotions/ecom-pricing-troubleshoot-not-applying.md)
- Goals: [Increase AOV](references/ecommerce/pricing-promotions/ecom-pricing-goal-increase-aov.md), [Clear Inventory](references/ecommerce/pricing-promotions/ecom-pricing-goal-clear-inventory.md), [Seasonal Revenue](references/ecommerce/pricing-promotions/ecom-pricing-goal-seasonal-revenue.md), [Drive Cross-Sells](references/ecommerce/pricing-promotions/ecom-pricing-goal-drive-cross-sells.md)
- Flows: [Upsell Boost](references/ecommerce/pricing-promotions/ecom-pricing-flow-upsell-boost.md), [Bundle and Save](references/ecommerce/pricing-promotions/ecom-pricing-flow-bundle-and-save.md), [Stock Mover](references/ecommerce/pricing-promotions/ecom-pricing-flow-stock-mover.md), [Seasonal Promotion](references/ecommerce/pricing-promotions/ecom-pricing-flow-seasonal-promotion.md)

#### Gift-cards leaf (loaded by the strategy orchestrator when it activates the GIFT_CARDS domain)
- [Goal: Sell Gift Cards](references/ecommerce/gift-cards/ecom-gift-cards-goal-sell-gift-cards.md) — existing-product gate (one per site), eligibility, denomination sizing from AOV / catalog prices, no-expiry-by-default policy, and the mapping onto Create Gift Card Product

#### Shipping leaves (loaded by the Shipping dispatcher)
- [Set Up Rates](references/ecommerce/shipping/ecom-shipping-setup-rates.md)
- [Set Up Regions](references/ecommerce/shipping/ecom-shipping-setup-regions.md)
- [Set Up Pickup / Local Delivery](references/ecommerce/shipping/ecom-shipping-setup-pickup.md)
- [Add Free Shipping](references/ecommerce/shipping/ecom-shipping-free-shipping.md)
- [Optimize Rates](references/ecommerce/shipping/ecom-shipping-optimize-rates.md)
- [Fix Coverage Gaps](references/ecommerce/shipping/ecom-shipping-fix-coverage.md)
- [API Reference](references/ecommerce/shipping/ecom-shipping-api.md) — inline spec for Shipping Options + Delivery Profiles

#### Cross-cutting tracking
- [API: Recommendation Tracking](references/ecommerce/api-recommendation-tracking.md) — load BEFORE generating any recommendation; persists PROPOSED state and tracks MarkExecuting → MarkDone/MarkFailed.


</details>

> Dashboard links for eCommerce surfaces (orders, abandoned checkouts, gift cards, shipping, tax, checkout settings) are in [Stores Dashboard Navigation](references/stores/stores-dashboard-navigation.md).

---

## Events

### [Create an Event with the Wix Events API](references/events/create-wix-event.md)
"Creates an event with the Wix Events V3 API — the required request body, ISO-8601 date and time settings, venue/online/TBD location, RSVP vs ticketed registration, guest capacity, short vs rich-text descriptions, ticket tiers and pricing, and recurring series. Covers the exact field shapes and the API's misleading validation messages. Use when the user wants to create an event, set its date, location, description, guest limit or ticket prices, or set up a repeating event."

### [Manage Wix Events — Publishing, Cancelling, Cloning and Counting](references/events/manage-wix-events.md)
"Operates on events that already exist with the Wix Events V3 API — publishing a draft, cancelling, deleting, cloning, updating an event's date or details, and counting events. Use when the user wants to publish or cancel an event, duplicate one, move an event's date, or count their events. Creating an event, its tickets or a recurring series is a separate recipe."

---

## Forms

### [Create Form](references/forms/create-form.md)
"Creates a visitor-fillable Wix form with Form Schemas v4 — a contact or enquiry form, a signup or waitlist, an application, a survey, a quote request, and forms whose submissions create a contact. Ships a complete create request, plus the field table for every kind Wix supports — dropdown, choice, file upload, rating, address, payment, and the silent breakers that produce an empty or invisible form. Changing a form that already exists is Update Form."

### [Update Form](references/forms/update-form.md)
"Changes a Wix form that already exists, with Form Schemas v4 `PATCH` — add a field to my form, add a dropdown, make a field required or optional, rename a label, reorder or retire a question. Covers reading the form back for its `revision` (and the required `namespace` query parameter), the whole-form body that a `PATCH` needs, the wholesale `formFields` replace that silently soft-deletes anything you omit, changing a field's component type in place, retiring a field that already has submissions, and the read-back that proves what was stored. Use whenever the form exists and the request changes what it collects; use Create Form when there is no form yet."

### [Forms Dashboard Navigation](references/forms/forms-dashboard-navigation.md)
"Builds direct links to Wix Forms dashboard pages on manage.wix.com. The paths are not guessable and appear in no API reference, so take them from here: under `https://manage.wix.com/dashboard/{metaSiteId}/`, the forms list is `wix-forms`, a form's builder is `wix-forms/form/{formId}`, and that form's submissions are `wix-forms/form/{formId}/submissions` — there is no site-wide submissions page, and nothing lives under `contacts/forms`, `forms`, `form-builder` or `wix-forms-and-payments` (the legacy app). Also standalone forms, and each Forms entity paired with its read API so you can fetch one and hand back a 'view it in your dashboard' link."

---

## Get Paid

### [Create Payment Links](references/get-paid/create-payment-links.md)
Creates payment links for collecting payments without a checkout flow. Covers store products (catalog items), custom line items, variants, due dates, and sending links via email.

### [How to Setup Wix Payments](references/get-paid/how-to-setup-wix-payments.md)
Configures Wix Payments as the payment provider. Covers eligibility checking, business verification, bank account setup, and payment method configuration (cards, PayPal, Apple Pay).

### [Payment Links for Bookings](references/get-paid/payment-links-for-bookings.md)
Creates payment links for unpaid bookings using Payment Links API. Links booking IDs to payment requests with proper redirect handling.

### [Get Paid Dashboard Navigation](references/get-paid/get-paid-dashboard-navigation.md)
"Builds direct links to Wix payments and invoicing dashboard pages on manage.wix.com — payment links, invoices (list, create, settings), recurring invoices, and the accept-payments settings page. Pairs each main get-paid entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Google Ads

**Routing — Google paid-advertising campaigns for a site (Smart & Performance Max).** All flows require a Google Ads account, created once via the setup recipe. Budgets are in micros (1,000,000 = 1 currency unit). REST base: `https://www.wixapis.com/google-ads/v1`.
- **First-time setup / "connect Google Ads" / `ACCOUNT_NOT_FOUND`** → [Install and Create an Account](references/google-ads/install-and-create-account.md) (do this before anything else).
- **Suggested keywords / geo / budget / ad copy / images** → [Get AI Campaign Suggestions](references/google-ads/get-campaign-suggestions.md).
- **Offer a Success Guide after creating a PMAX Leads campaign (a proactive offer requires approval) / improve it / success guide / says they completed or fixed a guide recommendation / mark or reopen a recommendation** → [Manage a Campaign Success Guide](references/google-ads/manage-campaign-success-guide.md) (a direct improvement/guide request is already approval; works while `LEARNING` and before metrics exist).
- **Create a multi-channel / lead-gen / Shopping campaign** → [Create a Performance Max Campaign](references/google-ads/create-performance-max-campaign.md).
- **Pause / resume / launch / update budget / delete / history** → [Manage Campaign Lifecycle](references/google-ads/manage-campaign-lifecycle.md).
- **Performance, conversions, search terms, per-product / per-asset metrics** → [Query Campaign Performance Analytics](references/google-ads/query-campaign-analytics.md).
- **Ad spend, fees, upcoming charges, credit balance** → [Retrieve Billing and Payment Details](references/google-ads/billing-and-payment.md).

### [Install Google Ads and Create an Account](references/google-ads/install-and-create-account.md)
"One-time setup for running Google paid ads on a Wix site: install the Wix Google Ads app, then create the Google Ads account that every campaign, suggestion, and analytics call depends on. Covers checking whether an account already exists, choosing a currency, optionally attaching a promotional incentive (credit offer), linking a Google Merchant Center account, and deleting an account. Use when the user wants to 'set up Google Ads', 'connect Google Ads', 'start advertising on Google', 'create a Google Ads account', or hits an ACCOUNT_NOT_FOUND / app-not-installed error before creating a campaign. Google Ads REST API, base https://www.wixapis.com/google-ads/v1."

### [Get AI Campaign Suggestions for Google Ads](references/google-ads/get-campaign-suggestions.md)
"Reference for the Google Ads Suggestions API on a Wix site: AI/Google-generated inputs that help build effective campaigns — keyword themes (from a URL or autocomplete), geo-target options, low/recommended/high daily-budget tiers with estimated clicks, PMAX budget recommendations, text assets (headlines/descriptions), AI image assets (auto-uploaded to Wix Media), search themes, promotional incentive offers, and complete AI-generated campaign configurations from a campaign brief. Use when the user asks 'suggest keywords for my ads', 'what budget should I use', 'where should I target', 'generate ad copy/headlines', 'generate ad images', 'suggest a whole campaign', or when a create-campaign flow needs suggested values. REST base https://www.wixapis.com/google-ads/v1."

### [Create and Launch a Performance Max Campaign](references/google-ads/create-performance-max-campaign.md)
"Creates and launches a Google Ads Performance Max (PMAX) campaign for a Wix site — a goal-based campaign that runs across all Google channels (Search, Display, YouTube, Gmail, Discover, Maps) from an asset group of headlines, descriptions, images, and (for PMAX Leads) search-theme signals. Covers generating AI text and image assets, generating search themes, getting a Google budget recommendation, assembling the asset group with the required minimum assets, choosing PERFORMANCE_MAX vs PERFORMANCE_MAX_LEADS (leads: phone/form goals, negative keywords, 28-day learning) vs retail/Shopping (Merchant Center feed), creating in PAUSED, and launching. Use for 'create a Performance Max campaign', 'PMAX', 'run ads across all of Google', 'lead-gen Google campaign', or 'Google Shopping ads'. Requires an existing Google Ads account. REST base https://www.wixapis.com/google-ads/v1."

### [Manage Campaign Lifecycle](references/google-ads/manage-campaign-lifecycle.md)
"Manages existing Google Ads campaigns on a Wix site: list/get, launch (first activation) vs resume (reactivate after a pause), pause a running campaign — optionally with a scheduled auto-resume date — update name/budget/targeting, change the daily budget, delete permanently, and read status history / change log. Use when the user wants to 'pause my Google ad', 'resume my campaign', 'stop the campaign', 'change my daily budget', 'rename the campaign', 'delete this campaign', 'list my Google Ads campaigns', or 'why did my campaign status change'. Requires an existing Google Ads account and campaign. REST base https://www.wixapis.com/google-ads/v1."

### [Manage a Campaign Success Guide](references/google-ads/manage-campaign-success-guide.md)
"Retrieves and manages the campaign success guide for an existing Wix Google Ads Performance Max Leads campaign. Offer it after creating a supported campaign, even while it is learning or has no metrics; that proactive offer requires approval before retrieval. A direct request to improve a campaign, see what to fix next, or show the guide is already approval to retrieve it. Also use when a user reports completing or wants to reopen a guide item. Treat a clear completion report as an actionable update request even when phrased as a statement. Covers campaign selection, prioritized guide retrieval, and suggestion status updates without redundant confirmation. REST base https://www.wixapis.com/pa-platform/suggestions/v1."

### [Query Campaign Performance Analytics](references/google-ads/query-campaign-analytics.md)
"Reads performance analytics for a Google Ads campaign on a Wix site: daily performance metrics (impressions, clicks, CTR, cost, leads, phone calls) with optional previous-period comparison and trends; conversion metrics from Wix Analytics (orders, revenue, leads, CPL, ROAS); the search terms that triggered a campaign's ads; per-product shopping performance for retail campaigns; and per-asset performance (headlines, descriptions, images) for PMAX Leads. Explains when to use campaignResourceName vs the Wix campaignId, the dateRange shape, field enums, sorting, and paging. Use when the user asks 'how is my campaign doing', 'show ad performance', 'what search terms triggered my ads', 'which products/assets perform best', 'campaign ROI/ROAS', or 'conversions from my Google ads'. REST base https://www.wixapis.com/google-ads/v1."

### [Retrieve Google Ads Billing and Payment Details](references/google-ads/billing-and-payment.md)
"Retrieves billing and payment details for a Wix site's Google Ads account: the current billing period's ad spend (usage), the Wix service fee, the total charge, any promotional coupon adjustment, the billing period dates, and the account's credit balance (positive = available credits, negative = outstanding debt not yet charged). Also explains reading current vs remaining budget from the account object. Use when the user asks 'how much have I spent on Google Ads', 'what's my next Google Ads charge', 'show my ad billing', 'do I have ad credits left', 'why was I charged', or 'upcoming Google Ads payment'. Requires an existing Google Ads account. REST base https://www.wixapis.com/google-ads/v1."

### [Google Ads Dashboard Navigation](references/google-ads/google-ads-dashboard-navigation.md)
"Builds a direct link to the Wix Google Ads dashboard page on manage.wix.com, where campaigns created via the Google Ads API recipes are managed. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Google Business Profile

**Routing — how a business appears on Google Search and Maps.** A Google connection is the prerequisite for all Google-backed location work: check it first, and route "connect / reconnect / disconnect Google" to the connection recipe.

### [Connect a Wix Site to Google Business Profile](references/google-business-profile/connect-google-business-profile.md)
Connect the authenticated Wix site to a Google Business Profile account, check whether an existing connection is still usable, recover a connection whose stored credentials are gone, switch to a different Google account, or disconnect. The site owner authorizes in their own browser through a single-use connect URL; the agent never completes the Google authorization itself. Warns before any reconnect that permanently removes the site's imported locations.

### [Manage Google Business Profile Locations for a Wix Site](references/google-business-profile/manage-google-business-profile-locations.md)
Import Google Business Profile locations into the authenticated Wix site, list and query them with or without live Google data, update Wix-side and Google-side details through the correct method for each, create a new Google listing, check whether a profile is actually live on Google, and remove a location from Wix or delete its Google listing. Checks the site's Google connection first and reports a missing one as a setup step, warns before destructive or Google-visible writes, and respects Google's shared rate budget.

---

## Marketing

### [Create and Publish a Social Media Post (with AI generation)](references/marketing/create-and-publish-social-post.md)
"End-to-end flow to create a social media post, optionally generating it with AI, and publish or schedule it to a site's connected channel (Instagram, Facebook, LinkedIn, X/Twitter, TikTok, Pinterest, YouTube, Google Business Profile) using the Wix Publisher API. Can generate a full per-channel post from a free-text idea or from the site's own assets (products, blog posts, events, bookings, coupons, categories), generate caption/title suggestions, and edit an existing image with AI. Settles the post content with you first, then confirms the channel is connected, checks premium quota, creates a draft, and publishes now or schedules it. Use for 'create a post', 'generate a post from my product/idea', 'write a caption', 'caption ideas/suggestions', 'edit a post image with AI', 'post to Instagram/Facebook/TikTok', 'connect my Instagram/Pinterest/LinkedIn', or 'schedule a post'."

### [Generate a Marketing Plan and Schedule Its Posts](references/marketing/generate-and-publish-marketing-plan.md)
"End-to-end flow to generate an AI-powered social media marketing plan for a site and schedule its generated posts for publishing, using the Wix Marketing Plan API. Recommends configuring marketing settings (goal, tone, cadence, content pillars) before the first generation, generates the plan asynchronously, polls until it's ready, then schedules the DRAFT posts. Includes generating posts for additional activities. Use for 'generate a marketing plan', 'create a social media plan/calendar', or 'schedule my plan's posts' requests."

### [Marketing Dashboard Navigation](references/marketing/marketing-dashboard-navigation.md)
"Builds direct links to Wix marketing dashboard pages on manage.wix.com — the social posts hub (drafts, scheduled and published posts across connected channels), post design templates, saved designs, and the email marketing pages (campaigns list, campaign templates, campaign analytics). Pairs each main marketing entity (social post item, connected social account, marketing-plan post, email campaign) with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Media

### [Upload Media to Wix](references/media/upload-media-to-wix.md)
Uploads images and files to the Wix Media Manager using the Import File API. Covers importing from external URLs, checking file status, and using the returned wixstatic.com URL in other APIs.

### [Generate an Image with AI](references/media/generate-image-with-ai.md)
Generates an image from a text prompt with the Wix AI APIs (Runware). Returns a short-lived URL that must be imported to be kept — importing is Upload Media to Wix's job, and this recipe hands off to it. Covers choosing a model and its cost/latency/content-filter trade-off, the accepted output sizes, per-model batching limits, the AI credit each call spends, and why a content refusal arrives as a success response with no image.

---

## Pricing Plans

### [Create and Update Pricing Plans](references/pricing-plans/create-and-update-pricing-plans.md)
Creates subscription and one-time payment plans using Plans API. Covers pricing models (recurring, one-time, free), trial periods, perks configuration, and plan visibility.

### [Pricing Plans Bookings Integration](references/pricing-plans/pricing-plans-bookings-integration.md)
Links Pricing Plans to Bookings services using the Benefit Programs API. Enables package deals and memberships that grant booking access.

### [Pricing Plans Dashboard Navigation](references/pricing-plans/pricing-plans-dashboard-navigation.md)
"Builds direct links to Wix Pricing Plans dashboard pages on manage.wix.com — plans list, create a plan, edit a plan, record a manual order, and settings. Pairs each main Pricing Plans entity (plan, order) with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Restaurants

### [Wix Restaurants Setup](references/restaurants/wix-restaurants-setup.md)
Configures restaurant menus, sections, and items using Menus API. Covers menu structure (Menu → Section → Item), the two-step item modifier / modifier group flow, pricing, availability schedules, and ordering settings.

### [Restaurants Dashboard Navigation](references/restaurants/restaurants-dashboard-navigation.md)
"Builds direct links to Wix Restaurants dashboard pages on manage.wix.com — menus, menu items, the online orders board, online-ordering fulfillment settings (pickup, delivery, dine-in), the reservations list, floor plans, and reservation experience settings. Pairs each main Restaurants entity (menu, section, item, order, reservation) with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Rich Content

> **Routing rule (READ FIRST).** For every request to hand-author, output, or return Ricos / `richContent` JSON (`nodes` tree) for Blog, Stores, Events, or CMS, use the available full-documentation reading capability to retrieve and read the canonical [Author Ricos Rich Content](references/rich-content/author-ricos-rich-content.md) recipe before using API schema search, convert/validate APIs, or memory. This also applies when the user asks for JSON only.

### [Ricos Converter Service](references/rich-content/ricos-converter-service.md)
Validates and converts content between Ricos documents and HTML/Markdown/plain text using the Ricos Documents API. Covers plugin configuration, format conversion in both directions, and document validation.

### [Author Ricos Rich Content](references/rich-content/author-ricos-rich-content.md)
Authoritative recipe for hand-authoring valid Ricos rich-content JSON (the richContent/nodes tree) used across Wix Blog posts, Stores product descriptions, Events, and CMS rich-text fields. Use whenever a user asks to create, output, or return Ricos, richContent, or nodes-tree JSON; retrieve and read this full recipe before API schema search or constructing the JSON. Covers paragraphs, headings, lists, blockquotes, dividers, tables, code blocks, images, buttons, audio, video, galleries, collapsible lists, HTML embeds, inline decorations, and nesting rules.

---

## Site Properties

### [RECIPE: Change a Site's Regional Properties (Currency, Time Zone, Language) via Site Properties API](references/site-properties/change-payment-currency-site-properties.md)
"Updates the site-level payment currency (store billing currency) using Site Properties API, including the required request body shape and field mask. Covers the site time zone and primary language through the same call, whose field mask names top-level properties."

### [Site Settings Dashboard Navigation](references/site-properties/site-properties-dashboard-navigation.md)
"Builds direct links to the site-settings dashboard pages on manage.wix.com — the settings hub, website settings, and language & region. Pairs site properties with the Site Properties read API. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Sites

### [Create Site from Template](references/sites/create-site-from-template.md)
Creates new Wix sites from templates using account-level APIs. Covers template search, site creation, and publishing. Not for headless sites.

### [Create Headless Site](references/sites/create-headless-site.md)
Creates a Wix Headless site (headless business) with one account-level API call — site, Wix Business Solution apps, and a configured OAuth client.

### [Manage OAuth Apps](references/sites/manage-oauth-apps.md)
Create, read, update, and query OAuth apps for a Wix headless site. Each OAuth app's id is the client_id a frontend uses to mint anonymous visitor tokens and call Wix APIs.

### [Query Sites](references/sites/query-sites.md)
List, count, and find the sites in a Wix account. Covers the namespace filter for headless sites, counting before enumerating, cursor pagination, and resolving a site by name.

### [Read Account or Site Context](references/sites/read-site-context.md)
Probe a Wix site or account for full context in one call — installed apps by display name, locale, currency, timezone, and status. Account token + siteId targets one site; account token alone returns up to 10; site-scoped token alone returns the site it is scoped to.

### [Site Import](references/sites/site-import.md)
Drive the Wix Site Import agent to migrate an existing store or site from another platform (Shopify, WooCommerce, Magento, or any URL) into Wix, or to import from CSV/TSV export files with no source site. Use this skill whenever the user wants to import, migrate, or clone a store/site into Wix, mentions moving off Shopify/WooCommerce/Magento, or gives a source store URL and asks to bring it into Wix. Covers starting the import, polling progress, answering the agent's mid-import questions, handling deploy/failure/auth-expiry states, and sending post-deploy follow-up changes.

### [Sites Dashboard Navigation](references/sites/sites-dashboard-navigation.md)
"Builds direct links to the account-level sites pages on manage.wix.com — the My Sites list (all sites in the account) and each site's own dashboard. Pairs the site list with the Query Sites read API. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."

---

## Stores

### [Add Store Pages to Site](references/stores/add-store-pages-to-site.md)
Adds missing checkout and cart pages to a site when Stores app is installed. Used when store pages are missing after migration or setup issues.

### [Create Product (Catalog V1)](references/stores/create-product-catalog-v1.md)
Create products using the Catalog V1 Products API. Use this recipe when the site's catalog version is CATALOG_V1. Covers simple product creation, product with options, and key V1 request structure differences from V3.

### [Create Product (Catalog V3)](references/stores/create-product-catalog-v3.md)
Mandatory first recipe for every Wix Stores Catalog V3 create-product request. Before any mutation, require an explicit name and price for every product; an absent price is never 0. If no product is identified, offer both image-upload and text-description paths and stop. If name or price is missing, ask or offer a suggestion and stop. When both are present, create from the supplied details without requiring optional enrichment. Covers single/bulk creation, inventory, physical/digital products, images, options, variants, SKUs, and validation.

### [Find Products (Query and Search, Catalog V3)](references/stores/find-products-query-and-search-catalog-v3.md)
Find, search, query, and list products from a Wix Store using Catalog V3 Search Products and Query Products endpoints. Explains when to use each endpoint, correct fields enum values, filtering (including by price), sorting, and paging.

### [Query Products (Catalog V1)](references/stores/query-products-catalog-v1.md)
Query and list products from a Wix Store using the Catalog V1 Query Products endpoint. Use this recipe when the site's catalog version is CATALOG_V1. Covers basic queries, filtering, sorting, and paging.

### [Update Product Pre-Order (Catalog V3)](references/stores/update-product-pre-order.md)
Manages pre-order settings for product variants using V3 Inventory API. Covers enabling/disabling pre-orders, setting messages, configuring limits, and handling trackQuantity requirements.

### [Update Product with Options (Catalog V3)](references/stores/update-product-with-options.md)
Modifies existing products and variants using Catalog V3 Products API. Covers adding/removing option choices, variant-specific pricing, product visibility (hide, unhide, or show a product in the storefront — a product-level `visible` update, never a delete), and revision-based updates to prevent conflicts.

### [Stores Dashboard Navigation](references/stores/stores-dashboard-navigation.md)
"Builds direct links to Wix Stores and eCommerce dashboard pages on manage.wix.com — products list, edit a specific product, categories, inventory, orders list, a specific order, abandoned checkouts, gift cards, shipping and tax settings. Pairs each main Stores/eCommerce entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
