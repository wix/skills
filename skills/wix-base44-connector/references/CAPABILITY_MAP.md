# Capability map — which Wix product owns what

Every Wix product, its capabilities, and its docs path. Paths are relative to
`https://dev.wix.com/docs/api-reference/`; read a product's `<path>/introduction.md` for detail.
Capabilities come from those introduction pages — re-derive from them when a product looks wrong or
missing.

## Business solutions

| Product | Path | Features |
|---|---|---|
| Stores | `business-solutions/stores` | Products · Categories · Product options and variants · Inventory · Brands · Ribbons · Product info sections · Product customizations · Promotions · Store locations · Site currency · Currency conversion |
| Bookings | `business-solutions/bookings` | Services · Appointments · Classes · Courses · Staff members · Resources · Pricing · Policies · Time slots · Bookings · Waitlists · External calendar · Checkout and orders |
| eCommerce | `business-solutions/e-commerce` | Cart · Checkout · Abandoned checkout · Orders · Order transactions · Order fulfillment · Discount rules · Recommendations · Shipping rates · Additional fees · Payments · Catalog |
| Restaurants | `business-solutions/restaurants` | Menus · Sections · Items · Item variants · Item modifiers · Item labels · Online orders · Operations · Fulfillment methods · Availability exceptions · Service fees · Reservations · Time slots · Experiences |
| Events | `business-solutions/events` | Events · Ticket definitions · Tickets · RSVP · Orders and checkout · Check-in · Event guests · Guest list · Event schedule · Policies |
| Blog | `business-solutions/blog` | Posts · Draft posts · Categories · Tags · Post stats · Blog roles · Paid post subscriptions |
| CMS | `business-solutions/cms` | Data items · Data collections · Collection permissions · Aggregations · Indexes · External databases · Backups · Background tasks |
| Pricing Plans | `business-solutions/pricing-plans` | Plans · Orders · Recurring subscriptions · Single payment plans · Free plans · Free trial periods · Order cancellation · Credits |
| Portfolio | `business-solutions/portfolio` | Projects · Project items · Collections · Portfolio settings · Gallery layouts · Cover media |
| Gift Cards | `business-solutions/gift-cards` | Gift cards · Gift card products · Redemption codes · Balance tracking · Denominations · Expiration policies · Transactions |
| Coupons | `business-solutions/coupons` | Coupons · Percentage discounts · Fixed amount discounts · Free shipping · Buy X Get Y · Coupon scopes · Usage limits · Expiration dates |
| Donations | `business-solutions/donations` | Donation campaigns · Fundraising goals · One-time and recurring donations · Predefined and custom amounts · Cover fees · Campaign progress |
| Benefit Programs | `business-solutions/benefit-programs` | Benefit programs · Program templates · Membership tiers · Credits · Benefit redemption · Visitor enrollment · Balances · Eligibility checks |
| Meetings | `business-solutions/meetings` | Scheduling links · Shareable booking page · Meeting duration and location · Video, phone, in-person · Hosts · Calendar sync · Intake forms · Paid meetings · Rescheduling |
| Rentals | `business-solutions/rentals` | Rental services · Hourly and daily durations · Customer-selected length · Bookable resources · Resource attributes · Per-hour and per-day pricing · Availability · Consecutive multi-day bookings |
| Suppliers Hub | `business-solutions/suppliers-hub` | Marketplace products · Suppliers · Dropshipping · Wholesale price tiers · Categories and tags · Product search · Bulk catalog operations · Mockup generation |
| Forum | `business-solutions/forum` | **Deprecated** — discontinued March 2026; migrate to Community → Groups |

## Site-wide products (CRM and business management)

| Product | Path | Features |
|---|---|---|
| Members & Contacts | `crm/members-contacts` | Contacts · Labels · Extended fields · Notes · Attachments · Activity log · Members · Member profiles · Member authentication · Privacy settings · Badges · Followers |
| Forms | `crm/forms` | Form schemas · Form submissions · Form schema templates · Intake forms · Interactive form sessions · Chat settings |
| Loyalty Program | `crm/loyalty-program` | Loyalty program · Loyalty points · Earning rules · Tiers · Loyalty accounts · Transactions · Rewards · Loyalty coupons · Checkout discount |
| Community | `crm/community` | Groups · Group rules · Group membership · Join requests · Comments · Reviews · Review requests · Reports · Moderation rules |
| Communication | `crm/communication` | Inbox · Conversations · Messages · Email subscriptions · Communication channels |
| CRM | `crm/crm` | Tasks · Pipelines · Cards |
| Automations | `business-management/automations` | Automations · Triggers · Actions · Conditions · Delays · Pre-installed automations · Trigger catalog · Action catalog |
| Marketing | `business-management/marketing` | Email campaigns · Transactional emails · Sender details · Sending domains · Marketing consent · Referral program · Referral rewards · Marketing tags · Social media posts · Google Ads · Ads.txt |
| Payments | `business-management/payments` | Checkout sessions · Payment methods · Transactions · Refunds · Disputes · Payouts · Balances · Tax documents · Payment service provider integration |
| Get Paid | `business-management/get-paid` | Invoices · Invoice presets · Billable items · Payment links · Receipts · Receipt presets · Bulk downloads |
| SEO | `business-management/seo` | Site SEO tags · SEO patterns · Item SEO tags · Resolved tags · Verification tags · Redirects |
| Multilingual | `business-management/multilingual` | Locales · Locale settings · Translation schemas · Translation content · Published translated content · Machine translation · Word credits |
| Notifications | `business-management/notifications` | Notifications · Notification templates · Dashboard site feed · Owner app notification center · Mobile push |
| Locations | `business-management/locations` | Locations · Default location · Business schedule · Special hours · Location types · Location archiving |
| Branches | `business-management/branches` | Branches · Default branch · Branch tags · Branch types |
| Online Programs | `business-management/online-programs` | Programs · Sections · Steps · Join applications · Instructors · Enrollment · Payment flows |
| Calendar | `business-management/calendar` | Schedules · Events · Recurring events · Schedule time frames · Event views · Participation — **infrastructure** under Bookings, not a product a site owner picks |
| Analytics | `business-management/analytics` | Analytics data · Semantic models · Sessions |
| Site Search | `business-management/site-search` | Search · Search schemas |

Also under `business-management/`, thinner or platform-facing: `site-properties`, `site-urls`,
`tags`, `dashboard`, `secrets`, `functions`, `app-installation`, `async-job`, `captcha`,
`cookie-consent-policy`, `custom-embeds`, `data-extension-schema`, `google-business-profile`,
`headless`, `ai-site-chat`, `faq-app`.

## Not in the docs

- No roles API and no segments API in `crm/` or `business-management/` — contact **labels** serve
  segmentation.
- For a single method, `spec(docsUrl)` is what proves absence.

## Where things actually live

- **SEO spans two products** — the tag model is `business-management/seo`; Ads.txt and keyword
  suggestions are `business-management/marketing/seo`.
- **Badges and Followers** live under `crm/members-contacts/members/activity/`, not member
  management. Profiles are `members/member-management/members-about-v2`, privacy is
  `member-management/privacy`, custom fields are `member-management/custom-fields`.
- **Meetings and Rentals ship no APIs of their own** — both are Wix Bookings with restricted field
  values, so their contracts are the Bookings ones.
- **Loyalty coupons** (`crm/loyalty-program/rewards/coupons`) are a different resource from
  eCommerce **Coupons** (`business-solutions/coupons`).
- **Stores categories** are called *Collections* in Catalog V1 and *Categories* in Catalog V3.
- **Stores, Coupons and Suppliers Hub have no usable introduction page** — start from the menu page
  and the sub-section introductions.
