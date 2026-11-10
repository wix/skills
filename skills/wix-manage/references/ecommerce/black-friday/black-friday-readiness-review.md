---
name: "Black Friday Readiness Review"
description: "Reviews a Wix store before Black Friday, Cyber Monday or any dated sale and reports, in one checklist-style report with a weekly focus, what already works, what the agent can fix on approval, and what only the store owner can do. Covers the 28 checks of the BFCM checklist: catalog and stock, payments, test carts for shipping and coupons, discounts and their dates, checkout policies, emails and automations, tracking tags, Google readiness and expected order volume, plus a look at the live site when a browser is available. Use when a store owner asks to review, audit, check or prepare their store for Black Friday, BFCM, a holiday sale or 'the sale', or pastes a pre-made prompt saying so. Requires Wix Stores; catalog and stock checks need Catalog V3."
---

# Black Friday Readiness Review

One pass over a Wix store's backend, graded against the Black Friday / Cyber Monday checklist, delivered as one report in three blocks: what already works, what the agent can fix (one approval), what the merchant does (a checklist with links). The checklist is the BFCM Webinar 2026 one, built from ~13,000 Wix stores.

**Principle: verify from data, never from assumption.** Every ✅ in the report is backed by an API response the agent read, or a page the agent opened and looked at, in this session. A check the agent could not read or see is handed to the merchant as a checklist item with the exact page to open, never reported as passed.

**Two eyes.** The backend tells you what is configured; only the live site tells you what a shopper sees. When the agent has a tool that opens a web page and returns what it shows (a browser, a screenshot tool, a page reader with rendered text), it opens the store and looks. When it does not, the visual checks become the first group of the merchant's checklist, each with the page link and what to look for, on desktop and on a phone.

## When to use

- The user asks to review, audit, check or prepare their store for Black Friday, Cyber Monday, BFCM, a holiday sale, or "the sale".
- The user pastes a pre-made prompt such as "Review my store X and make sure I'm all ready for Black Friday."
- The user asks one checklist question on its own ("are my coupons set up right?", "will my shipping work?"): run only that section, same report format.

Not for: designing the sale strategy from scratch (route to [Recommend: eCommerce Strategy](../recommend-ecommerce-strategy.md), then come back here to verify it), traffic acquisition (marketing), sites without Wix Stores (say so; offer the policies, emails and tracking sections only).

## Flow

1. **Context** — [Read Account or Site Context](../../sites/read-site-context.md) for the named site. Take `siteId`, site URL, created date, time zone, currency, and read the Wix Stores line of its app list: `hasStores` must be true and `storesCatalogV` says `V3` or `V1`. No Stores: say so and run only the policies, emails and tracking sections. `V1`: the catalog, inventory and category probes below are V3-only, so skip the catalog, stock and test-cart checks, say why, and run the rest; never call the V3 endpoints on a V1 store. Several sites and none named: ask which one, nothing else. This recipe reads its own site fields; do not run eCommerce: Load Context first.
2. **Stage** — from today's date, pick the week's stage from the [timing table](#when-the-review-runs) below. It decides the order of the report, never which checks run: every check runs every time.
3. **Sale window** — never ask for dates up front. Read them from the coupons and discount rules in step 4; a coupon or rule whose window covers the Black Friday week *is* the sale. When nothing dated exists, deliver the full report anyway with "Set up your Black Friday discount — tell me the offer and the dates" as item 1 of the 🔧 block.
4. **Read everything in one call** — Probe 1 in [Black Friday Readiness Checks](black-friday-readiness-checks.md): one JavaScript function run against the Wix REST API with the site's credentials (the probes are written for a tool that executes such a function; without one, make the same REST calls one by one), every read in `Promise.allSettled`, a failed read returned as its own `{ ok: false }` and never thrown. Catalog, inventory, categories, coupons, discount rules, shipping, checkout policies, marketing tags, automations, email campaigns, gift card product, cookie banner, site properties, pages, orders, the live homepage.
5. **Test carts** — Probe 2, a second function run after the reads: temporary carts priced per shipping region and per coupon code, deleted in `finally`. No order is placed, no customer created. The report says so. Skip when the catalog has no purchasable product.
6. **Look at the live site** — Probe 3 in the checks file. With a browser tool: open the homepage, the sale category page, one discounted product page, the cart with one item added, and the checkout up to (never through) the payment step; once on a desktop width and once on a phone width when the tool can resize; screenshot each page when the tool can. Record what is seen for checks 4–10 and 12. Without a browser tool: say so in the report header, and every visual check becomes a checkbox under **On your live site** with its URL and what to look for. Never guess what a page looks like from its HTML.
7. **Grade** each check with the pass rules in the checks file; write the report in the contract below.
8. **Offer fixes, apply on approval.** Everything the agent can change goes in the 🔧 block, numbered, with one permission ask. Change nothing until the merchant answers. Writes go through the matching `wix-manage` recipe (table below); after each write, read it back and confirm in one line.

## Status legend

Every finding lands in exactly one block, decided by **who acts**:

| Mark | Block | Rule |
|---|---|---|
| ✅ | Already working | Verified from an API response, or seen on the live site in a browser; the pass rule holds on real data |
| 🔧 | I can fix these | Verified problem whose fix has a row in the [fixes table](#fixes-and-where-their-recipe-lives), pending the merchant's yes |
| ✋ | Your checklist | A task or confirmation only the merchant can do (editor, inbox, external tool, a toggle with no public API, a business decision), and every visual check when the agent has no browser |
| ❔ | Your checklist → "I couldn't verify" | Call failed or the API does not expose it; say how to check by hand. Never downgrade to 🔧 or upgrade to ✅ |
| ➖ | omitted | Not relevant to this store; at most one line at the end |

A check with two parts (agent fixes the data, merchant confirms in the editor) is split: the agent part goes to 🔧, the merchant part to ✋.

## The checks

Numbers are the checklist's; each has its data source and pass rule in the checks file.

**A. Checkout, payments & catalog** — 1 test cart prices without errors (merchant places one real order) · 2 every visible product has an image, a price above 0 and a description · 3 payments connected and the methods shoppers expect are on: cards, Apple Pay, Google Pay, PayPal, buy-now-pay-later (merchant toggles; no public read).
**B. Sale merchandising (live homepage)** — 4 announcement bar shows the sale and its dates match the discount window · 5 every product the homepage links to is in stock · 6 discounted products carry a compare-at price (the crossed-out original) · 7 a countdown timer, if present, ends when the discount ends · 8 the sale category is in the site menu.
**C. Shipping** — 9 each region prices a test cart above and below the free-shipping threshold, and every shipping option shows a delivery estimate.
**D. Policies & legal** — 10 return/shipping policy at checkout and linked in the footer · 11 sale terms exist (dates, exclusions, stacking, final-sale) · 12 Terms, Privacy and cookie banner in place.
**E. Stock** — 13 sale and best-selling products have stock for expected demand · 14 low-stock alerts (merchant) · 15 inventory tracking on for limited-quantity products.
**F. Coupons & discounts** — 16 a dated Black Friday discount or coupon exists, in the store time zone · 17 each coupon applies on a test cart with the expected amount and minimum · 18 coupon + automatic discount together never price a line below cost · 19 the sale does not stack on products already discounted · 20 coupons have total and per-customer limits · 21 everything is scheduled: discounts, coupons, emails (banners and timers: merchant).
**G. Emails & tracking** — 22 order confirmation, shipping confirmation and abandoned-cart automations ACTIVE · 23 at least 4 BFCM email campaigns scheduled or sent · 24 Google Analytics, Meta Pixel, TikTok Pixel connected.
**I. Google & AI search** — 25 Google Merchant Center connected (merchant; no public read) · 26 product data ready: clear titles, brand, descriptions · 27 Google / Meta feeds synced, no rejections (merchant).
**H. Operations** — 28 expected order volume from last year's Black Friday week and the last 30 days.

## Report contract

Write exactly this structure. Plain language for a store owner; no API names, no field names, no JSON.

```
# Black Friday readiness — <Store name>
**<Verdict in one line: "Mostly ready — 3 things I can fix now, 5 for you to check." / "Not ready yet — checkout fails for EU shoppers; details below.">**
Checked <date> · store time zone <tz> · sale window <start–end from your discounts, or "no dated sale found yet">. I priced test carts to check shipping and coupons; nothing was ordered. <"I also opened your homepage, sale page, a product page, the cart and the checkout in a browser, on desktop and phone." or "I couldn't open a browser from here, so the visual checks are at the top of your checklist.">
**This week (<stage dates>): <stage name>** — <one sentence on what matters now, from the timing table>.

## ✅ Already working
- <Check name> — <one line of evidence with real names/numbers>

## 🔧 I can fix these now — tell me which
1. <Problem in one line with evidence> → I'll <exact change>.
2. …
Reply with the numbers to apply, or "all". I'll do them one at a time and confirm each.
(When nothing is fixable, keep the heading and write one line: "Nothing for me to fix — every problem I found needs you.")

## 📋 Your checklist
### On your live site  (only when the agent had no browser, or for what it could not reach)
- [ ] Open [your homepage](<site URL>) on your phone and on a computer: is the Black Friday bar visible, does it show <dates>, and does every featured product open and show "in stock"?
- [ ] Open [a discounted product](<product URL>): is the original price crossed out next to the sale price?
- [ ] Add an item to the cart and go to checkout (don't pay): do shipping options and the return policy link appear, and does the cookie banner show on first visit?
- [ ] <one line per visual check that could not be seen, with its URL>
### In your dashboard
- [ ] Confirm payments are connected and live, and turn on Apple Pay, Google Pay, PayPal and a buy-now-pay-later option — [Open Accept payments](https://manage.wix.com/dashboard/<siteId>/wix-cashier/payments)   ← always first
- [ ] <Task> — [Open <page>](https://manage.wix.com/dashboard/<siteId>/<route>)
### In the editor
- [ ] <Task>
### After your test order (inbox, GA, Meta)
- [ ] <Task>
### In Google & Meta
- [ ] <Task> — [Open Google channel](https://manage.wix.com/dashboard/<siteId>/wix-stores/channel/google)
### In your operations
- [ ] <Task>
### I couldn't verify — please check by hand
- [ ] <Check> — <how to check>
(only the groups that have items)

## 💡 Worth adding before the sale
- <Suggestion> — I can <set up>; you <do>. (up to three, from the suggestions table, matching this week's stage and what the store lacks)
```

Rules for the report:
- **🔧 always prints, and its membership is mechanical.** A finding goes in 🔧 when its fix has a row in the fixes table; a finding with no row goes to the checklist. Never decide by feel, never merge the two lists, never drop the block because it is empty.
- **"Don't change anything" limits writes, not the offer.** A read-only request gets the same report with the same 🔧 list; only the ask changes to "say the word and I'll apply any of these". Nothing is written without an explicit yes naming the item.
- **Verdict first.** A broken checkout, a coupon that doesn't apply, or a region with no shipping makes the verdict "Not ready yet" regardless of how many ✅ follow. The two counts are the number of 🔧 items and the number of checkboxes; a split check counts once in each.
- **Stage orders the lists.** Inside 🔧 and 📋, items that belong to this week's stage come first, then the rest by damage: checkout and payments > discounts wrong > stock > policies > emails > tracking > Google.
- **Evidence names things:** "3 of 42 products have no image: Oak Mug, …", "coupon BF25 has no usage limit", "Germany: free shipping on a €48 cart, €12 below your €60 threshold".
- **One line per finding.** Details only when the merchant asks.
- **🔧 items say the exact change.** If the fix needs an input from the merchant (a quantity, a tracking ID, a date), say so in the line; it still belongs in 🔧.
- **✋ items are tasks, written as checkboxes** (`- [ ]`), grouped by where the merchant does them, each with a dashboard link when a route exists. Checkboxes render as a real checklist where Markdown task lists are supported and as readable text elsewhere.
- **Visual checks name the page and the thing to look at.** "Open your homepage on your phone: is the bar visible above the fold?" not "verify the announcement bar". Each line links the exact URL (site URL, sale category URL, product URL) from the probe data. When the agent did look, the ✅ or 🔧 line says what it saw ("the bar reads 'Black Friday 30% off Nov 27–30', matches your discount").
- Never show an API error or request id to the merchant; ❔ says "the shipping service didn't answer" and how to check instead.
- Dashboard base `https://manage.wix.com/dashboard/<siteId>/`. Routes allowed, all from the [dashboard navigation](../../dashboard-navigation/dashboard-navigation.md) and [automations](../../automations/build-and-manage-automations.md) recipes: products `wix-stores/products`, inventory `wix-stores/inventory`, categories `wix-stores/categories/list`, store settings `wix-stores/settings`, Google channel `wix-stores/channel/google`, orders `ecom-platform/orders-list`, abandoned checkouts `ecom-platform/abandoned-checkouts`, shipping `ecom-platform/delivery-profile`, tax `ecom-platform/tax`, checkout settings `ecom-platform/checkout-settings`, gift cards `ecom-platform/gift-cards`, accept payments `wix-cashier/payments`, automations `triggers`, email campaigns `email-marketing/my-campaigns`. No other route from memory; without one, name the page in words.

## When the review runs

Shopping starts early and ends late; a single check the day before Black Friday is too late for many items. Pick the stage from today's date (dates are for 2026; shift by the calendar in other years, Black Friday being the Friday after the fourth Thursday of November, US Thanksgiving).

| Dates | Stage | What the report puts first |
|---|---|---|
| Nov 2–8 | Tease | Google readiness (25–26), gift guide (S8), VIP waitlist (S19), paid ads started (S5) |
| Nov 9–15 | Early access | Segments (S20), 4+ emails scheduled (23), early-access offer for subscribers (S2), payment methods (3) |
| Nov 16–22 | Go public | Announcement bar, countdown, sale category in the menu, ribbons, automatic discounts, free-shipping banner (4–8, S6–S15) |
| Nov 23–26 | Final check-up | All of Part 1: test order, coupon and shipping tests, stock, policies, everything scheduled (21) |
| Nov 27 and Nov 30 | Black Friday · Cyber Monday | Everything live now (1, 9, 16–17, 22); a separate Cyber Monday offer (S3) |
| December | Finish late | Shipping cutoffs (S17), second-purchase follow-up (S4), countdowns and banners taken down (4, 7) |
| Any other date | Preparation | Order by damage; mention the first stage ahead |

## Fixes and where their recipe lives

Apply only what the merchant names. Load the recipe, follow it, confirm with a read-back in the same call.

| Fix | Recipe |
|---|---|
| Write missing or weak product titles, brand, descriptions; set compare-at prices; add ribbons | [stores/update-product-with-options.md](../../stores/update-product-with-options.md) (ribbons: Get or Create Ribbon in [ecommerce/ecom-pricing.md](../ecom-pricing.md)) |
| Turn on inventory tracking, set quantities | [stores/update-product-stock-and-pre-order.md](../../stores/update-product-stock-and-pre-order.md) |
| Create or fix a coupon: dates, usage limits, minimum | [ecommerce/pricing-promotions/ecom-pricing-create-coupon.md](../pricing-promotions/ecom-pricing-create-coupon.md) |
| Create or fix an automatic discount: dates, scope, exclusions; convert a coupon to an automatic discount; a Cyber Monday offer | [ecommerce/pricing-promotions/ecom-pricing-create-discount-rule.md](../pricing-promotions/ecom-pricing-create-discount-rule.md) |
| Fix free-shipping threshold, missing region, add delivery estimates | [ecommerce/ecom-shipping.md](../ecom-shipping.md) dispatcher ([ecommerce/shipping/ecom-shipping-api.md](../shipping/ecom-shipping-api.md) for Update Shipping Option) |
| Policy text at checkout (return, terms, privacy, sale terms, extended holiday returns); show the "I agree" checkbox | Update Checkout Settings `PATCH https://www.wixapis.com/ecom/v1/checkout-settings` (`checkoutPolicies.<policy>.{visible,content}`; sale terms in `customPolicy` with a `title`; `checkoutFields.policyAgreementCheckbox.visible`) |
| Activate order / shipping / abandoned-cart automation | [automations/activation-status.md](../../automations/activation-status.md) |
| Build an abandoned-cart series, post-purchase follow-up, review-request automation | [automations/build-and-manage-automations.md](../../automations/build-and-manage-automations.md) |
| Draft BFCM email campaigns; schedule them (needs the merchant's confirmed subject, audience and time) | [marketing/review-and-send-email-campaigns.md](../../marketing/review-and-send-email-campaigns.md) |
| Create a Black Friday category of discounted products | [stores/manage-store-categories-catalog-v3.md](../../stores/manage-store-categories-catalog-v3.md) |
| Build customer segments and label contacts | [contacts/find-contacts.md](../../contacts/find-contacts.md), [contacts/bulk-label-and-unlabel-contacts.md](../../contacts/bulk-label-and-unlabel-contacts.md) |
| Gift card product | [ecommerce/gift-cards/ecom-gift-cards-goal-sell-gift-cards.md](../gift-cards/ecom-gift-cards-goal-sell-gift-cards.md) (one per site) |
| Email signup / VIP waitlist form | [forms/create-form.md](../../forms/create-form.md) |
| Connect GA / Meta Pixel / TikTok | Create Marketing Tag `POST https://www.wixapis.com/marketing/v1/tags` (the tag object mirrors the fields the checks file reads back from `GET /marketing/v1/tags`; confirm the body in the Wix REST docs before calling); needs the merchant's tracking ID, never invented |

## Suggestions (Part 2)

Offer at most three, chosen by this week's stage and what the store lacks. None is set up without approval. To plan the sale itself (offers, windows, which products), switch to [Recommend: eCommerce Strategy](../recommend-ecommerce-strategy.md) and come back here to verify the result.

| # | Suggestion | Agent can | Merchant does |
|---|---|---|---|
| S1 | Start the sale before Black Friday (46% of shoppers start buying before November) | Propose a schedule; move discount start dates | Approve |
| S2 | A month-long plan: tease → early access for subscribers → go public with countdown → reminder → Black Friday → Cyber Monday | Build a dated plan from store data; schedule discounts and draft emails | Approve; place editor items |
| S3 | Give Cyber Monday its own offer | Suggest an offer that doesn't stack with Black Friday's; create it | Approve |
| S4 | Plan for after Cyber Monday: bring first-time buyers back | Set up a post-purchase follow-up email automation | Approve |
| S5 | Start paid ads 4–6 weeks before the sale | Remind only | Everything |
| S6 | Black Friday collection / landing page | Create the category from discounted products; draft landing copy | Place the page |
| S7 | Choose what to feature, bundle or skip | Pick from last November's sales and current stock, skipping low-stock and already-discounted items | Approve |
| S8 | Gift guide in three price tiers, in-stock only | Build it from last year's holiday orders and current stock | Place it |
| S9 | Announcement bar with offer and dates | Write the copy | Place it in the editor |
| S10 | Countdown timer | Set end time = discount end | Add the timer |
| S11 | Product ribbons ("Best seller", "Holiday deal", "-20%") | Apply to the right products | Approve |
| S12 | Automatic discounts instead of codes, so savings show on product pages | Convert the BFCM coupon to an automatic discount | Approve |
| S13 | Low-stock messages ("Only 3 left") | List products that would show it | Turn on the setting |
| S14 | Promote gift cards all month | Check a gift card product exists; suggest where to promote | Place |
| S15 | Free-shipping banner in the header, threshold above average order value | Suggest the threshold from AOV | Place the banner |
| S16 | Extended holiday returns ("until Jan 31") | Draft and set the checkout return policy | Approve |
| S17 | Holiday shipping cutoffs ("Order by Dec 15") | Work out dates from delivery times; draft banner + FAQ text | Approve, place |
| S18 | Delivery estimates at checkout | Add estimates to shipping options (also check 9) | Approve |
| S19 | VIP early-access waitlist popup | Create the form, write the copy | Place it |
| S20 | Segment the list: VIPs, repeat buyers, one-time buyers, last year's holiday buyers who haven't returned, signed-up-never-bought | Build segments from orders and contacts, show sizes, suggest an offer each, label contacts | Approve |
| S21 | Abandoned-cart series (2–3 emails) | Create the automation and write the emails | Approve |
| S22 | SMS / WhatsApp opt-in | Check availability for region and plan | — |
| S23 | FAQ: shipping times, returns, order tracking | Write answers from real policies and shipping settings | Place |
| S24 | Videos / UGC on top 5 sale products | List which have no video | Generate with Creatify on Wix |
| S25 | Product reviews | Check reviews are on, list products with none; offer a review-request automation | Approve |

## Guardrails

- **Never place an order, never charge anything.** Test carts are created and deleted; `Place Order` and `Get Checkout URL` are never called. In a browser, the agent stops at the payment step: it never enters card details, an email, an address or any personal data, never submits a form, never logs in, and never accepts or declines the cookie banner (its appearance is the evidence; leave it).
- **A browser is used only on the merchant's own live site** (the site URL from the site context, plus Google and Meta pages only if the merchant asks). No other sites.
- **Never change a price, a discount, stock, a policy, an email or a contact label without the merchant naming it.** Reading is free; writing needs a yes per fix. Sending or scheduling an email needs the merchant's confirmation of subject, audience and time, as the campaigns recipe requires.
- **Read-only probes never abort the review.** One failed call becomes one ❔ line; the other checks still report.
- **Nothing Wix-specific from memory.** Endpoints and fields come from the checks file (verified) or another recipe in this index; anything else is confirmed in the Wix REST docs first.
- **Do not ask the merchant for data the API already has** (dates, currency, stock, which coupons exist, how many emails are scheduled). Ask for what only they know: expected demand beyond last year, a tracking ID, the offer, which fix to apply.
- **Wording:** a store owner is reading. "Coupon BF25 has no usage limit" not "usageLimit is undefined".

## Common mistakes

| Mistake | Fix |
|---|---|
| Asking for sale dates before reading discounts | Read coupons and rules first; the question is 🔧 item 1 when none are dated |
| Reporting a failed call as 🔧 or as broken | It is ❔ in the checklist; 🔧 needs evidence of a real problem the agent can change |
| Putting merchant-only tasks in the 🔧 list, or agent-fixable problems in the checklist | Decide by who acts; split a check when both do |
| Leading with problems and burying the verdict | Verdict line, this week's stage, then ✅, 🔧, ✋ |
| Comparing coupon dates in UTC | Convert epoch-ms coupon times and ISO rule times to the store time zone before stating them |
| Calling `inventory.availabilityStatus` "stock" | Quantities live in inventory items; the product field has no number |
| Treating an untracked variant as 0 units | Untracked means unlimited; it is a check-15 finding, not a sell-out |
| Reading script text as page content, or looking for `/product-page/` links | Scripts are stripped in the probe; product and category links are matched by their own URL paths |
| Leaving the test cart behind | Delete it in the same function, in a `finally` |
| Forgetting payments | Check 3 is always the first checkbox; nothing else matters if the store can't take money |
| Counting sent emails from `dateUpdated` | Use `distributionStatus` and `publishingData.datePublished`; `dateUpdated` changes on every edit |
| Running only this week's checks | Every check runs every time; the stage only orders the report |
| Skipping the browser pass because the HTML probe already ran | HTML shows what is served, not what is seen; with a browser, open the pages. Without one, the visual checks are the first checklist group |
| Reporting a visual check as ✅ from HTML alone | HTML evidence gives at most "the bar's text is present"; visibility, layout, timer behaviour and the crossed-out price need a browser or the merchant |
| Paying, typing personal data or logging in during the browser pass | Stop at the payment step; the cart and checkout pages are only looked at |
| Setting up suggestions unasked | Offer three, do none without approval |
| Leaving out the 🔧 block because the merchant said "just review" or nothing seemed fixable | The block always prints; read-only changes the ask, not the list; an empty block says so in one line |
