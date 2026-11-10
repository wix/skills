---
name: "Black Friday Readiness Review"
description: "Reviews a Wix store before Black Friday, Cyber Monday or any dated sale and reports, in one checklist-style report with a weekly focus, what already works, what the agent can fix on approval, and what only the store owner can do. Covers the 28 checks of the BFCM checklist: catalog and stock, payments, test carts for shipping and coupons, discounts and their dates, checkout policies, emails and automations, tracking tags, Google readiness and expected order volume, plus a look at the live site when a browser is available. Use when a store owner asks to review, audit, check or prepare their store for Black Friday, BFCM, a holiday sale or 'the sale', or pastes a pre-made prompt saying so. Requires Wix Stores; catalog and stock checks need Catalog V3."
---

# Black Friday Readiness Review

One pass over a Wix store's backend, graded against the Black Friday / Cyber Monday checklist, delivered as one report in three blocks: what already works, what the agent can fix (one approval), what the merchant does (a checklist with links). The checklist is the BFCM Webinar 2026 one, built from ~13,000 Wix stores.

**Principle: verify from data, never from assumption.** Every ✅ in the report is backed by an API response the agent read, or a page the agent opened and looked at, in this session. A check the agent could not read or see is handed to the merchant as a checklist item with the exact page to open, never reported as passed.

**Two eyes.** The backend tells you what is configured; only the live site tells you what a customer sees. When the agent has a tool that opens a web page and returns what it shows (a browser, a screenshot tool, a page reader with rendered text), it opens the store and looks. When it does not, the visual checks become the first group of the merchant's checklist, each with the page link and what to look for, on desktop and on a phone.

## When to use

- The user asks to review, audit, check or prepare their store for Black Friday, Cyber Monday, BFCM, a holiday sale, or "the sale".
- The user pastes a pre-made prompt such as "Review my store X and make sure I'm all ready for Black Friday."
- The user asks one checklist question on its own ("are my coupons set up right?", "will my shipping work?"): run only that section, same report format.

Not for: designing the sale strategy from scratch (route to [Recommend: eCommerce Strategy](../recommend-ecommerce-strategy.md), then come back here to verify it), traffic acquisition (marketing), sites without Wix Stores (say so; offer the policies, emails and tracking sections only).

## Flow

1. **Context** — tell the owner in one line that you are checking their store and that nothing will change (see [How to talk to the store owner](#how-to-talk-to-the-store-owner)). Then [Read Account or Site Context](../../sites/read-site-context.md) for the named site. Take `siteId`, site URL, created date, time zone, currency, and read the Wix Stores line of its app list: `hasStores` must be true and `storesCatalogV` says `V3` or `V1`. No Stores: say so and run only the policies, emails and tracking sections. `V1`: the catalog, inventory and category probes below are V3-only, so skip the catalog, stock and test-cart checks, say why, and run the rest; never call the V3 endpoints on a V1 store. Several sites and none named: ask which one. No site URL in the context means the site is not published: do not look for one (no docs search, no account-level site query, no site list). Leave `SITE_URL` empty, send Probe 1 whole and unchanged, and put "Publish your site" first in the checklist. This recipe reads its own site fields; do not run eCommerce: Load Context for the review. It is loaded only later, if the merchant approves creating a discount (see the fixes table).
2. **Which sale, which stage** — Black Friday is the default, not the limit: the same checks apply to any dated sale. An event the user names (Black Friday, Christmas, Mother's Day, Singles' Day, a store anniversary, any date they give) is the sale, whether or not it appears on any list. "The holiday" or "the sale" with no name: take the next major shopping event for the store's country that falls within six weeks of today (the event calendar in [Flow: Seasonal Promotion](../pricing-promotions/ecom-pricing-flow-seasonal-promotion.md) is a starting list, not a limit), name it in the report's first lines as an assumption, and do not ask. Six weeks, not the flow's 30 days: the flow's window decides when to create a discount, this one only names the sale, and the checklist's first stage starts 25 days out. Ask one question, which holiday and on what date, only when nothing falls in those six weeks, or two events are equally near and the answer would change the dates. Then pick the stage from the [timing table](#when-the-review-runs) below by the days left to the sale day. The stage decides the order of the report, never which checks run: every check runs every time.
3. **Sale window** — never ask for dates up front. Read them from the coupons and discount rules in step 4; a coupon or rule whose window covers the sale week *is* the sale. When nothing dated exists, deliver the full report anyway with "Set up your <sale name> discount" as the first fix under "Needs one answer from you", asking for the offer and the dates and suggesting both.
4. **Read everything in one call** — Probe 1 in [Black Friday Readiness Checks](black-friday-readiness-checks.md): one JavaScript function run against the Wix REST API with the site's credentials (the probes are written for a tool that executes such a function; without one, make the same REST calls one by one), every read in `Promise.allSettled`, a failed read returned as its own `{ ok: false }` and never thrown. Catalog, inventory, categories, coupons, discount rules, shipping, checkout policies, marketing tags, automations, email campaigns, gift card product, cookie banner, site properties, pages, orders, the live homepage.
5. **Test carts** — Probe 2, a second function run after the reads: temporary carts priced per shipping region and per coupon code, deleted in `finally`. No order is placed, no customer created. The report says so. Skip when the catalog has no purchasable product.
6. **Look at the live site** — Probe 3 in the checks file. With a browser tool: open the homepage, the sale category page, one discounted product page, the cart with one item added, and the checkout up to (never through) the payment step; once on a desktop width and once on a phone width when the tool can resize; screenshot each page when the tool can. Record what is seen for checks 4–10 and 12. Without a browser tool: say so in the report header, and every visual check becomes a checkbox under **On your live site** with its URL and what to look for. Never guess what a page looks like from its HTML.
7. **Grade and write in one pass.** Before the report the API is read by exactly three calls: the site context, Probe 1 and Probe 2 (plus Probe 2's variant lookup when every product has options). Probe 2 always runs when a product can be bought. No follow-up read of a single endpoint, no second homepage fetch, no docs or schema search: what those results do not hold is ❔ in the checklist. Go down the checks in order, apply each pass rule once, and write its line straight into the contract below. Do not plan the report first and do not revisit a check: the template, the limits and the order are fixed, so there is nothing to design.
8. **Offer fixes, apply on approval.** Everything the agent can change goes in the 🔧 block, numbered, in two groups: ready to apply, and needs one answer. Change nothing until the merchant approves, and always offer a way to say no. A discount, coupon or price change, an email send or schedule, and a contact label each get their own yes or no with the exact values (see [Asking for approval](#how-to-talk-to-the-store-owner)). Writes go through the matching `wix-manage` recipe (table below). After each write, read it back and tell the merchant in one line what changed and what the value was before.

## Status legend

Every finding lands in exactly one block, decided by **who acts**:

| Mark | Block | Rule |
|---|---|---|
| ✅ | Already working | Verified from an API response, or seen on the live site in a browser; the pass rule holds on real data |
| 🔧 | I can fix these | Verified problem whose fix has a row in the [fixes table](#fixes-and-where-their-recipe-lives), pending the merchant's yes |
| ✋ | Your checklist | A task or confirmation only the merchant can do (editor, inbox, external tool, a toggle with no public API, a business decision), and every visual check when the agent has no browser |
| ❔ | Your checklist → "I couldn't check these" | Call failed or the API does not expose it; say how to check by hand. Never downgrade to 🔧 or upgrade to ✅ |
| ➖ | omitted | Not relevant to this store; at most one line at the end |

A check with two parts (agent fixes the data, merchant confirms in the editor) is split: the agent part goes to 🔧, the merchant part to ✋.

## The checks

Numbers are the checklist's; each has its data source and pass rule in the checks file.

**A. Checkout, payments & catalog** — 1 test cart prices without errors (merchant places one real order) · 2 every visible product has an image, a price above 0 and a description · 3 payments connected and the methods customers expect are on: cards, Apple Pay, Google Pay, PayPal, buy-now-pay-later (merchant toggles; no public read).
**B. Sale merchandising (live homepage)** — 4 announcement bar shows the sale and its dates match the discount window · 5 every product the homepage links to is in stock · 6 discounted products carry a compare-at price (the crossed-out original) · 7 a countdown timer, if present, ends when the discount ends · 8 the sale category is in the site menu.
**C. Shipping** — 9 each region prices a test cart above and below the free-shipping threshold, and every shipping option shows a delivery estimate.
**D. Policies & legal** — 10 return/shipping policy at checkout and linked in the footer · 11 sale terms exist (dates, exclusions, stacking, final-sale) · 12 Terms, Privacy and cookie banner in place.
**E. Stock** — 13 sale and best-selling products have stock for expected demand · 14 low-stock alerts (merchant) · 15 inventory tracking on for limited-quantity products.
**F. Coupons & discounts** — 16 a dated discount or coupon for the sale exists, in the store time zone · 17 each coupon applies on a test cart with the expected amount and minimum · 18 coupon + automatic discount together never price a line below cost · 19 the sale does not stack on products already discounted · 20 coupons have total and per-customer limits · 21 everything is scheduled: discounts, coupons, emails (banners and timers: merchant).
**G. Emails & tracking** — 22 order confirmation, shipping confirmation and abandoned-cart automations ACTIVE · 23 at least 4 email campaigns for the sale scheduled or sent · 24 Google Analytics, Meta Pixel, TikTok Pixel connected.
**I. Google & AI search** — 25 Google Merchant Center connected (merchant; no public read) · 26 product data ready: clear titles, brand, descriptions · 27 Google / Meta feeds synced, no rejections (merchant).
**H. Operations** — 28 expected order volume from the same sale's week last year and the last 30 days.

## Report contract

Write exactly this structure: it fixes what the report says and in what order. [How it looks](#how-the-report-looks) and [how to talk to the store owner](#how-to-talk-to-the-store-owner) follow below.

```
# <Sale name> readiness: <Store name>
**<Status>. <The worst problem in plain words, or what is left>. <The next step>.**
<"17 days to Black Friday, Nov 27" or "Black Friday is today" or "Black Friday ended 5 days ago"> · <X> of <Y> products can be bought · <the offer and its dates, or "no sale set up yet"> · <F> fixes I can make, <C> tasks for you
<Only when the owner did not name the sale: "I assumed your sale is <sale name>, <date>. Tell me if it's a different one.">
<Only when nothing stops sales: this week's line from the timing table, not bold.>

## ✅ Already working
- **<What works>.** <One line of evidence with real names and numbers.>
(up to three lines, then: And <N> more checks passed. Say "show passed" to see them.)

## 🔧 I can fix these. Approve the ones you want
Nothing changes until you approve.
**Ready to apply**
1. <"Stops sales." when it does> <Problem in one line with evidence.> I'll <exact change>.
**Needs one answer from you**
2. <"Stops sales." when it does> <Problem in one line.> I suggest <an answer taken from the store's data>. Reply "2" to use that, or tell me <what you want instead>.
Reply with the numbers to approve, "all" for the ready fixes, or "none" to leave everything as it is.
I apply them one at a time and tell you what changed. For discounts, coupons, prices and emails, I show you the exact change and ask once more first.
(When nothing is fixable, the block is the heading "## 🔧 Nothing for me to fix" and one line: "What's left is in your checklist." Leave that line out when the checklist is empty too.)

## 📋 Your checklist
### In your dashboard
- [ ] Check that you can take payments. [Open Accept payments](https://manage.wix.com/dashboard/<siteId>/wix-cashier/payments). Without it, nobody can pay.
- [ ] Turn on Apple Pay, Google Pay and PayPal. [Open Accept payments](https://manage.wix.com/dashboard/<siteId>/wix-cashier/payments). Customers leave when their way to pay is missing.
- [ ] <What to do.> [Open <page>](https://manage.wix.com/dashboard/<siteId>/<route>). <Why, in a few words.>
### On your live site  (only when the agent had no browser, or for what it could not reach)
Tell me what looks wrong and I'll help fix it.
- [ ] Open [your homepage](<site URL>) on your phone. Check that the <sale name> bar shows without scrolling and says <dates>.
- [ ] Open [each featured product](<site URL>). Check that you can add it to the cart.
- [ ] Open [a discounted product](<product URL>). Check that the original price is crossed out next to the sale price.
- [ ] Add an item to the cart and go to checkout, without paying. Check that shipping options and the return policy link appear.
- [ ] Open your site in a private window. Check that the cookie banner shows.
- [ ] <one check per line for anything else that could not be seen, with its URL>
### In the editor
- [ ] <What to do.> <Why, in a few words.>
### Place a test order
- [ ] Buy one product with a real card, then refund it. This is the only way to know checkout works from start to finish.
- [ ] <What to check after it: the confirmation email, the order in your dashboard, the purchase in Google Analytics.>
### In Google and Meta
- [ ] <What to do.> [Open Google channel](https://manage.wix.com/dashboard/<siteId>/wix-stores/channel/google). <Why, in a few words.>
### Packing and shipping
- [ ] <What to do.> <Why, in a few words.>
### I couldn't check these
- [ ] <What could not be checked.> <What to open and what to look for.>
(only the groups that have items; one check per checkbox; order and limits are in the rules below)

## 💡 Ideas for your sale
- <Suggestion.> I can <set up>. You <do>. (up to three, from the suggestions table, matching this week's stage and what the store lacks)

How I checked: I read your store's settings on <date> and tried shipping and coupons on test carts. <"I also opened your site on desktop and phone." or "I couldn't open your site to look at it, so your checklist asks you to look at those pages yourself."> Nothing was ordered or changed.
```

Rules for the report:
- **🔧 always prints, and its membership is mechanical.** A finding goes in 🔧 when its fix has a row in the fixes table; a finding with no row goes to the checklist. Never decide by feel, never merge the two lists, never drop the block because it is empty.
- **"Don't change anything" limits writes, not the offer.** A read-only request gets the same report with the same 🔧 list. The line under the heading becomes "You asked me not to change anything, so I haven't. To apply one, reply with its number.", and no apply button is drawn. Nothing is ever written without a yes that covers that item: its number, "all" for the ready fixes shown, or the apply button with the item selected.
- **Verdict first, and it ends with the next step.** The status is "Ready, once you check payments" (payments can't be read, so plain "Ready" is never used), "Almost ready" or "Not ready yet". A broken checkout, a coupon that doesn't apply, or a region with no shipping makes it "Not ready yet" regardless of how many ✅ follow. "Not ready yet. Nobody can buy your 27 books because they show as out of stock. Give me the quantities and I'll fix it." The two counts are the number of 🔧 items and the number of checkboxes; a split check counts once in each.
- **One order, and payments wins in the checklist.** In 🔧: first anything that stops sales, with "Stops sales." at the start of its line, then what belongs to this week's stage, then the rest by damage: checkout > discounts wrong > stock > policies > emails > tracking > Google. In 📋: payments is always the first checkbox, even ahead of another item that stops sales, because nothing else matters if the store can't take money. The one exception is a site that is not published: "Publish your site. Customers can't buy until it's live." goes above payments, and the verdict names it. Then anything that stops sales, then the same order as 🔧. Groups follow their most urgent item, so "In your dashboard" is always the first group.
- **Evidence names things:** "3 of 42 products have no image: Oak Mug, …", "coupon BF25 has no usage limit", "In Germany a €48 order ships free. Your free shipping should start at €60."
- **🔧 items say the exact change, in two groups.** "Ready to apply" holds fixes that need nothing from the merchant. "Needs one answer from you" holds fixes that wait on a quantity, a tracking ID, an offer or a date: each suggests an answer from the store's data, and replying its number accepts that suggestion. Number the two groups as one list. "All" and the apply button never cover a fix that still needs an answer, or a fix that is not shown.
- **✋ items are tasks, written as checkboxes** (`- [ ]`), grouped by where the merchant does them, each with a dashboard link when a route exists. Checkboxes render as a real checklist where Markdown task lists are supported and as readable text elsewhere.
- **Visual checks name the page and the thing to look at.** "Open your homepage on your phone. Is the bar visible without scrolling?" not "verify the announcement bar". Each line links the exact URL (site URL, sale category URL, product URL) from the probe data. When the agent did look, the ✅ or 🔧 line says what it saw ("the bar reads 'Black Friday 30% off Nov 27–30', matches your discount").
- Never show an API error or request id to the merchant; ❔ says "I couldn't check your shipping settings" and how to check them instead.
- Dashboard base `https://manage.wix.com/dashboard/<siteId>/`. Routes allowed, all from the [dashboard navigation](../../dashboard-navigation/dashboard-navigation.md) and [automations](../../automations/build-and-manage-automations.md) recipes: products `wix-stores/products`, inventory `wix-stores/inventory`, categories `wix-stores/categories/list`, store settings `wix-stores/settings`, Google channel `wix-stores/channel/google`, orders `ecom-platform/orders-list`, abandoned checkouts `ecom-platform/abandoned-checkouts`, shipping `ecom-platform/delivery-profile`, tax `ecom-platform/tax`, checkout settings `ecom-platform/checkout-settings`, gift cards `ecom-platform/gift-cards`, accept payments `wix-cashier/payments`, automations `triggers`, email campaigns `email-marketing/my-campaigns`. No other route from memory; without one, name the page in words.

## How the report looks

The store owner should be able to see where they stand in five seconds and act with one tap. Use the richest presentation the client can draw. When it can draw cards, status labels, selectable lists and buttons, use them as mapped below. When it can only show text, the Markdown in the contract is the fallback and must read just as clearly. The content and its order are the same either way.

| Part of the report | With rich UI | Text fallback |
|---|---|---|
| Verdict | A status label next to the sale name, with the verdict sentence beside it | The bold verdict line |
| Headline numbers | A row of up to four cards, below | The line under the verdict: "17 days to Black Friday, Nov 27 · 0 of 27 products can be bought · no sale set up yet · 5 fixes I can make, 7 tasks for you" |
| This week | A quiet note under the cards, only when nothing stops sales | The line from the timing table |
| ✅ Already working | A short list with check marks | The bullet list |
| 🔧 I can fix these | The ready fixes as a selectable list, preselected, each saying what will change. Fixes that need an answer sit below them, not selectable, each with its suggestion. Two buttons: "Yes, apply N fixes" ("Yes, apply 1 fix" for one) and "No, cancel". N counts only the selected ready fixes. Choosing items changes nothing; only the first button does | The numbered list and its reply lines |
| 📋 Your checklist | Checkboxes the owner can tick, grouped by place, each with a button that opens the right page, labelled in Title Case ("Open Accept Payments") | `- [ ]` lines with links |

**The cards on top.** Up to four, in this order, each one number or one short phrase with a plain label. Red when it stops sales, amber when it needs attention, green when it is fine; the words on the card carry the meaning, never the colour alone.

1. **Days to the sale** — "17 days to Black Friday" or "9 days to Mother's Day". On the day: "Black Friday is today". After it: "Black Friday ended 5 days ago".
2. **Products customers can buy** — "0 of 27", taken from `stockSummary` in the checks file (`canBeBought` of `visibleProducts`).
3. **Your sale** — "No sale set up yet", or the offer and its dates: "25% off · Nov 16–29".
4. **Left to do** — "5 fixes I can make · 7 tasks for you".

A card shows only what was read from the store in this session. When a number could not be read, leave that card out; never show a guess, and never add a card for something that cannot be read (payments, for example).

**No extra sections.** Problems that stop sales are not listed in a block of their own: they go first inside 🔧 or 📋, with "Stops sales." at the start of the line, and the verdict names the worst one. Saying the same problem twice makes the report longer, not clearer.

## How to talk to the store owner

The owner is busy, is often on a phone, and may be worried about the sale. Every message leaves them knowing where they stand and what to do next. This section applies to the report and to every message around it.

**Voice.** Calm, direct and on their side. Friendly, never cute. Never blame: say what is missing and how to fix it, not what they forgot. No exclamation points, no "please", no "sorry", no "we". "I" is only for what you checked or will change. "You" and "your" are for the store.

**Say less.** A report the owner can read in about a minute beats a complete one they skim. Keep the whole report to about 500 words; when it runs over, cut the least urgent lines first.
- Lead with the answer. One idea per sentence. No introduction, no recap, no account of how you worked beyond the last line of the report.
- A line fits on two phone lines, about 25 words.
- ✅ Already working: up to 3 lines, the sale's dated discount first when one exists, then "And <N> more checks passed. Say 'show passed' to see them."
- 🔧 fixes: every ready fix is shown, because "all" and the apply button act on what the owner can see. Fixes that need an answer: up to 3, then "<N> more need an answer. Say 'show all' to see them."
- 📋 checklist: payments and anything that stops sales, then up to 5 more, then "<N> more, less urgent. Say 'show all' to see them."
- A finding about many products is a count and up to three names: "4 products have no image: Oak Mug, Wick Trimmer, Gift Box."
- Suggestions: up to 3.
- Outside the report, a message is one to three sentences.
- Details come only when the owner asks, and then only for the item they asked about.

**Words.**
- **Keep the names the owner sees in Wix** for anything they will open or search for: Automatic discounts, Coupons, Automations, Inventory, Accept payments. Add a few plain words the first time: "an automatic discount, a sale price that applies by itself with no code".
- **Say what the customer or the owner sees** for everything else: "set up", "check", "turn on". No API names, field names, error codes or JSON, and no abbreviations such as BFCM or AOV.
- **"Customers"**, never the word "shoppers" and never "users".
- **Every task says** what to do, gives the link that opens the page, and says why it matters. Never describe where a button is.
- **Real names and numbers from this store**, never placeholders.
- **Punctuation and case.** No em dashes: use two sentences. Buttons are Title Case, except the yes and no replies below. Everything else is sentence case.
- **Answer in the language the owner writes in.** Dates, times and money use the store's format, currency and time zone.

| Write this | Not this |
|---|---|
| Your 27 books show as out of stock, so nobody can buy them | The inventory API contains entries only for three hidden products |
| An automatic discount, a sale price that applies by itself with no code | A discount rule |
| The original price, shown crossed out | Compare-at price |
| Inventory tracking is off for 4 products, so they can oversell | trackQuantity is false on 4 variants |
| Your abandoned cart email is off, so customers who leave items in their cart get no reminder | The abandoned-cart recovery automation is inactive |
| The "I agree to the terms" checkbox at checkout | policyAgreementCheckbox |
| Delivery time shown at checkout | Delivery estimate on the shipping option |
| Google Analytics and Meta tracking | Marketing tags, pixels |

**What to say at each moment.** One pattern each. Keep the shape, use the store's own names and numbers.

| Moment | Pattern | Example |
|---|---|---|
| Before the first read | One line: what you are doing, how long, and that nothing changes | "I'm checking your store for Black Friday. This takes a few minutes and changes nothing." |
| Which store | Numbered options and how to reply. Never the word "confirm" | "Which store should I review? 1. The Thriller Room 2. Ember and Oak. Reply with the number." |
| Which sale | One question, only when step 2 cannot tell | "Which sale are you preparing for, and on what date?" |
| Before a change that customers see, or that can't be taken back | See the approval rules below | "To approve: **create an automatic discount** of 20% on all products, from Nov 16 00:00 to Nov 29 23:59, Berlin time. Customers see the lower prices as soon as it starts. Reply "yes" to create it, or "no" to leave your prices as they are." |
| After a fix | What changed, the new value, the old value, how to undo it | "Done. Coupon BF25 now ends Nov 29 at 23:59, Berlin time. It had no end date before. Say "undo BF25" to put it back." |
| A fix failed | What did not happen, that nothing else changed, the next step | "I couldn't update the coupon, and nothing was changed. You can set the end date yourself: Open Coupons." |
| Something couldn't be checked | What, and how to check it | "I couldn't check your shipping settings. Open Shipping and check that every country you sell to has a rate and a delivery time." |
| After the fixes | The new standing and what is left | "You're almost ready now. 4 things are left for you, starting with payments." |

**Asking for approval.** The agent proposed these changes, so the owner approves them. Getting this moment right matters more than any other line.
- **Say what will change and what happens when it does**, in the sentence itself, not in brackets.
- **Always give a way to say no.** In text: the reply line names "none". With buttons, for the list: "Yes, apply N fixes" and "No, cancel". For one change: "Yes, create it" or "Yes, send it", naming the action, and "No, cancel".
- **"All" covers only the ready fixes the owner can see.** A fix that needs an answer waits for it, and a hidden fix is never applied.
- **Three kinds of change get their own yes or no, even after "all":** creating or changing a discount, coupon or price; sending or scheduling an email; labelling contacts. Restate the exact values, bold the action and its object, say when customers will see it, and say plainly when it can't be undone, as a sent email can't.
- **After each change, say what the value was before**, so the owner can ask to put it back, and name the thing in the undo: "undo BF25". Undo writes the old value back, or turns off what was created, and is itself a change the owner asked for.
- Never ask "Are you sure?". Name the decision.

## When the review runs

Shopping starts early and ends late; a single check the day before the sale is too late for many items. Pick the stage from how many days remain to the sale day. The dates column is Black Friday 2026 (Nov 27; Black Friday is the Friday after the fourth Thursday of November, US Thanksgiving). For any other sale, or another year, use the days column. The stage names are for you; the owner reads only the line in the fourth column.

| Days to the sale day | Black Friday 2026 | Stage | The line the owner reads | What the report puts first |
|---|---|---|---|---|
| 25–19 | Nov 2–8 | Tease | This week: Get your products ready for Google and start telling customers about the sale. | Google readiness (25–26), gift guide (S8), VIP waitlist (S19), paid ads started (S5) |
| 18–12 | Nov 9–15 | Early access | This week: Give your subscribers first access to the sale. | Segments (S20), 4+ emails scheduled (23), early-access offer for subscribers (S2), payment methods (3) |
| 11–5 | Nov 16–22 | Go public | This week: Put the sale on your site. | Announcement bar, countdown, sale category in the menu, ribbons, automatic discounts, free-shipping banner (4–8, S6–S15) |
| 4–1 | Nov 23–26 | Final check-up | This week: Run the final checks before the sale. | All of Part 1: test order, coupon and shipping tests, stock, policies, everything scheduled (21) |
| 0, and up to 3 after | Nov 27–30 | Sale days (Black Friday · Cyber Monday) | Your sale is on. Check orders, stock and coupons every day. | Everything live now (1, 9, 16–17, 22); for Black Friday, a separate Cyber Monday offer (S3) |
| 4 or more after | December | Finish late | After the sale: Take down sale banners and email your new customers. | Shipping cutoffs (S17), second-purchase follow-up (S4), countdowns and banners taken down (4, 7) |
| More than 25 | Any other date | Preparation | You have time: Get the basics right first. | Order by damage; mention the first stage ahead |

## Fixes and where their recipe lives

Apply only what the merchant names. Load the recipe, follow it, confirm with a read-back in the same call.

| Fix | Recipe |
|---|---|
| Write missing or weak product titles, brand, descriptions; set compare-at prices; add ribbons | [stores/update-product-with-options.md](../../stores/update-product-with-options.md) (ribbons: Get or Create Ribbon in [ecommerce/ecom-pricing.md](../ecom-pricing.md)) |
| Turn on inventory tracking, set quantities | [stores/update-product-stock-and-pre-order.md](../../stores/update-product-stock-and-pre-order.md) |
| Create or fix a coupon: dates, usage limits, minimum | [ecommerce/pricing-promotions/ecom-pricing-create-coupon.md](../pricing-promotions/ecom-pricing-create-coupon.md) |
| Fix an existing automatic discount: dates, scope, exclusions; convert a coupon to an automatic discount | [ecommerce/pricing-promotions/ecom-pricing-create-discount-rule.md](../pricing-promotions/ecom-pricing-create-discount-rule.md) |
| Create the sale's discount when none is dated (Black Friday, a separate Cyber Monday offer, any other holiday) | [Goal: Seasonal Revenue](../pricing-promotions/ecom-pricing-goal-seasonal-revenue.md), then its [Flow: Seasonal Promotion](../pricing-promotions/ecom-pricing-flow-seasonal-promotion.md), for which products and how much off. Dates and the number of rules follow [Sale dates](#sale-dates-when-creating-a-discount) below, not the flow. Build the request body as [Create Discount Rule](../pricing-promotions/ecom-pricing-create-discount-rule.md) shows it (`POST https://www.wixapis.com/ecom/v1/discount-rules`), not from the example in the flow |
| Fix free-shipping threshold, missing region, add delivery estimates | [ecommerce/ecom-shipping.md](../ecom-shipping.md) dispatcher ([ecommerce/shipping/ecom-shipping-api.md](../shipping/ecom-shipping-api.md) for Update Shipping Option) |
| Policy text at checkout (return, terms, privacy, sale terms, extended holiday returns); show the "I agree" checkbox | Update Checkout Settings `PATCH https://www.wixapis.com/ecom/v1/checkout-settings` (`checkoutPolicies.<policy>.{visible,content}`; sale terms in `customPolicy` with a `title`; `checkoutFields.policyAgreementCheckbox.visible`) |
| Activate order / shipping / abandoned-cart automation | [automations/activation-status.md](../../automations/activation-status.md) |
| Build an abandoned-cart series, post-purchase follow-up, review-request automation | [automations/build-and-manage-automations.md](../../automations/build-and-manage-automations.md) |
| Send or schedule the sale's email campaign drafts (needs the merchant's confirmed subject, audience and time) | [marketing/review-and-send-email-campaigns.md](../../marketing/review-and-send-email-campaigns.md) |
| Create a sale category, named for the sale, from the discounted products | [stores/manage-store-categories-catalog-v3.md](../../stores/manage-store-categories-catalog-v3.md) |
| Build customer segments and label contacts | [contacts/find-contacts.md](../../contacts/find-contacts.md), [contacts/bulk-label-and-unlabel-contacts.md](../../contacts/bulk-label-and-unlabel-contacts.md) |
| Gift card product | [ecommerce/gift-cards/ecom-gift-cards-goal-sell-gift-cards.md](../gift-cards/ecom-gift-cards-goal-sell-gift-cards.md) (one per site) |
| Email signup / VIP waitlist form | [forms/create-form.md](../../forms/create-form.md) |
| Connect GA / Meta Pixel / TikTok | Create Marketing Tag `POST https://www.wixapis.com/marketing/v1/tags` (the tag object mirrors the fields the checks file reads back from `GET /marketing/v1/tags`; confirm the body in the Wix REST docs before calling); needs the merchant's tracking ID, never invented |

### Sale dates when creating a discount

The checklist this review grades against is the source for timing. Where the Seasonal Promotion flow says otherwise, this section wins.

- **The merchant's own dates always win.** Propose the dates below only when they gave none, and create nothing until they approve them.
- **Start in the Go public week, not 3–5 days ahead.** Propose the public discount from 11 days before the sale day (Nov 16 for Black Friday 2026), or from today when that day has passed. Never start in the past.
- **Early access is for subscribers.** In the Early access week the offer is a coupon sent to the list, not a public automatic discount.
- **End on the day customers expect, in the store time zone.** Black Friday: the rule ends Sunday 23:59 of that weekend (Nov 29 in 2026). Cyber Monday is its own rule, not an extension: Monday 00:00 through Tuesday 23:59 (Nov 30 – Dec 1 in 2026), so the two never apply to the same cart. Any other sale: through 23:59 of the sale day. A sale is never created without an end date.
- The flow reads store analytics from eCommerce: Load Context; load it at this point, not during the review.

## Suggestions (Part 2)

Offer at most three, chosen by this week's stage and what the store lacks. None is set up without approval. To plan the sale itself (offers, which products), switch to [Recommend: eCommerce Strategy](../recommend-ecommerce-strategy.md), keep the [sale dates](#sale-dates-when-creating-a-discount) above, and come back here to verify the result.

| # | Suggestion | Agent can | Merchant does |
|---|---|---|---|
| S1 | Start the sale before the sale day (for Black Friday: 46% of customers start buying before November) | Propose a schedule; move discount start dates | Approve |
| S2 | A month-long plan: tease → early access for subscribers → go public with countdown → reminder → the sale day (then Cyber Monday, for Black Friday) | Build a dated plan from store data; schedule discounts and the email drafts the store already has | Approve; place editor items |
| S3 | Black Friday only: give Cyber Monday its own offer | Suggest an offer that doesn't stack with Black Friday's; create it | Approve |
| S4 | Plan for after the sale: bring first-time buyers back | Set up a post-purchase follow-up email automation | Approve |
| S5 | Start paid ads 4–6 weeks before the sale | Remind only | Everything |
| S6 | A category or landing page for the sale | Create the category from discounted products; draft landing copy | Place the page |
| S7 | Choose what to feature, bundle or skip | Pick from last November's sales and current stock, skipping low-stock and already-discounted items | Approve |
| S8 | Gift guide in three price tiers, in-stock only | Build it from last year's holiday orders and current stock | Place it |
| S9 | Announcement bar with offer and dates | Write the copy | Place it in the editor |
| S10 | Countdown timer | Set end time = discount end | Add the timer |
| S11 | Product ribbons ("Best seller", "Holiday deal", "-20%") | Apply to the right products | Approve |
| S12 | Automatic discounts instead of codes, so savings show on product pages | Convert the sale's coupon to an automatic discount | Approve |
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
- **Do not ask the merchant for data the API already has** (dates, currency, stock, which coupons exist, how many emails are scheduled). Ask for what only they know: expected demand beyond last year, a tracking ID, the offer, which fix to apply. Before the report, only two questions are ever allowed: which site, and which holiday when step 2 cannot tell.
- **Wording:** a store owner is reading; follow [How to talk to the store owner](#how-to-talk-to-the-store-owner).

## Common mistakes

| Mistake | Fix |
|---|---|
| Asking for sale dates before reading discounts | Read coupons and rules first; when none are dated the question is the first fix under "Needs one answer from you" |
| Asking which holiday when the calendar answers it | In November it is Black Friday, in December Christmas; ask only when nothing falls within six weeks or two events tie |
| Treating the review as Black Friday only | Any named sale or holiday gets the same checks; stages run on days to the sale day |
| Reporting a failed call as 🔧 or as broken | It is ❔ in the checklist; 🔧 needs evidence of a real problem the agent can change |
| Putting merchant-only tasks in the 🔧 list, or agent-fixable problems in the checklist | Decide by who acts; split a check when both do |
| Comparing coupon dates in UTC | Convert epoch-ms coupon times and ISO rule times to the store time zone before stating them |
| Calling `inventory.availabilityStatus` "stock" | Quantities live in inventory items; the product field has no number |
| Treating an untracked variant as 0 units | Untracked means unlimited; it is a check-15 finding, not a sell-out |
| Reading script text as page content, or looking for `/product-page/` links | Scripts are stripped in the probe; product and category links are matched by their own URL paths |
| Leaving the test cart behind | Delete it in the same function, in a `finally` |
| Counting sent emails from `dateUpdated` | Use `distributionStatus` and `publishingData.datePublished`; `dateUpdated` changes on every edit |
| Running only this week's checks | Every check runs every time; the stage only orders the report |
| Skipping the browser pass because the HTML probe already ran | HTML shows what is served, not what is seen; with a browser, open the pages. Without one, the visual checks are the first checklist group |
| Reporting a visual check as ✅ from HTML alone | HTML evidence gives at most "the bar's text is present"; visibility, layout, timer behaviour and the crossed-out price need a browser or the merchant |
| Paying, typing personal data or logging in during the browser pass | Stop at the payment step; the cart and checkout pages are only looked at |
| Setting up suggestions unasked | Offer three, do none without approval |
