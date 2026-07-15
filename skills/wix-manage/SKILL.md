---
name: wix-manage
description: "Wix business solution management recipes — REST API operations for configuring and managing Wix business solutions. Routes to: stores, bookings, get-paid, CMS, contacts, forms, media, app-installation, pricing-plans, restaurants, rich-content, sites, blog, calendar, domains, site-properties, ecommerce, marketing, analytics."
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

---

## Analytics

### [Query Site Analytics](references/analytics/query-site-analytics.md)
**Technical:** Reads a site's analytics through the Semantic Model API. Covers listing semantic models, inspecting a model's schema (measures, dimensions, parameters), and querying data with a required time interval, filters, sorting, paging, and human-readable formatting. Key endpoints: /analytics/semantic-model/v3/semantic-models, /semantic-models/{id}, /semantic-models/query-data.

---

## Blog

### [How to Create Blog Posts](references/blog/how-to-create-blog-posts.md)
**Technical:** Creates and publishes blog posts using Blog Posts API. Covers Ricos rich content format, image upload via Media Manager, category/tag assignment, and bulk post creation.

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
**Technical:** Use when the user wants to create a booking service — e.g. "create a yoga class for $50", "set up consultations", "add a personal training appointment". Routes to the correct type-specific recipe (APPOINTMENT, CLASS, or COURSE), gathers business context, applies defaults, and creates the service.

### [Create Appointment Service](references/bookings/create-appointment-service.md)
**Technical:** Use when the user wants to create an appointment/consultation/1-on-1 service — e.g. "set up consultations for $75", "create a meeting service". Handles staff assignment, session duration, and pricing via bulkCreateServices API.

### [Create Class Service](references/bookings/create-class-service.md)
**Technical:** Use when the user wants to create a group class — e.g. "create a yoga class for $50", "set up a pilates class". Handles group capacity, recurring sessions, and pricing via bulkCreateServices API.

### [Create Course Service](references/bookings/create-course-service.md)
**Technical:** Use when the user wants to create a multi-session course — e.g. "create a 6-week workshop", "set up a training program for $300". Handles group capacity, full-course pricing, and fixed series via bulkCreateServices API.

### [Check Bookings Availability (and Diagnose Issues)](references/bookings/diagnose-availability-issues.md)
**Technical:** Use when someone asks whether an appointment-based service has bookable availability, or why it shows no times / "customers can't book". Reports the current availability status first (via ListAvailabilityTimeSlots); diagnoses the cause only when there's no availability or the owner asks why — ruling out service-level blockers (hidden / online booking off), then running DiagnoseAvailability (`POST /v2/time-slots/diagnose`) for ordered reason codes, with a policy/capacity fallback.

### [End-to-End Booking Flow](references/bookings/end-to-end-booking-flow.md)
**Technical:** Complete booking flow from service discovery to payment. Query services, check availability with Time Slots V2, create bookings, and process payment via eCommerce checkout.

### [External Calendar Integration](references/bookings/external-calendar-integration.md)
**Technical:** OAuth-based integration with Google Calendar, Microsoft Outlook, and Apple Calendar. Covers authentication flows, sync configuration, and bidirectional event management.

### [Multi-Resource Service Creation](references/bookings/multi-resource-service-creation.md)
**Technical:** Creates resource types and individual resources using Resources API. Enables services that require multiple resources (rooms + equipment + staff) with automatic allocation.

---

## Calendar

### [Configure Default Business Hours](references/calendar/configure-default-business-hours.md)
**Technical:** Uses Calendar Events API to create WORKING_HOURS events on the business schedule. Covers the critical distinction between Calendar Events API (correct) vs Site Properties API (incorrect) for setting base availability.

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

---

## Contacts

### [Bulk Delete Contacts](references/contacts/bulk-delete-contacts.md)
**Technical:** Deletes multiple contacts using filter-based bulk delete. Covers safe deletion patterns, GDPR compliance, soft delete alternatives, and batch processing strategies.

### [Bulk Label and Unlabel Contacts](references/contacts/bulk-label-and-unlabel-contacts.md)
**Technical:** Adds/removes labels from multiple contacts using Contacts API bulk operations. Covers label creation, contact filtering, batch processing, and rate limit handling.

---

## Domains

### [Domain Search and Purchase](references/domains/domain-search-and-purchase.md)
**Technical:** Search for available domains, get domain suggestions, and generate purchase links using Domain Search V2 API. Covers availability checks, TLD filtering, and connecting domains to Wix sites.

---

## eCommerce

**Routing — pick the right entry point:**
- **Any sales/business improvement request** (boost sales, promotions, help my business, holiday deals, improve revenue, discounts, shipping, coupons, clearance) → use [Recommend: eCommerce Strategy](references/ecommerce/recommend-ecommerce-strategy.md). This is the **default entry point** — it analyzes ALL domains (discounts, shipping) and generates cross-domain recommendations. Do NOT ask clarifying questions.
- **Pricing & promotions** (coupons, discount rules, ribbons, sales) → use the [Pricing & Promotions](references/ecommerce/ecom-pricing.md) dispatcher.
- **Shipping setup** (rates, regions, pickup, free shipping, fix coverage) → use the [Shipping](references/ecommerce/ecom-shipping.md) dispatcher.

### [eCommerce: Load Context](references/ecommerce/ecom-load-context.md)
**L1 loader** — loads general site data (siteId, country, currency, industry, catalog analytics) needed by every eCommerce category. Each category dispatcher loads this before tag-matching; runs once per session.

### [Recommend: eCommerce Strategy](references/ecommerce/recommend-ecommerce-strategy.md)
**Entry point for all eCommerce recommendation requests.** Unified skill that analyzes site data across ALL domains (discounts + shipping), generates up to 5 cross-domain recommendations, and persists them to the tracking database. Covers discount strategies (seasonal, upsell, stock mover, bundling) AND shipping optimization (coverage gaps, free shipping, rate strategy, carrier backup). Use this for ANY business improvement request.

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

---

## Forms

### [Create Form](references/forms/create-form.md)
**Technical:** Creates a form with fields (name, email, etc.) using the Form Schemas API. Covers field configuration, layout, and post-submission triggers.

---

## Get Paid

### [Create Payment Links](references/get-paid/create-payment-links.md)
**Technical:** Creates payment links for collecting payments without a checkout flow. Covers store products (catalog items), custom line items, variants, due dates, and sending links via email.

### [How to Setup Wix Payments](references/get-paid/how-to-setup-wix-payments.md)
**Technical:** Configures Wix Payments as the payment provider. Covers eligibility checking, business verification, bank account setup, and payment method configuration (cards, PayPal, Apple Pay).

### [Payment Links for Bookings](references/get-paid/payment-links-for-bookings.md)
**Technical:** Creates payment links for unpaid bookings using Payment Links API. Links booking IDs to payment requests with proper redirect handling.

---

## Marketing

### [Create and Publish a Social Media Post (with AI generation)](references/marketing/create-and-publish-social-post.md)
**Technical:** Creates and publishes (or schedules) a social media post to a connected channel (Instagram, Facebook, LinkedIn, TikTok, Pinterest, YouTube, Google Business Profile) via the Publisher API. Optionally generates the whole post from a free-text idea or the site's own assets (products, blog posts, events, bookings, coupons, categories), generates caption/title suggestions, and edits an existing image with AI. Verifies the channel is connected (and runs the OAuth connect flow if not), checks premium publishing quota, creates a draft item, then publishes it immediately or schedules it for a future date. Use when the user wants to create, generate, write, post, or schedule a social post, wants caption ideas or suggestions, or wants to connect a social channel (e.g. "post this to Instagram", "make a post from my product", "write a caption", "give me caption ideas", "connect my Pinterest", "schedule a post").

### [Generate a Marketing Plan and Schedule Its Posts](references/marketing/generate-and-publish-marketing-plan.md)
**Technical:** Generates a site's AI social media marketing plan (a calendar of marketing activities, each with per-channel post drafts) via the Marketing Plan API, then schedules the drafts for publishing. Covers optional marketing settings (goal, channels, tone, frequency, content pillars), asynchronous generation with polling, and generating posts for additional activities. Use for "generate a marketing plan", "create a social media plan/calendar", or "schedule my plan's posts".

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

---

## Restaurants

### [Wix Restaurants Setup](references/restaurants/wix-restaurants-setup.md)
**Technical:** Configures restaurant menus, sections, and items using Menus API. Covers menu structure (Menu → Section → Item), modifiers, pricing, availability schedules, and ordering settings.

---

## Rich Content

### [Ricos Converter Service](references/rich-content/ricos-converter-service.md)
**Technical:** Validates and converts content between Ricos documents and HTML/Markdown/plain text using the Ricos Documents API. Covers plugin configuration, format conversion in both directions, and document validation.

### [Author Ricos Rich Content](references/rich-content/author-ricos-rich-content.md)
**Technical:** Hand-authoring valid Ricos rich-content JSON (the richContent/nodes tree) reused across Blog, Stores, Events, and CMS. Covers every common node shape — paragraphs, headings, lists, blockquotes, dividers, tables with cell fills, code blocks, images — plus inline text decorations and the nesting rules the format enforces.

---

## Site Properties

### [Change Payment Currency](references/site-properties/change-payment-currency-site-properties.md)
**Technical:** Updates the site-level payment currency (store billing currency) using Site Properties API, including the required request body shape and field mask.

---

## Sites

### [Create Site from Template](references/sites/create-site-from-template.md)
**Technical:** Creates new Wix sites from templates using account-level APIs. Covers template search, site creation, headless site setup, OAuth app creation, and publishing.

### [Query Sites](references/sites/query-sites.md)
**Technical:** Lists and queries all sites associated with a Wix account using Sites API. Covers pagination with cursor-based navigation.

---

## Stores

### [Add Store Pages to Site](references/stores/add-store-pages-to-site.md)
**Technical:** Adds missing checkout and cart pages to a site when Stores app is installed. Used when store pages are missing after migration or setup issues.

### [Bulk Create Products with Options](references/stores/bulk-create-products-with-options.md)
**Technical:** Uses bulk products endpoint to create multiple products with inventory in a single request. Handles variant generation from options, media format requirements, and error handling for partial failures.

### [Create Product from Image](references/stores/create-product-from-image.md)
**Technical:** **MANDATORY entry point** for any "create product from image" or "create product from photo" request. STEP 1 auto-detects the site's catalog version (V1/V3) via the provision endpoint, then runs the matching flow inline — V3 supports up to 3 images, info sections, SEO, options/variants, and atomic creation; V1 supports a single image, simple product, and a separate media-attach call. Combines Media Upload + LLM analysis + Product Creation + (V1 only) Add Product Media in one self-contained recipe.


### [Create Product (Catalog V1)](references/stores/create-product-catalog-v1.md)
**Technical:** Create products using the Catalog V1 Products API. Use this recipe when the site's catalog version is CATALOG_V1. Covers simple product creation, product with options, and key V1 request structure differences from V3.

### [Create Product with Options (Catalog V3)](references/stores/create-product-with-options-catalog-v3.md)
**Technical:** Single product creation with options using Catalog V3 Products API. Covers option types (TEXT_CHOICES, SWATCH_CHOICES), choice configuration, and automatic variant generation.

### [Find Products (Query and Search, Catalog V3)](references/stores/find-products-query-and-search-catalog-v3.md)
**Technical:** Find, search, query, and list products from a Wix Store using Catalog V3 Search Products and Query Products endpoints. Explains when to use each endpoint, correct fields enum values, filtering, sorting, and paging.

### [Query Products (Catalog V1)](references/stores/query-products-catalog-v1.md)
**Technical:** Query and list products from a Wix Store using the Catalog V1 Query Products endpoint. Use this recipe when the site's catalog version is CATALOG_V1. Covers basic queries, filtering, sorting, and paging.

### [Setup Online Store (Catalog V3)](references/stores/setup-online-store-catalog-v3.md)
**Technical:** Initializes a Stores catalog with Catalog V3 Products API, bulk products endpoint, and Categories API. Covers product creation, option configuration, variant management, and category assignment.

### [Update Product Pre-Order](references/stores/update-product-pre-order.md)
**Technical:** Manages pre-order settings for product variants using V3 Inventory API. Covers enabling/disabling pre-orders, setting messages, configuring limits, and handling trackQuantity requirements.

### [Update Product with Options](references/stores/update-product-with-options.md)
**Technical:** Modifies existing products and variants using Catalog V3 Products API. Covers adding/removing option choices, variant-specific pricing, and revision-based updates to prevent conflicts.
