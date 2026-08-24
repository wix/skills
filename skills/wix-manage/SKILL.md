---
name: wix-manage
description: "Wix business solution management recipes — REST API operations for configuring and managing Wix business solutions. Routes to: stores, bookings, get-paid, CMS, contacts, forms, media, app-installation, pricing-plans, restaurants, ricos rich-content, sites, blog, calendar, domains, events, site-properties, ecommerce, marketing, google-ads, analytics, accessibility, seo, dashboard-navigation."
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
**Technical:** Installs Wix apps on a site using Apps Installer API. Covers enabling Velo (Wix Code), app installation, and common app definition IDs.

### [List Installed Apps](references/app-installation/list-installed-apps.md)
**Technical:** Lists all apps installed on a site using Apps Installer API. Useful for verifying app installations before making API calls and diagnosing authorization errors.

### [App Management Dashboard Navigation](references/app-installation/app-installation-dashboard-navigation.md)
**Technical:** Direct links to the App Market and installed-apps management dashboard pages on manage.wix.com, paired with the List Installed Apps read API.

---

## SEO

### [Manage a Wix Site's SEO Tags](references/seo/manage-seo-tags.md)
**Technical:** Reads and writes SEO tags (titles, descriptions, social tags, structured data, indexing) at three levels: site-wide, page-type patterns, and individual items. Always read before write — every Set replaces in full.

### [Manage URL Redirects on a Wix Site](references/seo/manage-url-redirects.md)
**Technical:** Reads, creates, and deletes URL redirects through the public SEO Redirects API. Distinguishes exact from group redirects, handles language-scoped redirects on multilingual sites, reads per-item results from bulk responses, and confirms before writes, because creating a redirect can permanently delete an existing one.

---

## Accessibility

### [Scan a Wix Site for Accessibility Issues](references/accessibility/scan-site-accessibility.md)
**Technical:** Runs an asynchronous accessibility scan for a full site, one page, or every page in any supported Wix page collection. Discovers collection IDs instead of hardcoding verticals, polls the scan to completion, separates failed pages from clean pages, and returns prioritized, agent-friendly findings and fix guidance.

---

## Analytics

### [Query Site Analytics](references/analytics/query-site-analytics.md)
**Technical:** Reads a site's analytics through the Semantic Model API. Covers listing semantic models, inspecting a model's schema (measures, dimensions, parameters), and querying data with a required time interval, filters, sorting, paging, and human-readable formatting. Key endpoints: /analytics/semantic-model/v3/semantic-models, /semantic-models/{id}, /semantic-models/query-data.

### [Analytics Dashboard Navigation](references/analytics/analytics-dashboard-navigation.md)
**Technical:** Direct links to Wix Analytics dashboard pages on manage.wix.com (highlights, reports, custom reports, traffic/behavior/sales/marketing overviews, performance insights, benchmarks), paired with the Semantic Model read API for "see it in your dashboard" links.

---

## Blog

### [How to Create Blog Posts](references/blog/how-to-create-blog-posts.md)
**Technical:** Creates and publishes blog posts using Blog Posts API. Covers resolving the required author memberId (including creating an author member when the site has none), Ricos rich content format, image upload via Media Manager, category/tag assignment, and bulk post creation.

### [Blog Dashboard Navigation](references/blog/blog-dashboard-navigation.md)
**Technical:** Direct links to Wix Blog dashboard pages on manage.wix.com (posts list with published/draft tabs, categories, tags, writers, comments, analytics, monetization, settings), pairing each main Blog entity with its read API for "view it in your dashboard" links.

---

## Bookings

### [Booking Service Policy Setup](references/bookings/booking-service-policy-setup.md)
**Technical:** Sets up booking policies, cancellation rules, and waitlist configuration using the Services API policy fields. Covers bookingPolicy, cancellationPolicy, and waitlist settings.

### [Booking System Integration Gaps](references/bookings/booking-system-integration-gaps.md)
**Technical:** Documents undocumented API patterns for booking payments. Covers Bookings→Ecommerce integration, booking ID transformation to catalog items, and async payment confirmation flows.

### [Bookings Staff Setup](references/bookings/bookings-staff-setup.md)
**Technical:** Creates staff members and configures custom working hours using Staff API + Calendar Events API. Critical two-step process: create staff → assign schedule → create working hours events.

### [Create and Update Booking Services](references/bookings/create-and-update-booking-services.md)
**Technical:** Full CRUD operations for Wix Bookings services using Services API. Covers service types (APPOINTMENT, CLASS, COURSE), pricing configuration, location setup, and schedule management.

### [Create Booking Service from Prompt](references/bookings/create-booking-service-from-prompt.md)
**Technical:** Use when the user wants to create a booking service — e.g. "create a yoga class for $50", "set up consultations", "add a personal training appointment", "create a hidden free test course with 8 sessions". Routes to the correct type-specific recipe (APPOINTMENT, CLASS, or COURSE), gathers business context, applies defaults, and creates the service. For COURSE services with session dates/counts, the course is not bookable until separate Calendar Events are created on the returned service schedule.

### [Create Appointment Service](references/bookings/create-appointment-service.md)
**Technical:** Use when the user wants to create an appointment/consultation/1-on-1 service — e.g. "set up consultations for $75", "create a meeting service". Handles staff assignment, session duration, and pricing via bulkCreateServices API.

### [Create Class Service](references/bookings/create-class-service.md)
**Technical:** Use when the user wants to create a group class — e.g. "create a yoga class for $50", "set up a pilates class". Handles group capacity, recurring sessions, and pricing via bulkCreateServices API.

### [Create Course Service](references/bookings/create-course-service.md)
**Technical:** Use when the user wants to create a multi-session COURSE — e.g. "create a 6-week workshop", "set up a training program for $300", "create a hidden free test course with 8 online sessions". Handles group capacity, full-course pricing, `bulkCreateServices`, then creates bookable course session events with Calendar `bulkCreateEvents` using the returned `service.schedule.id`. Never put session dates under `course.sessions` in the Services V2 payload.

### [Check Bookings Availability (and Diagnose Issues)](references/bookings/diagnose-availability-issues.md)
**Technical:** Use when someone asks whether an appointment-based service has bookable availability, or why it shows no times / "customers can't book". Reports the current availability status first (via ListAvailabilityTimeSlots); diagnoses the cause only when there's no availability or the owner asks why — ruling out service-level blockers (hidden / online booking off), then running DiagnoseAvailability (`POST /v2/time-slots/diagnose`) for ordered reason codes, with a policy/capacity fallback.

### [End-to-End Booking Flow](references/bookings/end-to-end-booking-flow.md)
**Technical:** Complete booking flow from service discovery to payment. Query services, check availability with Time Slots V2, create bookings, and process payment via eCommerce checkout.

### [External Calendar Integration](references/bookings/external-calendar-integration.md)
**Technical:** OAuth-based integration with Google Calendar, Microsoft Outlook, and Apple Calendar. Covers authentication flows, sync configuration, and bidirectional event management.

### [Multi-Resource Service Creation](references/bookings/multi-resource-service-creation.md)
**Technical:** Creates resource types and individual resources using Resources API. Enables services that require multiple resources (rooms + equipment + staff) with automatic allocation.

### [Bookings Dashboard Navigation](references/bookings/bookings-dashboard-navigation.md)
**Technical:** Direct links to Wix Bookings dashboard pages on manage.wix.com (services list, edit service, calendar, booking list, staff, availability, resources, settings), pairing each main Bookings entity with its read API for "view it in your dashboard" links.

---

## Calendar

### [Configure Default Business Hours](references/calendar/configure-default-business-hours.md)
**Technical:** Uses Calendar Events API to create WORKING_HOURS events on the business schedule. Covers the critical distinction between Calendar Events API (correct) vs Site Properties API (incorrect) for setting base availability.

> Dashboard links for calendar surfaces (availability, default business hours) are in [Bookings Dashboard Navigation](references/bookings/bookings-dashboard-navigation.md).

---

## CMS

### [CMS Data Items CRUD](references/cms/cms-data-items-crud.md)
**Technical:** Add, query, update, and delete items in CMS collections. Use this to insert content, bulk insert/update/patch/delete items, query with filters, and manage collection data. Key endpoints: /wix-data/v2/items, /wix-data/v2/bulk/items/*.

### [CMS Data Operations Extended](references/cms/cms-data-operations-extended.md)
**Technical:** Additional CMS data operations including count, upsert (bulk save), and update by filter patterns.

### [CMS eCommerce Catalog Integration](references/cms/cms-ecommerce-catalog-integration.md)
**Technical:** The recommended way to sell existing CMS collection items (tickets, bookings, memberships) through Wix checkout. Add the CATALOG plugin to convert any CMS collection into purchasable products with cart and payment integration.

### [CMS References & Relationships](references/cms/cms-references-and-relationships.md)
**Technical:** Add, replace, or remove items from MULTI_REFERENCE fields. Use insert-references, replace-references, remove-references endpoints. Required for managing multi-reference relationships - these CANNOT be set via regular insert/update/patch operations. Also covers single references and querying with expanded references.

### [CMS Schema Management](references/cms/cms-schema-management.md)
**Technical:** Create and modify CMS collection structures. Covers listing collections, creating collections with fields, adding/removing fields, and updating collection settings.

### [CMS Publishing Flow & Visible/Hidden](references/cms/cms-publishing-flow.md)
**Technical:** Interact with collections that gate items behind a draft/publish workflow — Visible/Hidden and Publishing Flow (Review, with DRAFT/PUBLISHED/CHANGED states). Detect the mode, read the combined draft+live view (`publishPluginOptions.includeDraftItems`), author/edit drafts against the `<collectionId>__drafts` shadow, and publish/unpublish/revert/delete items. Key endpoints: /wix-data/v2/items/publish-draft, /wix-data/v2/items/unpublish, /wix-data/v2/collections/add-plugin.

### [CMS Dashboard Navigation](references/cms/cms-dashboard-navigation.md)
**Technical:** Direct links to the Wix CMS (Content Manager) dashboard pages on manage.wix.com (collections list, a specific collection's items view), pairing collections and data items with their read APIs for "view it in your dashboard" links.

---

## Contacts

### [Bulk Delete Contacts](references/contacts/bulk-delete-contacts.md)
**Technical:** Deletes multiple contacts using filter-based bulk delete. Covers safe deletion patterns, GDPR compliance, soft delete alternatives, and batch processing strategies.

### [Bulk Label and Unlabel Contacts](references/contacts/bulk-label-and-unlabel-contacts.md)
**Technical:** Adds/removes labels from multiple contacts using Contacts API bulk operations. Covers label creation, contact filtering, batch processing, and rate limit handling.

### [Create a Contact](references/contacts/create-a-contact.md)
**Technical:** Creates a contact in one Contacts API call. Covers the minimum identifying fields, the single-object shape of `email` and `phone` (a list is accepted and silently discarded), optionally attaching a physical address, and the ISO 3166-2 `subdivision` format (`US-NY`, not `NY`) that state, region and province codes are validated against.

### [Update a Contact](references/contacts/update-a-contact.md)
**Technical:** Updates an existing contact's email, phone, name or address. Covers locating the contact with Search Contacts when the user names it (Query Contacts cannot filter by name), passing the current `revision`, appending an address via the contact's `addresses` sub-resource, and the ISO 3166-2 `subdivision` format (`US-NY`, not `NY`).

### [Contacts Dashboard Navigation](references/contacts/contacts-dashboard-navigation.md)
**Technical:** Direct links to Wix Contacts (CRM) dashboard pages on manage.wix.com (contacts list, view a specific contact, contact import, segments), pairing each main contacts entity with its read API for "view it in your dashboard" links.

---

## Dashboard Navigation

### [Dashboard Navigation](references/dashboard-navigation/dashboard-navigation.md)
**Index** — for any "where do I manage X in the dashboard" / "give me a dashboard link" request: the shared URL structure for all dashboard pages (`https://manage.wix.com/dashboard/{metaSiteId}/{route}`, app-ID fallback, legacy redirects, entity deep links), routing to the per-business-solution recipes (e.g. [Bookings](references/bookings/bookings-dashboard-navigation.md), [Stores](references/stores/stores-dashboard-navigation.md)) which live in their solution's section below.

---

## Domains

### [Domain Search, Purchase and Connect](references/domains/domain-search-purchase-and-connect.md)
**Technical:** Purchase domains, connect domains to Wix sites, search for available domains and get domain suggestions. Covers availability checks, TLD filtering, purchase flow and connecting domains to Wix sites.

### [Domains Dashboard Navigation](references/domains/domains-dashboard-navigation.md)
**Technical:** Direct links to the site-level domain settings page and the account-level My Domains page on manage.wix.com, paired with the Domain Search read APIs.

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

### [Create Event](references/events/create-wix-event.md)
**Technical:** Creates an event with the Wix Events V3 API — required request body, ISO-8601 date and time settings, venue/online/TBD location and street addresses, RSVP vs ticketed registration, guest capacity, short vs Ricos rich-text descriptions, ticket tiers and pricing, and recurring series from explicit occurrence dates. Distinguishes Wix Events from the Calendar, Marketing Calendar and Automations APIs that share the "events" name. Key endpoints: /events/v3/events, /events/v3/ticket-definitions.

### [Manage Events](references/events/manage-wix-events.md)
**Technical:** Operates on events that already exist with the Wix Events V3 API — publishing a draft, cancelling, deleting, cloning, updating an event's date, and counting events, plus the draft-event permission that makes those calls fail with 403. Key endpoint: /events/v3/events.

---

## Forms

### [Create Form](references/forms/create-form.md)
**Technical:** Creates a form with fields (name, email, etc.) using the Form Schemas API. Covers field configuration, layout, and post-submission triggers.

### [Forms Dashboard Navigation](references/forms/forms-dashboard-navigation.md)
**Technical:** Direct links to Wix Forms dashboard pages on manage.wix.com (forms list, submissions table, form builder for a specific form, standalone forms, templates, settings), pairing forms and submissions with their read APIs for "view it in your dashboard" links.

---

## Get Paid

### [Create Payment Links](references/get-paid/create-payment-links.md)
**Technical:** Creates payment links for collecting payments without a checkout flow. Covers store products (catalog items), custom line items, variants, due dates, and sending links via email.

### [How to Setup Wix Payments](references/get-paid/how-to-setup-wix-payments.md)
**Technical:** Configures Wix Payments as the payment provider. Covers eligibility checking, business verification, bank account setup, and payment method configuration (cards, PayPal, Apple Pay).

### [Payment Links for Bookings](references/get-paid/payment-links-for-bookings.md)
**Technical:** Creates payment links for unpaid bookings using Payment Links API. Links booking IDs to payment requests with proper redirect handling.

### [Get Paid Dashboard Navigation](references/get-paid/get-paid-dashboard-navigation.md)
**Technical:** Direct links to payments and invoicing dashboard pages on manage.wix.com (payment links, invoices list, new invoice, invoice settings, recurring invoices, accept-payments settings), pairing each get-paid entity with its read API for "view it in your dashboard" links.

---

## Google Ads

**Routing — Google paid-advertising campaigns for a site (Smart & Performance Max).** All flows require a Google Ads account, created once via the setup recipe. Budgets are in micros (1,000,000 = 1 currency unit). REST base: `https://www.wixapis.com/google-ads/v1`.
- **First-time setup / "connect Google Ads" / `ACCOUNT_NOT_FOUND`** → [Install and Create an Account](references/google-ads/install-and-create-account.md) (do this before anything else).
- **Suggested keywords / geo / budget / ad copy / images** → [Get AI Campaign Suggestions](references/google-ads/get-campaign-suggestions.md).
- **Create a multi-channel / lead-gen / Shopping campaign** → [Create a Performance Max Campaign](references/google-ads/create-performance-max-campaign.md).
- **Pause / resume / launch / update budget / delete / history** → [Manage Campaign Lifecycle](references/google-ads/manage-campaign-lifecycle.md).
- **Performance, conversions, search terms, per-product / per-asset metrics** → [Query Campaign Performance Analytics](references/google-ads/query-campaign-analytics.md).
- **Ad spend, fees, upcoming charges, credit balance** → [Retrieve Billing and Payment Details](references/google-ads/billing-and-payment.md).

### [Install Google Ads and Create an Account](references/google-ads/install-and-create-account.md)
**Technical:** One-time setup prerequisite for all Google Ads flows. Installs the Wix Google Ads app (`POST /v1/install-if-not-installed`) then creates the linked account (`POST /v1/accounts` with `currency`). Covers checking for an existing account (`GET /v1/accounts/current-site`, empty when none), optional promotional incentives, Merchant Center linking, and account deletion.

### [Get AI Campaign Suggestions for Google Ads](references/google-ads/get-campaign-suggestions.md)
**Technical:** Read-only Suggestions API reference — keyword themes, geo options, Smart budget tiers, PMAX budget recommendations, text/image assets, search themes, full AI campaign configs from a campaign brief (`POST /v1/campaign-suggestions`), and promotional incentive offers. Budgets in micros; generation endpoints have 60–120s SLAs.

### [Create and Launch a Performance Max Campaign](references/google-ads/create-performance-max-campaign.md)
**Technical:** Creates and launches a PMAX campaign — `PERFORMANCE_MAX`, `PERFORMANCE_MAX_LEADS`, or retail/Shopping. Generates AI text/image assets and search themes, gets a Google budget recommendation, assembles an asset group meeting Google's minimum asset counts (headlines/descriptions/images), creates in `PAUSED`, then launches. Bidding is server-enforced to `MAXIMIZE_CONVERSIONS`.

### [Manage Campaign Lifecycle](references/google-ads/manage-campaign-lifecycle.md)
**Technical:** Lists/gets campaigns and runs lifecycle actions: launch (first activation) vs resume (reactivate after pause), pause (with optional `scheduledResumeDate`/reminder), partial `UpdateCampaign` (name, budget, targeting), delete (irreversible), and read the change log / status history. Covers the 5-live-campaign cap and budget-boundary validation.

### [Query Campaign Performance Analytics](references/google-ads/query-campaign-analytics.md)
**Technical:** Reads campaign analytics via six endpoints — daily performance metrics (with previous-period trends), conversion metrics (orders/revenue/ROAS from Wix), search terms, per-product shopping performance, and per-asset PMAX-Leads metrics. Explains `campaignResourceName` vs Wix `campaignId`, the `dateRange` shape, field enums, sorting, and paging.

### [Retrieve Google Ads Billing and Payment Details](references/google-ads/billing-and-payment.md)
**Technical:** Reads billing for the site's Google Ads account (`GET /v1/payment-details`, 30s SLA): current-period ad spend (`usageAmount`), Wix service fee, coupon adjustment, `totalAmount`, billing period, and `creditBalance` (positive = credits, negative = debt). Contrasts with the account's `currentBudget`/`spentBudget`.

### [Google Ads Dashboard Navigation](references/google-ads/google-ads-dashboard-navigation.md)
**Technical:** Direct link to the Wix Google Ads dashboard page on manage.wix.com where API-created campaigns are managed.

---

## Marketing

### [Create and Publish a Social Media Post (with AI generation)](references/marketing/create-and-publish-social-post.md)
**Technical:** Creates and publishes (or schedules) a social media post to a connected channel (Instagram, Facebook, LinkedIn, TikTok, Pinterest, YouTube, Google Business Profile) via the Publisher API. Optionally generates the whole post from a free-text idea or the site's own assets (products, blog posts, events, bookings, coupons, categories), generates caption/title suggestions, and edits an existing image with AI. Verifies the channel is connected (and runs the OAuth connect flow if not), checks premium publishing quota, creates a draft item, then publishes it immediately or schedules it for a future date. Use when the user wants to create, generate, write, post, or schedule a social post, wants caption ideas or suggestions, or wants to connect a social channel (e.g. "post this to Instagram", "make a post from my product", "write a caption", "give me caption ideas", "connect my Pinterest", "schedule a post").

### [Generate a Marketing Plan and Schedule Its Posts](references/marketing/generate-and-publish-marketing-plan.md)
**Technical:** Generates a site's AI social media marketing plan (a calendar of marketing activities, each with per-channel post drafts) via the Marketing Plan API, then schedules the drafts for publishing. Covers optional marketing settings (goal, channels, tone, frequency, content pillars), asynchronous generation with polling, and generating posts for additional activities. Use for "generate a marketing plan", "create a social media plan/calendar", or "schedule my plan's posts".

### [Marketing Dashboard Navigation](references/marketing/marketing-dashboard-navigation.md)
**Technical:** Direct links to Wix marketing dashboard pages on manage.wix.com (social posts hub with drafts/scheduled/published posts, post design templates, saved designs, email campaigns list, campaign templates, campaign analytics), pairing each main marketing entity with its read API for "view it in your dashboard" links.

---

## Media

### [Upload Media to Wix](references/media/upload-media-to-wix.md)
**Technical:** Uploads images and files to the Wix Media Manager using the Import File API. Covers importing from external URLs, checking file status, and using the returned wixstatic.com URL in other APIs.

---

## Pricing Plans

### [Create and Update Pricing Plans](references/pricing-plans/create-and-update-pricing-plans.md)
**Technical:** Creates subscription and one-time payment plans using Plans API. Covers pricing models (recurring, one-time, free), trial periods, perks configuration, and plan visibility.

### [Pricing Plans Bookings Integration](references/pricing-plans/pricing-plans-bookings-integration.md)
**Technical:** Links Pricing Plans to Bookings services using the Benefit Programs API. Enables package deals and memberships that grant booking access.

### [Pricing Plans Dashboard Navigation](references/pricing-plans/pricing-plans-dashboard-navigation.md)
**Technical:** Direct links to Wix Pricing Plans dashboard pages on manage.wix.com (plans list, create plan, edit plan, new manual order, settings), pairing each main Pricing Plans entity with its read API for "view it in your dashboard" links.

---

## Restaurants

### [Wix Restaurants Setup](references/restaurants/wix-restaurants-setup.md)
**Technical:** Configures restaurant menus, sections, and items using Menus API. Covers menu structure (Menu → Section → Item), the two-step item modifier / modifier group flow, pricing, availability schedules, and ordering settings.

### [Restaurants Dashboard Navigation](references/restaurants/restaurants-dashboard-navigation.md)
**Technical:** Direct links to Wix Restaurants dashboard pages on manage.wix.com (menus, edit menu, items, online orders board, online-ordering fulfillment settings, reservations list, floor plans, reservation experiences), pairing each main Restaurants entity with its read API for "view it in your dashboard" links.

---

## Rich Content

> **Routing rule (READ FIRST).** For every request to hand-author, output, or return Ricos / `richContent` JSON (`nodes` tree) for Blog, Stores, Events, or CMS, use the available full-documentation reading capability to retrieve and read the canonical [Author Ricos Rich Content](references/rich-content/author-ricos-rich-content.md) recipe before using API schema search, convert/validate APIs, or memory. This also applies when the user asks for JSON only.

### [Ricos Converter Service](references/rich-content/ricos-converter-service.md)
**Technical:** Validates and converts content between Ricos documents and HTML/Markdown/plain text using the Ricos Documents API. Covers plugin configuration, format conversion in both directions, and document validation.

### [Author Ricos Rich Content](references/rich-content/author-ricos-rich-content.md)
**Technical:** Required first source for every request to hand-author, output, or return Ricos / `richContent` JSON (`nodes` tree) for Blog, Stores, Events, or CMS. Retrieve and read this full article before API schema search or constructing the JSON. Covers node shapes — paragraphs, headings, lists, blockquotes, dividers, tables with cell fills, code blocks, images, buttons, audio, video, galleries, collapsible lists, HTML embeds — plus inline text decorations (including spoiler) and nesting rules.

---

## Site Properties

### [Change Payment Currency](references/site-properties/change-payment-currency-site-properties.md)
**Technical:** Updates the site-level payment currency (store billing currency) using Site Properties API, including the required request body shape and field mask. Also covers the site time zone and primary language, which use the same field-mask PATCH with top-level field names — not nested `locale.*` paths.

### [Site Settings Dashboard Navigation](references/site-properties/site-properties-dashboard-navigation.md)
**Technical:** Direct links to the site-settings dashboard pages on manage.wix.com (settings hub, website settings, language & region), paired with the Site Properties read API.

---

## Sites

### [Create Site from Template](references/sites/create-site-from-template.md)
**Technical:** Creates new Wix sites from templates using account-level APIs. Covers template search, site creation, and publishing. Not for headless sites.

### [Create Headless Site](references/sites/create-headless-site.md)
**Technical:** Creates a Wix Headless site (headless business) with one account-level API call — site, Wix Business Solution apps, and a configured OAuth client.

### [Manage OAuth Apps](references/sites/manage-oauth-apps.md)
**Technical:** Create, read, update, and query OAuth apps for a Wix headless site. Each OAuth app's `id` is the `client_id` for frontends connecting to the site's Wix APIs. Secret and rotation are dashboard-only.

### [Query Sites](references/sites/query-sites.md)
**Technical:** Lists and queries all sites associated with a Wix account using Sites API. Covers pagination with cursor-based navigation.

### [Read Account or Site Context](references/sites/read-site-context.md)
**Technical:** One call that returns a site's installed apps (by display name), locale, currency, status, and catalog version. Replaces separate query-sites + list-installed-apps + site-properties calls. Use this first on any unfamiliar site to decide which management recipes to follow.

### [Site Import](references/sites/site-import.md)
**Technical:** Drives the autonomous Wix Site Import agent over REST (`/site-import/v1/imports`) to migrate a store/site from another platform (Shopify, WooCommerce, Magento, or any URL) into Wix. Covers Start/Poll/Reply/Cancel, relaying agent questions and progress in plain language, handling `DEPLOYED`/`FAILED`/`AUTH_EXPIRED`/`SESSION_EXPIRED` states, and post-deploy follow-up changes. Use when the user wants to import, migrate, or clone an existing store/site into Wix.

### [Sites Dashboard Navigation](references/sites/sites-dashboard-navigation.md)
**Technical:** Direct links to the account-level My Sites list (manage.wix.com/account/websites) and per-site dashboard homes, paired with the Query Sites read API.

---

## Stores

### [Add Store Pages to Site](references/stores/add-store-pages-to-site.md)
**Technical:** Adds missing checkout and cart pages to a site when Stores app is installed. Used when store pages are missing after migration or setup issues.

### [Create Product (Catalog V1)](references/stores/create-product-catalog-v1.md)
**Technical:** Create products using the Catalog V1 Products API. Use this recipe when the site's catalog version is CATALOG_V1. Covers simple product creation, product with options, and key V1 request structure differences from V3.

### [Create Product (Catalog V3)](references/stores/create-product-catalog-v3.md)
**Technical:** **Mandatory first read for every Catalog V3 create-product request, including vague requests.** Before any other documentation or API tool, load exactly `https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/create-product-catalog-v3`. When no product is identified, that recipe read must be the final tool call; respond only: “What product would you like to create? You can upload up to 3 images and I’ll generate the product information from them, or describe the product in text.” Then stop. **Never replace this with a list or questions for name, price, description, type, images, inventory, SKU, options, SEO, or other fields.** If name or price is missing, ask for it or offer to suggest it, then stop. When name and price are present, create from supplied details without requiring optional enrichment. Never default price to `0`. The recipe owns single/bulk endpoint choice, inventory, physical/digital products, images, options, variants, prices, SKUs, limits, and validation.

### [Find Products (Query and Search, Catalog V3)](references/stores/find-products-query-and-search-catalog-v3.md)
**Technical:** Find, search, query, and list products from a Wix Store using Catalog V3 Search Products and Query Products endpoints. Explains when to use each endpoint, correct fields enum values, filtering, sorting, and paging.

### [Query Products (Catalog V1)](references/stores/query-products-catalog-v1.md)
**Technical:** Query and list products from a Wix Store using the Catalog V1 Query Products endpoint. Use this recipe when the site's catalog version is CATALOG_V1. Covers basic queries, filtering, sorting, and paging.

### [Update Product Pre-Order](references/stores/update-product-pre-order.md)
**Technical:** Manages pre-order settings for product variants using V3 Inventory API. Covers enabling/disabling pre-orders, setting messages, configuring limits, and handling trackQuantity requirements.

### [Update Product with Options](references/stores/update-product-with-options.md)
**Technical:** Modifies existing products and variants using Catalog V3 Products API. Covers adding/removing option choices, variant-specific pricing, and revision-based updates to prevent conflicts.

### [Stores Dashboard Navigation](references/stores/stores-dashboard-navigation.md)
**Technical:** Direct links to Wix Stores and eCommerce dashboard pages on manage.wix.com (products list, edit product, categories, inventory, orders list, order details, abandoned checkouts, gift cards, shipping, tax), pairing each main Stores/eCommerce entity with its read API for "view it in your dashboard" links.
