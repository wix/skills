---
name: wix-manage
description: "Wix business solution management recipes — REST API operations for configuring and managing Wix business solutions. Routes to: stores, bookings, get-paid, CMS, contacts, forms, media, app-installation, pricing-plans, restaurants, rich-content, sites, blog, calendar, domains, site-properties, ecommerce."
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

**Routing structure** (rules + format in the `wix-skills-routing-expert` Claude Code skill — repo `ecom-ai-agents/.claude/skills/`): Each L2 category has a sibling `<category>.md` (README-surfaced description) + a `<category>/` folder with the dispatcher + promotion files. The migrated eCommerce L2 categories are **Tax**, **Pricing & promotions**, **Shipping**, **Checkout & cart**, **Abandoned carts**, and **Fulfillment**.

**L1 context loader (per L1 domain, sibling to category-docs):**

### [eCommerce: Load Context](references/ecommerce/ecom-load-context.md)
Per-L1 context loader for the eCommerce domain. Loads site profile (country, region, industry, currency, AOV, etc.) + eCommerce-specific runtime fields (tax `calculator`). Referenced from every eCommerce category's `default.md`. Skip if already loaded.

When other L1 domains migrate (Stores, Get-paid, …), each gets its own `<l1>-load-context.md` at its L1 root — Stores will detect Catalog V1/V3, Get-paid will inspect payment provider state, etc. See the "Pattern for future L1 loaders" section in `ecom-load-context.md` for the convention.

---

### Tax category

#### [Tax](references/ecommerce/ecom-tax.md)
README-surfaced category-doc **and** dispatcher (merged — prototype). Disambiguates the category, then picks Avalara / EU-VAT / Wix-Manual / audit / troubleshoot / switch based on the merchant's request + MerchantContext. No separate `-default` hop.

#### Tax promotions
- [Configure Tax (Wix Manual)](references/ecommerce/tax/ecom-tax-configure.md) — baseline manual calculator setup
- [Configure Tax (Avalara)](references/ecommerce/tax/ecom-tax-avalara.md) — context promotion `[calculator:AVALARA]`
- [Configure Tax (EU VAT)](references/ecommerce/tax/ecom-tax-eu-vat.md) — context promotion `[region:EU]`
- [Switch Tax Calculator](references/ecommerce/tax/ecom-tax-switch-calculator.md)
- [Audit Tax Setup](references/ecommerce/tax/ecom-tax-audit.md) (read-only)
- [Tax Calculation Wrong](references/ecommerce/tax/ecom-tax-troubleshoot-calc-wrong.md) (diagnostic)

---

### Pricing & Promotions category

#### [Pricing & Promotions](references/ecommerce/ecom-pricing.md)
README-surfaced category-doc **and** dispatcher (merged). Disambiguates the category, then picks the right Pricing promotion based on the merchant's intent + MerchantContext. No separate `-default` hop.

#### Pricing promotions (direct merchant entry points)
- [Create Coupon](references/ecommerce/pricing-promotions/ecom-pricing-create-coupon.md) — Coupons V2 API
- [Create Discount Rule](references/ecommerce/pricing-promotions/ecom-pricing-create-discount-rule.md) — auto-apply discount rules
- [Run a Sale (orchestrator)](references/ecommerce/pricing-promotions/ecom-pricing-run-a-sale.md) — the cross-domain strategy orchestrator (formerly `recommend-ecommerce-strategy`)
- [Discount Not Applying](references/ecommerce/pricing-promotions/ecom-pricing-troubleshoot-not-applying.md) — diagnostic tree

<details>
<summary>Pricing support files (goal-* / flow-* / guardrail-* / tracking-api) — flat in pricing-promotions/, loaded by the orchestrator, NOT direct entry points</summary>

- [Goal: Increase AOV](references/ecommerce/pricing-promotions/ecom-pricing-goal-increase-aov.md) — UPSELL_BOOST
- [Goal: Clear Inventory](references/ecommerce/pricing-promotions/ecom-pricing-goal-clear-inventory.md) — STOCK_MOVER
- [Goal: Seasonal Revenue](references/ecommerce/pricing-promotions/ecom-pricing-goal-seasonal-revenue.md) — SEASONAL
- [Goal: Drive Cross-Sells](references/ecommerce/pricing-promotions/ecom-pricing-goal-drive-cross-sells.md) — BUNDLE_AND_SAVE
- [Flow: Upsell Boost](references/ecommerce/pricing-promotions/ecom-pricing-flow-upsell-boost.md)
- [Flow: Bundle and Save](references/ecommerce/pricing-promotions/ecom-pricing-flow-bundle-and-save.md)
- [Flow: Stock Mover](references/ecommerce/pricing-promotions/ecom-pricing-flow-stock-mover.md)
- [Flow: Seasonal Promotion](references/ecommerce/pricing-promotions/ecom-pricing-flow-seasonal-promotion.md)
- [Pricing & Discount Health](references/ecommerce/pricing-promotions/ecom-pricing-health.md) — periodic conflict/stale-sale/margin sweep
- [API: Recommendation Tracking](references/ecommerce/pricing-promotions/ecom-pricing-tracking-api.md)

(Discount-conflict & margin guardrails are inlined into Create Discount Rule / Create Coupon — the skills they guard — rather than separate files.)

</details>

---

### Shipping category

#### [Shipping](references/ecommerce/ecom-shipping.md)
README-surfaced category-doc **and** dispatcher (merged). Covers shipping config — rates, regions/coverage, pickup/local delivery, free-shipping thresholds, rate optimization, and wrong-rate troubleshooting. Order-fulfillment ops — mark fulfilled, tracking, labels — belong to **Fulfillment**. The Shipping Options + Delivery Profiles APIs have no public docs page, so `ecom-shipping-api.md` is the inline reference.

#### Shipping promotions
- [Set Up Rates](references/ecommerce/shipping/ecom-shipping-setup-rates.md)
- [Set Up Regions / Coverage](references/ecommerce/shipping/ecom-shipping-setup-regions.md)
- [Set Up Pickup / Local Delivery](references/ecommerce/shipping/ecom-shipping-setup-pickup.md)
- [Add Free Shipping](references/ecommerce/shipping/ecom-shipping-free-shipping.md)
- [Optimize Rates](references/ecommerce/shipping/ecom-shipping-optimize-rates.md)
- [Fix Coverage Gaps](references/ecommerce/shipping/ecom-shipping-fix-coverage.md)

#### Shipping support (loaded via body links, not direct entries)
- [API Reference](references/ecommerce/shipping/ecom-shipping-api.md) — inline spec (no public docs page)

(Rate-pricing-sanity and shipping-health guardrails are inlined into their caller recipes — free-shipping / optimize-rates and fix-coverage. The generic "apply shipping recommendations" recipe was dissolved — the LLM applies recs directly via the create/update endpoints in the API Reference.)

### Checkout & Cart category

#### [Checkout & Cart](references/ecommerce/ecom-checkout.md)
README-surfaced category-doc **and** dispatcher (merged). Covers live checkout abandonment reduction, checkout troubleshooting, agentic readiness, and store-health. Abandoned-checkout recovery after the shopper leaves belongs to **Abandoned carts**. Most checkout *config* (guest checkout, minimum order, custom fields, upsell) is **Dashboard-only** — the dispatch routes those to the Wix Dashboard.

#### Checkout promotions
- [Reduce Abandonment](references/ecommerce/checkout/ecom-checkout-reduce-abandonment.md) — delivery-step friction angle; also loaded by run-a-sale's ABANDONED_CART branch
- [Troubleshoot Delivery Drop-off](references/ecommerce/checkout/ecom-checkout-troubleshoot-dropoff.md)
- [Agentic Readiness](references/ecommerce/checkout/ecom-checkout-agentic-readiness.md) — catalog data-quality audit + programmatic test-checkout (AI agents)
- [Store Health Monitor](references/ecommerce/checkout/ecom-checkout-store-health.md) — periodic checkout/config-drift/anomaly checks

### Abandoned Carts category

#### [Abandoned Carts](references/ecommerce/ecom-abandoned-carts.md)
README-surfaced category-doc **and** dispatcher (merged). Covers abandoned-checkout recovery and recapture after the shopper leaves: viewing abandoned checkouts, recovery emails, recovery links, troubleshooting recovery, and recovery health monitoring.

#### Abandoned Carts promotions
- [Recover Abandoned Carts via Email](references/ecommerce/abandoned-carts/ecom-abandoned-carts-recover-email.md) — Dashboard-configured automation; recipe guides timing/content/eligibility
- [Generate Recovery Link](references/ecommerce/abandoned-carts/ecom-abandoned-carts-recovery-link.md) — Abandoned Checkout API link generation
- [Troubleshoot Recovery](references/ecommerce/abandoned-carts/ecom-abandoned-carts-troubleshoot-recovery.md)
- [Recovery Health Monitor](references/ecommerce/abandoned-carts/ecom-abandoned-carts-recovery-health.md)

### Fulfillment category

#### [Fulfillment](references/ecommerce/ecom-fulfillment.md)
README-surfaced category-doc **and** dispatcher (merged). Covers post-purchase fulfillment operations: finding unshipped/problematic orders, marking orders fulfilled, updating tracking, partial fulfillment, bulk fulfillment, invoices/packing slips, and Dashboard-only shipping labels.

#### Fulfillment promotions
- [Fulfill Orders & Tracking](references/ecommerce/fulfillment/ecom-fulfillment-fulfill-orders.md) — mark fulfilled, tracking, partial fulfillment
- [Bulk Fulfill Orders](references/ecommerce/fulfillment/ecom-fulfillment-bulk-fulfill-orders.md) — batch fulfillment with partial-failure handling

### Orders category

#### [Orders](references/ecommerce/ecom-orders.md)
README-surfaced category-doc **and** dispatcher (merged). Covers eCommerce order lookup, order details/counts, order search, pending/stuck-order diagnosis, cancel-order routing, and explicit handoffs to Fulfillment and Payments.

#### Orders promotions
- [Cancel Order](references/ecommerce/orders/ecom-orders-cancel-order.md) — cancel order with restock/email/refund guardrails

#### Reference
- [Skill Graph](references/ecommerce/skill-graph.md) — author docs only, NOT a runtime skill

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
