---
name: wix-app-management
description: "Wix business solution management recipes — REST API operations for configuring and managing Wix business solutions. Routes to: stores, bookings, get-paid, CMS, contacts, events, forms, media, app-installation, pricing-plans, restaurants, rich-content, sites, blog, calendar, domains, site-properties, ecommerce."
compatibility: Requires Wix REST API access (API key or OAuth).
---

# Wix Business Solution Management Recipes

Index of all Wix business solution management recipes. Each business solution has its own index in a sub-skill with detailed REST API recipes for site setup, entity management, and backend integrations.

## ⚠️ MANDATORY WORKFLOW

1. **Identify** which business solution(s) the user needs from the router below
2. **Read** the corresponding sub-skill `SKILL.md` file
3. **Follow** that sub-skill's workflow to find and apply the right recipe(s)
4. **If multiple solutions are needed**, read each sub-skill sequentially

**🛑 STOP:** Never implement a recipe without first reading its reference file.

---

## Quick Router

| User wants to...                                                                                                                                                                                                                                              | Route to                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Search products, create products, bulk create products, update products, update product pre-order, setup online store, add pages                                                                                                                              | [Stores](stores/SKILL.md)               |
| Query sites, create site from template                                                                                                                                                                                                                        | [Sites](sites/SKILL.md)                 |
| Change payment currency, update site-level properties                                                                                                                                                                                                         | [Site Properties](site-properties/SKILL.md) |
| Search and purchase domains, check domain availability                                                                                                                                                                                                        | [Domains](domains/SKILL.md)             |
| Validate or convert rich content (Ricos) between HTML, Markdown, and plain text                                                                                                                                                                               | [Rich Content](rich-content/SKILL.md)   |
| Set up restaurant menus, sections, items, modifiers, and ordering                                                                                                                                                                                             | [Restaurants](restaurants/SKILL.md)     |
| Create or update pricing plans, attach benefit programs, pricing plans bookings integration                                                                                                                                                                   | [Pricing Plans](pricing-plans/SKILL.md) |
| Install apps, list installed apps                                                                                                                                                                                                                             | [App Installation](app-installation/SKILL.md) |
| Create payment links, setup Wix Payments, payment links for bookings                                                                                                                                                                                         | [Get Paid](get-paid/SKILL.md)           |
| Upload images and files to Wix Media Manager                                                                                                                                                                                                                  | [Media](media/SKILL.md)                 |
| Create forms with fields, layout, and submission triggers                                                                                                                                                                                                     | [Forms](forms/SKILL.md)                 |
| Query and list events, filter by status or date                                                                                                                                                                                                               | [Events](events/SKILL.md)               |
| Configure delivery profiles, pickup locations, shipping                                                                                                                                                                                                       | [eCommerce](ecommerce/SKILL.md)         |
| Bulk delete contacts, bulk add/remove labels from contacts                                                                                                                                                                                                    | [Contacts](contacts/SKILL.md)           |
| CMS data items CRUD, schema management, references, aggregation, eCommerce catalog                                                                                                                                                                            | [CMS](cms/SKILL.md)                     |
| Configure default business hours, calendar events and schedules                                                                                                                                                                                               | [Calendar](calendar/SKILL.md)           |
| Create and publish blog posts with rich content, images, categories, and tags                                                                                                                                                                                 | [Blog](blog/SKILL.md)                   |
| End-to-end booking flow, booking system integration gaps, external calendar integration, service creation, create and update booking services, booking service policy setup, booking staff setup                                                               | [Bookings](bookings/SKILL.md)           |

---

## Business Solutions Overview

### Stores

Wix Stores lets site owners create and manage an online store for physical and digital products. Each site supports either Catalog V1 or V3 (not both) — always check the site's catalog version first using the Catalog Versioning API.

### Sites

Wix Sites APIs provide account-level operations for creating and querying sites. Includes template-based site creation.

### Site Properties

Wix Site Properties API manages site-level configuration such as payment currency and regional settings.

### Domains

Wix Domains APIs provide domain search, availability checks, suggestions, and purchase link generation.

### Rich Content

Ricos is Wix's rich content format used across Blog, Stores, and other apps. The Ricos Documents API provides validation and conversion between Ricos documents and HTML, Markdown, or plain text.

### Restaurants

Wix Restaurants lets site owners set up and manage restaurant menus with a hierarchical structure (Menu → Section → Item). Covers menu creation, item modifiers, bulk operations, and querying.

### Pricing Plans

Wix Pricing Plans lets site owners create subscription, one-time, and free membership plans. Plans can be linked to benefit programs to bundle services like bookings or blog access.

### App Installation

Wix App Installation APIs handle installing and listing apps on a site.

### Get Paid

Wix Get Paid APIs cover payment link creation for custom items and catalog products, Wix Payments account setup, and booking-specific payment link flows.

### Media

Wix Media Manager stores all media files for a site. The Import File API lets you upload images and files from external URLs or local devices, returning reliable wixstatic.com URLs for use in other APIs.

### Forms

Wix Forms lets site owners create forms that collect visitor information and automatically upsert contacts on submission. Covers field configuration, layout, and post-submission triggers.

### Events

Wix Events lets site owners create and manage events. The Events API supports querying with field sets (DETAILS, URLS, REGISTRATION), filtering by status and date, and pagination.

### eCommerce

Wix eCommerce APIs cover delivery profiles, pickup locations, and shipping configuration for online stores.

### Contacts

Wix Contacts APIs support bulk operations for managing contacts, including filter-based bulk deletion and bulk label/unlabel operations with async job tracking.

### CMS

Wix CMS lets site owners create and manage structured content collections. Covers data items CRUD, schema management, collection references and relationships, extended operations (count, upsert, aggregate), and eCommerce catalog integration.

### Calendar

Wix Calendar APIs manage business hours, working hours events, and schedule management via the Calendar Events API.

### Blog

Wix Blog lets site owners create and publish blog posts with rich content (Ricos format), cover images via Media Manager, category/tag assignment, and bulk post creation.

### Bookings

Wix Bookings lets site owners offer appointment, class, and course services. Covers service CRUD, staff setup with custom hours, end-to-end booking flows, policies, multi-resource services, and external calendar integration.
