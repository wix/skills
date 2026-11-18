---
name: "Purchase Domain"
description: "Buy a domain through Wix — domain ideas and suggestions, site and plan, registration period, contacts, privacy, cart and checkout. Availability checks are not done here: they all use Check Domain Availability."
---

# Purchase Domain

One document, three parts. Section numbers carry their part's letter, so every reference names the
part it points into — §S2, §P3, §R4.2.

| Part | Sections | Covers |
|------|----------|--------|
| **Part S** — Search | §S1 – §S4 | Which domain to buy: a named domain, ideas from the user's business or site, suggestions, unsupported extensions. **Start here.** |
| **Part P** — Purchase Path | §P1 – §P10 | Buying a domain from Wix |
| **Part R** — Reference | §R1 – §R10 | Endpoints, product IDs, URL templates, site resolution, error handling, currency |
| Not here | — | A request that doesn't say whether to buy or use a domain the user has, and a domain that turns out to be taken: [Connect Domain](connect-domain.md). Putting a domain the account holds on a site: [Assign Domain](assign-domain.md). A domain registered elsewhere, or a subdomain: [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md) |

**Before any API call, read Part R.** It holds every endpoint, product ID, URL template,
site-resolution rule and error rule used by both of the other parts. Do not guess a URL or a
field name — look it up there.

---

# Part S — Search

Part S takes a request to buy a domain to the point where one **chosen domain** is known to be
buyable, then goes to §P1. Covers **US-03 – US-12** for the purchase path.

The user wants to buy, register or get a domain, or ideas for one. Typical openers: *"buy me a
domain"*, *"I want to purchase a domain"*, *"get me mybusiness.com"*, *"I need a domain for my pancakes
restaurant"*.

⛔ **Availability checks are never done by this recipe.** Every check of whether a domain is available
goes through [Check Domain Availability](check-domain-availability.md). Read that skill, run the check as
it describes, then come back with the result: §R4.1 maps it. Never call the availability endpoints from
this recipe.

The limits on a taken domain — no WHOIS, no owner, no broker or valuation advice — are
[Connect Domain](connect-domain.md) §A1.1, and they hold here too.

**UX rule for everything below:** keep it natural, never expose internal mechanics, and reveal
information only when it changes what the user has to do next. See §R9.

---

## S1. Do We Have a Domain? (US-03, US-04)

**Take the first row that matches, reading top-down.** A domain the user named wins over everything
else in this table — including a site they named in the same breath.

| Situation | Action |
|-----------|--------|
| User named a specific domain — **even if they named a site too** | Normalize it (§R1). A **subdomain** (more than one label before the TLD, read greedily: `.co.uk`, never `.uk`, so `shop.maximz.fr` is one and `mybrand.co.uk` is not) is not registered on its own → [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md), with no availability check. Anything else → run the availability check, **first**, before any site work, and read the result with §R4.1 |
| User gave brand/business context but no domain — *"My business is called Green Sprout Bakery"*, *"I need a domain for my pancakes restaurant"* | **Do not ask.** Build a query from that context → §S3 |
| **No domain, but they pointed at a site** — *"I want a domain for my wix site"*, *"I need a domain for my site"* | **Do not ask for a domain yet.** The site is the context → §S1.2 |
| Nothing at all — *"I want to buy a domain"*, *"help me get a domain"* | Ask, verbatim: **"What domain do you have in mind?"** Then take the answer as either a specific domain (→ the named-domain row) or a description (→ §S3). |
| The user already has a domain and wants it on their site, or isn't sure whether to buy one | **Go to [Connect Domain](connect-domain.md) and follow it.** |

The user answering with a description rather than a domain (*"Something with 'cozycuts' in it"*) is
normal — treat it as a query and go to §S3.

⚠️ **A named domain is checked before anything else happens, and the answer is the first thing the user
hears.** No site resolution, no fetching list of sites, no plan check and no list of sites comes in front of
it. *"I want to buy mybakery.com for my Wix site"* names a site, and the site waits its turn: the check
runs, the user is told *"mybakery.com is available!"* or *"mybakery.com is already registered."*, and
only then does §P1 resolve the site. Asking which of ninety-three sites to use before saying whether
the domain can even be bought answers a question the user has not reached yet.


### S1.2 The User Pointed at a Site but Named No Domain

**This section is only for a message that named no domain, with PURCHASE intent.** A user who has a
domain to connect goes to [Connect Domain](connect-domain.md) instead. If a domain was named as well —
*"buy mybakery.com for my wix site"* — §S1's named-domain row owns it: the check runs first, and the site is resolved
afterwards by §P1. Resolving a site here would put a list in front of the availability answer.

*"I want a domain for my wix site"* names no domain, and it is **not** nothing. Two things arrive with
it, and the old reading of this row threw both away:

- **The site question is already answered.** They want the domain on a site, so §R3's Case D
  question — *"Would you like to connect this domain to one of your Wix sites?"* — must **not** be
  asked. Asking it back is asking them to repeat themselves.
- **The site's name is brand context.** §S3 takes free text, and a site called *Green Sprout Bakery*
  is exactly the query it wants. Never make the user type a business name the account already knows.

So resolve the site **now**, before the domain, and let it do both jobs:

| Site resolution (§R3) | Then |
|------------------------|------|
| Case A — a `siteId` is in context | Take the site's name as the §S3 query. Suggestions and the site named, one message. |
| Case B — exactly one site | Same. Name the site so a wrong guess is visible. |
| Case B — several sites | Ask which one, with §R3 Case B's copy. That question has to be asked anyway, and its answer is also the query — §S3 runs on the reply. |
| Case C — not logged in | No account, so no site name to read. **Do not front-load the login prompt** — fall through to the *"What domain do you have in mind?"* row above. The site intent is remembered, so §R3's Case C prompt lands at its normal time, once a domain is in hand. |
| Case B — no sites at all | Nothing to name and nothing to connect to. Fall through to the bare *"What domain do you have in mind?"* row above, and treat the purchase as standalone. |

Copy when a single site is resolved — §S3's list with its own opening:

> Here are a few available options for **{site name}**:
> - greensproutbakery.com
> - greensproutco.com
> - sproutbakery.com
>
> Want one of these, or do you have something else in mind? I can also show more options if none feel right.

⚠️ **A site name is not always a business name.** Auto-generated names (`Evl 99faa20b7b2b`,
`My Site 3`, a bare hex string) and placeholders carry no brand signal, and querying §S3 on one
returns noise. When the name has no real words in it, treat it as **no context**: keep the resolved
`siteId`, then ask *"What domain do you have in mind?"* — the site still gets used for the plan check
and the auto-connect line, just not for suggestions.

⚠️ **This is the one place the purchase path resolves a site before the domain**, and only because the
user put the site in the request. §P1.1's rule — do not fetch list of sites unless the user asked
about a site — is **satisfied here, not bypassed**. Carry the resolved `siteId` into §P1; the site is
already settled, so the plan check is the next step and the question is never re-asked.

---

## S2. The Domain Is Available (US-08)

Say, verbatim:

> {displayName} is available!

Then:

- **Now go to §P1 and follow it.**
  If a `siteId` is already in context, do not send "…is available!" on its own — continue straight
  into the site + plan outcome (§P1) in the *same* message.

When no `siteId` is in context but the user did ask for a site, the availability answer and §P1's
site question belong in the **same** message — the answer first, the question behind it:

> mybakery.com is available! You have 93 Wix sites. Which one should it go on?
>
> 1. {site name}
> 2. … *(§R3 Case B's forms decide how many)*

One turn instead of two, and the ordering is still answer-then-question.

⚠️ **Suppressing the standalone line is a merge, never a deletion.** The user is told in plain
language that the domain can be bought — exactly once, in the first message that follows the check.
Both continuations carry it, and the merged forms live in §P1.3a and §P2.3, Premium and Free
respectively. If you are about to send a message that offers a plan, a price or a bundle and the user
has not yet heard *"{displayName} is available!"*, the line was dropped rather than merged. Say it.

---

## S3. Suggestions (US-04, US-05, US-06)

### First page — exactly 3

```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query={query}&paging.limit=3
```

**Always `paging.limit=3`.** Three options is the contract — never dump ten.

Query construction:

| Coming from | Query |
|-------------|-------|
| A taken domain | The **SLD only** — `mybusiness.com` → `mybusiness` |
| An unsupported TLD | The **SLD only** — `myshop.ws` → `myshop` |
| A business idea or brand context | The description — `pancakes restaurant`, `Green Sprout Bakery` |

Keep the query short — roughly 12–15 characters works best. Drop filler words
(`thebestflowershopintown` → `bestflowers`), collapse repetition (`gevageva…` → `geva`), abbreviate
(`professional` → `pro`).

Present them as a plain bulleted list of `suggestions[].domain`, then invite both a pick and more:

> Here are a few available options that fit your brand:
> - cozycuts.com
> - cozycuts.co
> - cozycuts.net
>
> Want one of these, or do you have something else in mind? I can also show more options if none feel right.

When the suggestions come from business context rather than a typed domain, open with
*"Here are a few available options based on your business name:"* instead.

Rules:

- Every suggestion returned is already available. **Never re-check one.** (US-06)
- Never show a "premium" column or flag premium suggestions.
- If the user stated a TLD preference, call out the fitting ones (`.com` general, `.shop` / `.store`
  e-commerce, `.me` personal branding).
- No suggestions returned → ask the user for different or broader keywords.

### "Show more" (US-05)

Offer more only when `pagingMetadata.hasNext` is `true`. To actually fetch them, repeat the **same**
`query` and `paging.limit=3` and add `paging.cursor={pagingMetadata.cursors.next}` from the previous
response. `hasNext` alone does not page — without the cursor you get page 1 again.

> Here are more available options:
> - greensproutbakeryshop.com
> - gsbakery.com
> - greensproutco.com

Repeat with each new cursor for as long as the user keeps asking.

### After a pick

The picked domain is the chosen domain. Do **not** check its availability.

**Now go to §P1 and follow it.** A user who came from a connect request is now picking a domain to
buy: treat it as a purchase.

---

## S4. Unsupported TLD (US-10, US-11)

Detected as an HTTP 400 body with `details.applicationError.code === "DOMAINS_UNSUPPORTED_TLD"` —
there is no `availability` object on this response. See §R4.1.

Fetch 3 alternatives with the SLD only as the query (§S3) and show them in the **same** message:

> We don't currently support .ws domains. Here are some available alternatives:
> - myshop.com
> - myshop.net
> - myshop.co

User picks one → skip the availability check → **Now go to §P1 and follow it.**

A user who wanted to connect that domain, not buy one, is answered by [Connect Domain](connect-domain.md) §A6b.

---

# Part P — Purchase Path

**Entry preconditions** — you arrive here from Part S, or from [Connect Domain](connect-domain.md), with:

1. A single **chosen domain**, already normalized, and
2. Confirmation it is buyable — either `available: true` from the availability check, or it came
   from the suggest endpoint (suggestions are always available, never re-check one).

If either is missing, go back to §S1–§S4 and settle it first.

**Terminal states** — this path ends in exactly one of:

| Terminal state | Reached when |
|----------------|--------------|
| **Checkout link** | The user completed registration details and the cart is built (§P9) |
| **Bundle link** | A Free-tier user chose plan + domain together (§P2) |
| **Error fallback** | Two failed attempts — §R8 |

**Read Part R before any call.** Endpoints, product IDs and URL templates all live there.

Covers **US-18 – US-32**.

---

## P1. Site and Plan Outcome (US-18, US-19)

### P1.1 Resolve the site

Domain purchase does **not** require a Wix site. Apply the site-resolution rules in
§R3 — Case A (siteId in context), Case B (logged in → fetch list of sites),
Case C (not logged in → inline login prompt), Case D (logged in, ask once).

Do **not** fetch list of sites unless the user asked about a site or answered yes to the question.

- **No site resolved** → skip §P1.2 and §P2 entirely. No premium check, no voucher check, no upgrade
  pitch. Go to §P3 as a standalone purchase.
- **Site resolved** → keep `siteId` and the site's display name; go to §P1.2.

### P1.2 Check the site's plan

```
GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}
```

Read `payload.premiumState`. `allowedDomain = premiumState !== "FREE"`.

Do this **silently**. Record whether the site was Premium or Free here — §P7 compares against it.

### P1.3a Premium site (US-18)

Say, verbatim:

> Great — after purchasing, {displayName} will auto-connect to **{site name}**.

When the site was already known from context — which is exactly when §S2 suppressed the standalone
*"is available!"* line — merge the two into one message:

> {displayName} is available! After purchasing, it will auto-connect to **{site name}**.

Go to §P3.

### P1.3b Free-tier site → §P2.

---

## P2. Free-Tier Offer (US-19, US-20, US-21, US-22, US-23)

The site exists but has no Premium plan. The user gets a real choice: upgrade and take the domain as
part of the plan, or buy the domain on its own.

### P2.1 Is the TLD coupon-eligible? (US-20)

The "free for the first year" promise is **TLD-dependent — never promise it blindly.**

```
com.wixpress.premium.domain.tlds.DomainTld/ListTlds
Body: { "filter": { "tlds": ["{TLD_WITHOUT_DOT}"] } }
```

`coupons_applicable: true` → eligible. Anything else → not eligible. If the call is unavailable,
fall back to the static TLD list in §R7.

### P2.2 Is a Premium plan on sale? (US-21)

The `getPremiumSale` context call (`wix.premium.store.v1.sales/GetSale`) runs automatically.

- Returns `saleDetails` with data → a sale is active. Useful fields: `saleDiscount`,
  `saleEndDate`, `remainingDays`.
- Returns empty / no `saleDetails` → no sale. Say nothing about sales.

### P2.3 Present the offer

**If a `siteId` was in context, this message owes the user the availability line.** §S2 held back
the standalone *"{displayName} is available!"* so it could be merged into the site + plan outcome, and
this is the branch that merges it — §P1.3a does the same job on a Premium site. Lead with it and
let the rest of the copy stand:

> {displayName} is available! **{site name}** doesn't have a premium plan yet, and connecting a domain
> requires one. Upgrade and you can get it free for the first year — or buy it on its own at full
> price and connect it after you upgrade. Want me to generate a bundle link?

The **not coupon-eligible** variant takes the same opener. The **just-logged-in** variant does not —
that user came through the login prompt, which only ever appears after *"is available!"* has already
gone out on its own.

**Coupon-eligible TLD** — verbatim:

> **{site name}** doesn't have a premium plan yet, and connecting a domain requires one. Upgrade and
> you can get {displayName} free for the first year — or buy it on its own at full price and connect
> it after you upgrade. Want me to generate a bundle link?

**Not coupon-eligible** — the free-year clause would be false, so drop that clause and keep the rest:

> **{site name}** doesn't have a premium plan yet, and connecting a domain requires one. Upgrade and
> you can connect {displayName} to your site — or buy it on its own at full price and connect it
> after you upgrade. Want me to generate a bundle link?

**If a sale is active**, append one line to whichever version you used:

> There's also {saleDiscount}% off Premium plans right now — {remainingDays} days left.

**If the user just logged in or created an account in response to the connect prompt**
(§R3 Case C), they have already said yes to connecting. Skip the question and
deliver the offer with the link in the same message — the connect constraint still gets stated:

> Welcome! Your new site doesn't have a premium plan yet, and connecting a domain requires one.
> Upgrade and you can get {displayName} free for the first year →
>
> [Get domain free with a site plan]({bundle URL})

> **Why the constraint is in the sentence.** US-19 asks for an *informed* decision, and the fact that
> makes this a decision rather than an upsell is that the standalone route leaves the domain
> unconnected until the user upgrades.
>
> Two things the copy is careful **not** to do. It does not list what Premium includes — §P10 still
> forbids that, and *"connecting a domain requires one"* is a constraint, not a feature pitch. And it
> frames buying alone as **deferred**, not forbidden: buy now, upgrade later, connect then. That is
> what actually happens, so *"you can't"* would be wrong.

### P2.4 User accepts the bundle (US-23)

> Here's where you can pick a plan and get {displayName} free for the first year →
>
> [Get domain free with a site plan](https://manage.wix.com/premium-pricing/wix/select-plan?domainName={domain}&referralAdditionalInfo=add-domain-purchase-intent&siteGuid={siteId}&showDomain=true)

Use the full domain in `domainName`, the resolved `siteId` in `siteGuid`. When the TLD is not
coupon-eligible, use the label `[Get your site live at this domain]` instead — do not promise a free
year.

**This is a terminal state. Stop here.** Do not continue to §P3, do not build a cart.

### P2.5 User declines the bundle (US-22)

Reply *"No problem."* and continue to §P3 as a standalone purchase. Do not re-pitch the upgrade.

**Do not restate the connect constraint here either.** §P2.3 put it in front of the choice, which is
where it changes a decision. Repeating it after the user has decided is a second pitch wearing a
warning's clothes.

Keep the `siteId` in memory — §P7 re-checks the plan, and the user may upgrade in another tab.
But treat the purchase as standalone for now: no `msid` on the checkout link unless §P7 changes it.

---

## P3. Registration Period (US-24)

```
POST https://manage.wix.com/_api/premium-purchase-platform-serverless/v1/offering/72af0602-1321-4897-8299-f507480b2bb8
Body: { "purchaseContext": { "params": { "tld": ".{TLD}" } } }
```

Include the leading dot in `tld`.

- Save `products[0].productId` — the cart needs it in §P8. Never hardcode it.
- Render **every** entry in `products[0].pricingDetails[]` as a table, and **only** those entries.

Valid cycles are a subset of **1, 2, 3, 5 and 10 years**, and the subset varies by TLD — some start
at 2, some stop at 3, some go to 10. Do not add a row the API did not return, and do not drop one it
did.

**Sort the rows ascending by `cycle.cycleDuration.count`.** The API does not return them in order —
`.org` and `.biz` both come back `10, 5, 2, 3, 1`. Rendering the array order gives the user a jumbled
table.

#### Which fields — exactly three per row

Each `pricingDetails[]` entry carries several price objects. Read these and no others:

| Column | Field | Verified value (`.biz`, 1 year) |
|--------|-------|--------------------------------|
| Duration | `cycle.cycleDuration.count` + `.unit` | `1` `YEAR` → *1 year* |
| **You pay now** | `finalPrice.total.formattedAmount` | `$7.90` |
| **Renews at** | `renewalPrice.total.formattedAmount` | `$35.90` |

Always `formattedAmount` — it arrives with the currency symbol and the right number of decimals.
Never take `amount` and format it yourself, and never do arithmetic on either.

`renewalPrice.total` is the charge for **the same period again** — for a 2-year row it is the next
2-year charge, not a yearly rate. The header wording is what carries that; if it ever proves
confusing, fix the header, do not add a footnote after the table.

⛔ Do **not** read these, all of which are in the same response and all of which will produce a wrong
or unexplainable number: `catalogPrice` (the undiscounted list price — showing it next to *"You pay
now"* invents a discount claim), `initialPurchasePrice` (identical to `finalPrice.total` in every row
observed — if it ever differs, that is new information to check, not a free choice), `lowestCyclePrice`
(its name and its value are consistent with two different meanings in the data observed, so it is
unverified), and any `monthly*` or `subtotal*` variant. `savings` appears on some rows and not others —
never render it.

Message **shape** — one row per returned `pricingDetails[]` entry and no other rows:

> No problem. How many years would you like to register {displayName} for?
>
> | Duration | You pay now | Renews at |
> |----------|-------------|-----------|
> | {cycle 1 duration} | {cycle 1 finalPrice} | {cycle 1 renewalPrice} |
> | {cycle 2 duration} | {cycle 2 finalPrice} | {cycle 2 renewalPrice} |
> | … one row per entry the API returned, shortest first … |
>
> At checkout, prices may be shown in your local currency.

(Open with *"No problem."* only when the user has just declined a site or a bundle. Otherwise open
with *"How many years would you like to register it for?"*.)

That closing line is fixed and it is required — this is the first place the user sees a price, and
every message that shows one carries it. Wording and the full rule: §R10.

Ask the user to pick. If they have no preference, default to the shortest available period.

> **Why the renewal column is not optional.** The first-term price is discounted and the renewal price
> is not — for `.biz` that is `$7.90` now against `$35.90` at renewal, a 4.5× step the user finds out
> about a year later. A single-price table is accurate and still misleading.

### ⛔ Never invent a price

Every number in that table comes from **this response and this response only**. There is no fallback
price list anywhere in this skill or in your own knowledge. A `.com` does not
have a price you already know.

| Situation | What to do                                                                                                                                                                                                                       |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Call succeeded | Render its rows. Nothing else.                                                                                                                                                                                                   |
| A row has `finalPrice` but no `renewalPrice` | Leave that cell empty. **Never** fall back to `catalogPrice`, and never carry a renewal figure across from another row. Not observed in any response so far — if it happens, it is an unknown, and an unknown price stays blank. |
| **No products returned** | *"Wix doesn't support purchasing this TLD. Try a different extension like .com, .net, or .org."* Then offer suggestions (§S3).                                                                              |
| **Call failed** | Retry once silently, then the escalation ladder (§R8).                                                                                                                                                      |
| **Call cannot be made at all** — no Wix session, no authenticated tool available in this channel | **Stop the flow.** Say: *"I can't pull up live pricing right now. You can see current prices and register the domain here → [https://manage.wix.com/account/domains](https://manage.wix.com/account/domains)"* Do **not** continue to §P4.                      |

That last row is the one that bites. When the offering call is unavailable, the tempting move is to
show a plausible table and carry on — a fabricated price the user may act on. **A missing price ends
the flow; it never gets filled in from memory.**

If you find yourself about to write `$7.90`, `$14.95`, or any other specific figure that did not
arrive in an API response during *this* conversation, you are hallucinating pricing. Stop.

---

## P4. Contact Details (US-27, US-28)

```
GET https://manage.wix.com/v1/domain-registration-intents/preview/{domain}
```

Address fields are **flat** on each contact — `streetAddress`, `city`, `country`, `postalCode`.
There is no nested `address` object.

### P4.1 Contacts exist (US-27)

Show them and ask for explicit confirmation. **Never skip this — never assume.**

> I have your contact details on file — would you like to use these?
>
> - Name: John Doe
> - Email: john@example.com
> - Phone: +1.2125551234
> - Address: 123 Main St, New York, US 10001

- Confirmed → check them against §P4.3 and §P4.4 for this domain's TLD. Fine → §P5. A detail that breaks
  a rule (a country the TLD does not accept, a missing TLD-specific field) → ask only for that, re-check
  that one field against the rules, then go to §P5. Do not re-validate the fields that already passed.
- Wants different details → collect as in §P4.2.

### P4.2 No contacts (US-28)

Ask for every field, one per line:

> I'll need a few details to register the domain:
>
> - First name
> - Last name
> - Email
> - Phone (e.g. +1.5551234567)
> - Street address
> - City
> - Country
> - State or province (if the country has them)
> - Postal code (if the country uses one)

Ask for the TLD-specific fields of §P4.4 in the same message when the domain's TLD has any.

Field rules — the full per-field rules are in §P4.3:

- **Phone** — `+{countryCode}.{number}`, e.g. `+1.5551234567`, `+972.533456789`.
- **Country** — accept a full name and convert to the 2-letter ISO code before saving
  ("Israel" → `IL`, "United States" → `US`).

The user may answer in a single line ("Alex Johnson, alex@cozycuts.com, +1.5032218800, 310 Oak Ave,
Portland, US, 97201") — parse it, do not make them re-enter field by field.

### P4.3 Contact rules for every TLD

The save in §P5 catches some bad values, not all — a registry can still reject a contact after the
order. So check each value against these rules **before** §P5 and ask again for the one that fails.
The registrant, admin and tech contact all follow them.

| Field | Rule |
|-------|------|
| First name | Required, up to 30 characters |
| Last name | Required, 2–30 characters |
| Email | Required, a valid address, 2–128 characters |
| Company | Optional, 2–50 characters. Leave it out when empty — never send `n.a.` |
| Street address | Required, 4–100 characters, and at least one character that is not a digit (`12345` fails) |
| City | Required, 2–30 characters |
| Country | Required, 2-letter ISO code. **Lebanon (`LB`) is not accepted** — tell the user Wix cannot register a domain for a Lebanese contact |
| State or province | Required for a country that has states, provinces or regions (US, CA, AU, BR, ES, IT, MX, IN…) — when unsure, ask. Send it as `subdivision`, the country-prefixed ISO 3166-2 code (`ES-B`) |
| Postal code | Required, in the format of the selected country (US `12345` or `12345-6789`, CA `K1A 0B1`, GB `SW1A 1AA`, IL 5 or 7 digits, BR 8 digits). Upper-case it. For these countries, which have no postal code, do not ask and send `NA`: AE AG AO AW BF BI BJ BQ BS BW BZ CD CF CG CI CK CM CW DJ DM ER FJ GD GH GM GN GQ GY HK IE KI KM KN KP LC ML MO MR MS MW NR NU QA SB SC SL SR ST SX SY TF TG TK TL TO TT TV TZ UG VU YE ZW. Jamaica (`JM`) — optional, omit the field. A GB code needs a space before its last three characters |
| Phone | `+{countryCode}.{digits}` — digits only, no spaces or dashes, at most 15 digits, and a number that is valid for that country. Default country code `1`; when the user names a country and no code, use that country's code |

**Latin characters only.** First name, last name, company, street address and city accept only
printable ASCII (letters, digits, space and punctuation). `é`, `ü`, `ß`, Hebrew, Cyrillic, Arabic and
CJK all fail. Ask the user for the Latin spelling (transliterate, or drop the accent) — do not send
the original. The exception is `.es`: first name, last name and company have no character rule, and street address and city also accept accented Latin letters.

When you change a value to satisfy a rule (accent dropped, code upper-cased), say so in the next message — never change a value silently.

### P4.4 TLD-specific requirements

Match the domain against the **longest** suffix in this table (`shop.co.uk` → `.co.uk`). A TLD that is
not in the table has no rule beyond §P4.3. A row **adds to** §P4.3, and where it states a limit for a
field the row's limit **replaces** the §P4.3 one for that TLD.

A row that refuses what the user has already said — a government entity for `.ca`, a country the TLD
does not take, a terms checkbox answered *no* — ends the purchase at once, even when the flow is
still at an earlier step: say the domain cannot be registered through Wix on those terms, in one
sentence, and make no save, cart or checkout link.

| TLD | What is different |
|-----|-------------------|
| `.de` | Country is **Germany** (`DE`) only. City accepts letters only, no digits. §P5 sends the `registrantContact` only — no `adminContact` or `techContact` |
| `.fr` | Country must be in the EU/EEA/overseas-territory list: AT AX BE BG CH CY CZ DE DK EE ES FI FR GF GI GP GR HU IE IS IT LI LT LU LV MQ MT NC NL NO PF PL PM PT RE RO SE SI SK TF WF YT. Default `FR` |
| `.nl` | Remove the space from a Dutch postal code (`1012AB`, not `1012 AB`) |
| `.co.uk` | First name + last name together must be at least 4 characters, at least 3 of them letters. A pair of initials (`J S`) is rejected by the registry — ask for the full name |
| `.ca` | **Needs `tldData`** (§P4.5). Country is **Canada** (`CA`) only, phone `+1` with a 10-digit number, a province is required. The user chooses a **legal category**; the registrant company is required unless it is an individual one (`CCT`, `RES`, `LGR`, `ABO`). The user must agree to the [CIRA registrant agreement](https://www.cira.ca/policy/legal-agreement/registrant-agreement) — ask; on a *no* the domain cannot be registered, so end the purchase. Name, company, address and city are 2–64 characters |
| `.it` | **Needs `tldData`** (§P4.5). Phone is at most 10 digits. The user chooses an **entity type**, which fixes the allowed country and the ID number. The user must accept the `.it` registry terms — ask; on a *no* the domain cannot be registered, so end the purchase |
| `.com.au` | **Needs `tldData`** (§P4.5). Country is **Australia** (`AU`) only, phone code `61`, postal code a 4-digit Australian one, company **required**. §P5 sends `registrantContact` and `techContact` only — no `adminContact`. Asks eligibility questions |
| `.com.br` | **Needs `tldData`** (§P4.5). Country is **Brazil** (`BR`) only: postal code is 8 digits **without the hyphen**, phone is 8–12 digits, street and city 2–64 characters, no company |
| `.es` | **Needs `tldData`** (§P4.5). Province is required for Spain, and the postal code must start with that province's 2-digit code (`08xxx` for Barcelona). Company is required for a business registrant. The user must accept the [dominios.es terms](https://www.dominios.es/en/registra-un-dominio/terminos-condiciones/clausulas) — ask; on a *no* the domain cannot be registered, so end the purchase. The registry emails the registrant to verify — say so |
| `.us` | **Needs `tldData`** (§P4.5). The user declares a **nexus category** and the **purpose** of the domain |
| `.co.il`, `.org.il` | **Needs `tldData`** (§P4.5). Name must be English letters and spaces only; street 4–255 and city 2–100 characters, starting with a letter or digit, no apostrophe. An Israeli address gets phone code `972` |

Ask the TLD-specific questions as plain choices, one message, in the user's words — never show an
enum code to the user.

**`.ca` legal categories** (value → what to show): `CCT` Canadian citizen · `RES` Permanent resident of Canada ·
`LGR` Legal representative of a Canadian citizen or permanent resident · `ABO` Aboriginal Peoples indigenous to
Canada · `CCO` Corporation · `TDM` Trademark registered in Canada · `OMK` Official mark registered in Canada ·
`ASS` Unincorporated association · `TRD` Trade union · `TRS` Trust established in Canada · `PRT` Partnership
registered in Canada · `PLT` Political party · `EDU` Educational institution · `LAM` Library, archive or
museum · `HOP` Hospital · `INB` Indian Band · `MAJ` Her Majesty the Queen. **`GOV` (government entity) cannot be
registered through Wix** — send the user to the CIRA registration page (<https://www.cira.ca/ca-domains/register-your-ca>)
and stop the purchase.

**`.it` entity type → what it requires:**

| `entityType` | Who | Country | ID number (`regCode`) | Company |
|--------------|-----|---------|-----------------------|---------|
| `ITR` | Individual resident in the EEA, Switzerland or Vatican | EEA, Switzerland, Vatican (incl. `IT`) | Italy: fiscal code (16 characters, `RSSMRA80A01H501U`). Elsewhere: tax or ID document number, up to 50 letters, digits or `-` | Not allowed |
| `FWI` | Freelancer | `IT` only | Italian VAT number, 11 digits | Required |
| `COM` | Company or one-person company | `IT` only | Italian VAT number, 11 digits | Required |
| `NPO` | Non-profit organization | `IT` only | Italian VAT number, 11 digits | Required |
| `POI` | Public organization | `IT` only | Italian VAT number, 11 digits | Required |
| `OSI` | Other subjects | `IT` only | Italian VAT number, 11 digits | Required |
| `FOR` | Company in the EEA, Switzerland or Vatican, outside Italy | That country, not `IT` | VAT number in that country's format | Required |

The country follows the entity type — when the user's country does not fit the type, tell them which
countries the type allows and ask again (or pick another type).

**`.com.au` eligibility:**

- `policyReason`: `CLS` — the domain is closely and substantially connected to the business (default); `EXC` — the
  domain is an exact match, abbreviation or acronym of the business or trademark name.
- `eligibilityType` — what the registrant is: `COM` registered company · `PRT` partnership · `STR` sole trader ·
  `TRO` trademark owner · `PTO` pending trademark owner · `CWE` Commonwealth entity · `GVB` government body ·
  `INA` incorporated association · `TRS` trust · `STB` statutory body · `TRC` trading cooperative ·
  `RBU` registered business.
- `eligibilityIdType` + `eligibilityId` — `ABN` (11 digits) or `ACN` (9 digits). A `STR` or `PRT` registrant can only use
  `ABN`. Spaces are ignored; the number must pass the ABN / ACN check digit — a number that does not is
  rejected, so ask the user to re-read it from their ABN or ACN certificate.
- `registrantName` — the registered business name, up to 128 characters.

**`.com.br`:** `identificationNumber` is a **CPF** (individual, 11 digits) or a **CNPJ** (company, 14 digits),
digits only, passing the CPF / CNPJ check digits. Ask which one the registrant is. A CPF registrant must
also give `dateOfBirth` as `YYYY-MM-DD` (after 1900, in the past); a CNPJ registrant does not.

**`.es`:**

- `idType`: `NIF` (Spanish tax ID) · `NIE` (foreigner ID) · `OTHER` (default, any other ID).
- `govId`, trimmed and upper-case: `NIF` for an individual — DNI, 8 digits + a control letter; `NIF` for a
  business — CIF, a letter + 7 digits + a control character; `NIE` — `X`, `Y` or `Z` + 7 digits + a control
  letter; `OTHER` — 1–20 letters or digits.
- A business registrant also gives the company name (2–64 characters) as the registrant `company`.

**`.us`:**

- `nexusCategory` — the registrant's tie to the United States: `C11` US citizen · `C12` permanent resident ·
  `C21` US organization · `C31` foreign organization that regularly does business in the US ·
  `C32` foreign organization with an office or facility in the US.
- `usAppPurpose` — `P1` business use for profit · `P2` non-profit business or organization · `P3` personal use ·
  `P4` educational purposes · `P5` government purposes.
- `nexusValidator` — **only for `C31` and `C32`**: the 2-letter code of the registrant's country, which must not be `US`.

**`.co.il` / `.org.il`:** `registrantType` is `INDIVIDUAL` (default) or `ORGANIZATION`. An `ORGANIZATION` registrant also gives
the company name as the registrant `company` (3–100 characters, Latin letters and digits, **at least two words**) and
`registrationNumber`: the 9-digit company number, starting with `5`, passing the Israeli company-number
check digit.

### P4.5 TLD data in the save

For the TLDs marked "Needs `tldData`" in §P4.4, §P5 carries the answers in `domainRegistrationIntent.tldData`.
`tldType` is the TLD in upper case with `.` → `_` (`CA`, `IT`, `COM_AU`, `COM_BR`, `ES`, `US`, `CO_IL`,
`ORG_IL`); the options object is named after it:

| `tldType` | Options object | Fields |
|-----------|----------------|--------|
| `CA` | `caOptions` | `legalType: {"value": "CCT"}` |
| `IT` | `itOptions` | `entityType: {"value": "ITR"}`, `regCode` (leave out when there is none) |
| `COM_AU` | `comAuOptions` | `policyReason: {"value": "CLS"}`, `eligibilityType: {"value": "COM"}`, `eligibilityIdType: {"value": "ABN"}`, `eligibilityId`, `registrantName` |
| `COM_BR` | `comBrOptions` | `identificationNumber`, `dateOfBirth` (CPF only) |
| `ES` | `esOptions` | `idType`, `govId` |
| `US` | `usOptions` | `nexusCategory`, `usAppPurpose`, `nexusValidator` (`C31` / `C32` only) |
| `CO_IL` | `coIlOptions` | `registrantType`, `registrationNumber` (`ORGANIZATION` only) |
| `ORG_IL` | `orgIlOptions` | same as `coIlOptions` |

Value fields of `CA`, `IT` and `COM_AU` use the wrapper `{"value": "…"}`; the others take a plain string. A `.ca` save, in full:

```json
{
  "domainRegistrationIntent": {
    "domain": "{domain}",
    "sessionId": "<uuid>",
    "registrantContact": { "firstName": "...", "lastName": "...", "email": "...", "phone": "+1.4165550123",
                           "streetAddress": "...", "city": "...", "subdivision": "CA-ON", "country": "CA", "postalCode": "M5J 1E6" },
    "adminContact":  { ...same as registrant... },
    "techContact":   { ...same as registrant... },
    "tldData": { "tldType": "CA", "caOptions": { "legalType": { "value": "CCT" } } }
  }
}
```

The preview call in §P4 returns the same `tldData` under `domainRegistrationIntent.tldData` for a domain whose
details are already on file — reuse it instead of asking again.

---

## P5. Save Contacts (US-29)

Do this immediately once contacts are confirmed or collected — before asking about privacy — so
validation problems surface while the user is still thinking about their details.

Generate a random UUID v4 and use it as `sessionId`, in its plain 8-4-4-4-12 hex form with nothing added
before or after it — the save rejects anything else (`sessionId is not a valid GUID`). `wsess` is only
the name §P8 gives this same value in the cart metadata; it is not part of the value. The `sessionId`
links the contacts to the cart; keep it, §P8 needs the same value.

```
POST https://manage.wix.com/v1/domain-registration-intents/upsert
```

```json
{
  "domainRegistrationIntent": {
    "domain": "{domain}",
    "sessionId": "<uuid>",
    "registrantContact": {
      "firstName": "...", "lastName": "...", "email": "...", "phone": "...",
      "streetAddress": "...", "city": "...", "country": "...", "postalCode": "..."
    },
    "adminContact":  { ...same as registrant... },
    "techContact":   { ...same as registrant... }
  }
}
```

Use the same contact for registrant, admin and tech — standard for individual registrations.
**`.de` — send `registrantContact` only. `.com.au` — send `registrantContact` and `techContact` only.**
Leave out `adminContact` (and, for `.de`, `techContact`) for those two TLDs. Add `company` and `subdivision` to a contact when §P4.3 calls for them. Add `tldData` **only** for a TLD
marked "Needs `tldData`" in §P4.4 (shape in §P4.5) — leave it out for every other TLD.

### Validation errors (US-29)

Name only the fields that are actually wrong, in plain language. Never show the raw error, a field
path, or a code.

> There's an issue with one of your details — can you double-check this?
>
> - **Email** — doesn't look like a valid email address

Take the correction, retry the upsert, and carry on. If the error is about a TLD-specific
requirement, explain what is needed from §P4.4 and ask for it. A name, address or city the registry
rejects for its characters is a §P4.3 Latin-characters problem — ask for the Latin spelling.

On success, go to §P6.

---

## P6. Privacy Protection (US-25, US-26)

The options come from the offering call with the addon product type (§R4.2), **scoped to the
domain's TLD** — the same body shape as §P3, leading dot included:

```
POST https://manage.wix.com/_api/premium-purchase-platform-serverless/v1/offering/b3d86a1d-9db3-4f69-bd54-c132808856b1
Body: { "purchaseContext": { "params": { "tld": ".{TLD}" } } }
```

⛔ **Never call it without the `tld`.** The paid addons vary by TLD — `.com.au`, `.com.br`, `.info`
and `.biz`, for example, have no Privacy + DNSSEC. An unscoped answer is not an answer for this
domain.

Match each entry in `products[]` by its ID against the product-ID table at the end of this section.
**Offer only the paid addons whose IDs came back.** "No protection" is always offered.

| Paid addons returned | What to show |
|----------------------|--------------|
| Privacy + DNSSEC **and** Privacy only | All three options, Privacy + DNSSEC marked *(recommended)* |
| Privacy only | Privacy only *(recommended)* and No protection. No DNSSEC line, no mention of it |
| Privacy + DNSSEC only | Privacy + DNSSEC *(recommended)* and No protection |
| Neither | Skip the question. Say once that the registration will be public (*"Privacy protection isn't available for .{TLD}, so the registration will be public."*) and go to §P7 — **no addon line item** in §P8 |

⛔ **Never put an addon product ID in the cart that this TLD-scoped call did not return.** An addon
the response left out is not offered at all — not without a price, not as *"recommended"*, not on
request. Checkout rejects it (`MissingDomainBundleMetadata`) and the user is left with a cart that
cannot be paid.

The addon response has the **same shape as §P3's** — one `pricingDetails[]` entry per cycle, with
`finalPrice` and `renewalPrice` on each. The registration period is already chosen by the time you
get here, so **read the row whose `cycle.cycleDuration.count` matches the chosen term** and take
`finalPrice.total.formattedAmount` from it. Never sum, never divide, never take the 1-year row and
multiply.

Message **shape** — one line per option the response allows, built from the table above. The full
form, when both paid addons came back:

> How would you like to protect your registration?
>
> - **Privacy + DNSSEC** *(recommended)* — Keeps your personal info off public records while also protecting your domain from being hijacked or redirected by attackers — {price}
> - **Privacy only** — Hides your personal contact info from public records — {price}
> - **No protection** — Your contact info will be publicly visible — Free
>
> At checkout, prices may be shown in your local currency.

When Privacy + DNSSEC did not come back, its line is gone and Privacy only takes the recommendation:

> How would you like to protect your registration?
>
> - **Privacy only** *(recommended)* — Hides your personal contact info from public records — {price}
> - **No protection** — Your contact info will be publicly visible — Free
>
> At checkout, prices may be shown in your local currency.

The currency note is required here too (§R10). It qualifies the `{price}` figures and not
*"Free"* — free is not a currency amount. So it appears only when at least one priced option is
shown; a message with no price in it carries no note.

`{price}` carries the term, and the term is whatever the user picked:

| Chosen term | `{price}` reads |
|-------------|-----------------|
| 1 year | `{finalPrice}/yr` |
| N years | `{finalPrice} for {N} years` |

⛔ **`/yr` on a multi-year term is wrong here for the same reason it is wrong in §P9.** The addon
figure is the charge for the whole period — verified live: Privacy + DNSSEC comes back `$12.90` for
the 1-year cycle and `$38.70` for the 3-year one. Writing *"$38.70/yr"* triples the price in the
user's head. (Those two figures illustrate the shape and are never printed to a user — §P9's closing
rule.)

`{price}` is whatever the addon offering call returned for that product ID. **"No protection" is the
only one whose price is known ahead of time — it is Free.** A paid addon is shown only because the
response returned it, so its price comes from that same entry. If a returned addon has no row for the
chosen term, do not offer it. The same rule as §P3 applies — a figure you did not receive in this
conversation is a fabrication, and the wording above is a template, not a price list.

| Choice | Addon product ID |
|--------|------------------|
| Privacy + DNSSEC | `f8211619-d9f6-4312-9d03-f2958bbd08aa` |
| Privacy only | `22a84545-4ac0-4490-a434-45a1ebc479fb` |
| No protection | `b9d89ff0-f29b-4bfd-a3f0-6e34ae65120d` |

Addon product type for all three: `b3d86a1d-9db3-4f69-bd54-c132808856b1`.

The user may pick any option shown (US-26) — recommend, never push. "No protection" is a legitimate
answer; accept it without a warning.

---

## P7. Pre-Cart Premium Re-Check (US-30)

Run this **only** when a `siteId` was resolved in §P1 and the site was **Free** at that point. Skip it
for standalone purchases with no site, and for sites already Premium.

The user may have upgraded in another tab while answering the questions above. Re-check silently,
just before building the cart:

```
GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}
```

| Result | Effect |
|--------|--------|
| Still Free | Nothing changes. Standalone checkout, no `msid`. |
| Now Premium | Tell the user, and add `msid={siteId}` to the checkout URL. |

When it flipped to Premium, add one line to the final message — **after** *"Setting up your
order..."* and **before** the summary:

> Setting up your order...
>
> **{site name}** is now on a Premium plan — {displayName} will auto-connect after purchase.
>
> Here's your summary:
> …

Never mention the check itself, and never mention it when nothing changed.

---

## P8. Build the Cart (US-32)

Use `CallWixSiteAPI` (with `siteId`) when a site is in play, otherwise `ManageWixSite`. Both carry
Wix session auth — add no headers.

Three calls, in order, **silently**:

1. **Cancel the existing cart** — `POST https://manage.wix.com/_api/premium-cart/v1/carts/active/cancel` · Body `{}`
   Succeeds even when there is no active cart. This is what stops leftovers from an earlier session
   ending up in the user's order.
2. **Get a fresh cart** — `GET https://manage.wix.com/_api/premium-cart/v1/carts/active`
3. **Add items** — `PATCH https://manage.wix.com/_api/premium-cart/v1/carts/active/add-items`

```json
{
  "lineItems": [
    {
      "productInfo": { "productId": "<products[0].productId from §P3>",
                       "productTypeId": "72af0602-1321-4897-8299-f507480b2bb8" },
      "cycle": { "cycleDuration": { "count": <years>, "unit": "YEAR" }, "cycleType": "RECURRING" },
      "metadata": { "domainName": "{domain}", "wsess": "<the sessionId from §P5>", "core": "true" }
    },
    {
      "productInfo": { "productId": "<addon product ID from §P6>",
                       "productTypeId": "b3d86a1d-9db3-4f69-bd54-c132808856b1" },
      "cycle": { "cycleDuration": { "count": <years>, "unit": "YEAR" }, "cycleType": "RECURRING" },
      "metadata": { "domainName": "{domain}", "wsess": "<the sessionId from §P5>" }
    }
  ]
}
```

- The addon cycle duration must match the domain's.
- `core: "true"` goes on the domain line item only.
- Include the addon line item for whichever option the user picked in §P6, including "No protection" —
  it is a product, not an absence. The one exception is an ID the TLD-scoped addon call did not return:
  that line item is left out, and so is the whole addon line when §P6 skipped the question.
- ⛔ Never add an addon product ID the TLD-scoped call in §P6 did not return — checkout fails on it.
- Never announce any of these three calls. The only thing the user sees is
  *"Setting up your order..."*.

---

## P9. Checkout Link (US-30, US-31)

| Condition | Checkout URL |
|-----------|--------------|
| A site is attached — Premium in §P1.3a, or flipped to Premium in §P7 | `https://manage.wix.com/cart/checkout?msid={siteId}` |
| Standalone — no site, or the site is still Free (US-31) | `https://manage.wix.com/cart/checkout` |

Final message:

> Setting up your order...
>
> Here's your summary:
> - **{displayName}** — {N} year(s) — {finalPrice} (renews at {renewalPrice}{term suffix})
> - **{privacy option}** — {N} year(s) — {finalPrice} (renews at {renewalPrice}{term suffix})
>
> At checkout, prices may be shown in your local currency.
>
> Here's your checkout link → [Complete your purchase]({checkout URL})

The currency note sits **between the summary and the link**, so the link is still the last thing in
the message (§R10). This is the screen the user actually reads before paying, so it is the one place
the note matters most.

For "No protection", the second line reads `- **No protection** — Free`. It has no renewal clause —
`$0.00` does not renew at anything worth saying. When the cart has no addon line item (§P8), the
summary has no second line.

### The renewal clause — two forms, and only two

`renewalPrice.total` is the charge for **the same period again**, not a yearly rate. So the suffix
depends on the term:

| Term | The line reads |
|------|----------------|
| `N = 1` | `- **{displayName}** — 1 year — {finalPrice} (renews at {renewalPrice}/yr)` |
| `N > 1` | `- **{displayName}** — {N} years — {finalPrice} (renews at {renewalPrice} every {N} years)` |

⛔ **Never write `/yr` on a multi-year term.** For a 3-year `.biz` the renewal figure is `$107.50` —
the next *three-year* charge. *"renews at $107.50/yr"* overstates it threefold. This is the single
most likely way to get this section wrong, and it is wrong in the direction that scares a user off a
purchase they were about to complete.

### Where the two figures come from

Both are the ones **§P3 already fetched for the chosen cycle** —
`finalPrice.total.formattedAmount` and `renewalPrice.total.formattedAmount` from the
`pricingDetails[]` row the user picked. Reuse them:

- **Never re-request.** The offering call already ran; calling it again is a second chance to get a
  different answer.
- **Never recompute.** §P3's ban on arithmetic holds here — no dividing a 3-year renewal by three, no
  multiplying a 1-year figure up.
- **Never estimate.** If §P3 rendered a blank renewal cell for the chosen row, the summary line drops
  the clause entirely and shows the price alone. A blank stays blank; it does not get filled in at
  checkout time.

### The privacy addon line

The addon carries `renewalPrice` too — **verified live** against the addon product type
(`b3d86a1d-9db3-4f69-bd54-c132808856b1`), same `pricingDetails[]` shape as the domain, one row per
cycle. So the addon line gets the same treatment as the domain line: same two term forms, same
prohibition on `/yr` for a multi-year term, same reuse rule (§P6 already read the row for the chosen
cycle).

One observed difference, and it is not a reason to change the shape: on all three addon products the
renewal figure **equals** the first-term figure — Privacy + DNSSEC is `$12.90` now and `$12.90` at
renewal, Privacy only `$9.90` and `$9.90`. Unlike the domain, the addon has no introductory discount.
Print the clause anyway. *"$12.90 (renews at $12.90/yr)"* is the useful answer to *"does this one
jump too?"*, and suppressing it whenever the numbers match would make its absence look like missing
data rather than a flat price.

> **Why the summary carries a renewal at all.** §P3's table already showed it, and this is the last
> screen before payment — the one the user actually reads. A summary that shows only *"$7.90"* on a
> domain that renews at `$35.90` is accurate and still leaves the user surprised in twelve months.
> The number is already in hand; the only work here is printing it with the right period attached.

⛔ **Every figure in this section is an observation about shape, not a price.** `$107.50`, `$12.90`,
`$9.90`, `$7.90`, `$35.90` — all of them are here to show which period a number covers and how far a
renewal can step. **None of them is ever printed to a user.** §P3's rule is the whole rule: a figure
that did not arrive in an API response during *this* conversation is a fabrication, and that applies
to numbers read out of this document exactly as it applies to numbers read out of your own
knowledge.

The user's only remaining step is payment; say nothing more.

**Terminal state. Stop here.**

---

## P10. Forbidden Actions

❌ **Never:**

- Promise "free for the first year" without confirming coupon eligibility (§P2.1).
- **Present the Free-tier choice without the connect constraint.** *"Want a bundle link?"* on its own
  is an upsell; the same question with *"connecting a domain requires one"* in front of it is a
  decision. US-19 asks for the second. Both §P2.3 variants carry the clause, including the
  just-logged-in one.
- **State a renewal figure per year for a multi-year term.** `renewalPrice.total` is the charge for
  the same period again — `/yr` belongs on a 1-year term and nowhere else (§P3, §P6, §P9).
- Mention a sale that `getPremiumSale` did not report.
- Skip the contact confirmation in §P4.1 because the details "look right".
- **Save contacts without checking them against §P4.3 and the domain's TLD row in §P4.4**, or guess a
  TLD-specific value (VAT number, CPF, ABN, nexus category) the user did not give.
- **Send non-Latin characters in a name, company, street or city**, or an enum code (`C31`, `ITR`) in
  anything the user reads.
- Continue past a TLD terms checkbox (`.ca`, `.it`, `.es`) without an explicit yes.
- Continue to §P3 after the user accepted a bundle link — that is the end of the flow.
- Put `msid` on a standalone checkout link, or leave it off when a Premium site is attached.
- Re-check availability for a domain that came from the suggest endpoint.
- **Offer, recommend or add to the cart a paid addon the TLD-scoped addon call did not return** (§P6).
- Narrate cart operations, contact saving, or the premium re-check.

✅ **Always:**

- Render exactly the cycles the offering call returned.
- **Carry the currency note in the same message as any price the user sees** — §P3, §P6 and §P9.
  Fixed wording, and never a currency name or a conversion (§R10).
- Show what the domain renews at wherever its price appears — the period table (§P3) **and** the
  pre-checkout summary (§P9). Same two figures, fetched once.
- Reuse the same `sessionId` across the intent save and, as `wsess`, both cart line items.
- Keep `siteId` from §P1 through §P9.

---

# Part R — Reference

**Read this part before making any API call.** It is the single source of truth for endpoints,
product IDs, URL templates, site resolution and error handling. Parts S and P both defer to it —
where they disagree with this part, this part wins.

Covers **US-13, US-14, US-15, US-16, US-37, US-38, US-39**.

A taken domain (**US-09**, **US-40**, **US-41**) is answered by [Connect Domain](connect-domain.md) §A4b,
which looks it up in the user's account. **US-42 – US-46** (putting a domain the account holds on a
site, changing its role, moving it) are [Assign Domain](assign-domain.md)'s. This skill never writes
to a user's site.

---

## R1. Domain Normalization

Apply **before** any API call, every time a domain is read from the user:

- Strip `http://` and `https://`
- Strip `www.`
- Strip any trailing path, query string or slash (`example.com/shop` → `example.com`)
- Lowercase
- If there is no TLD, add `.com` (`example` → `example.com`)

The normalized value is `{domain}` everywhere below. Always use the **full** domain in URLs and
API calls — never the truncated display form.

---

## R2. Domain Display Truncation

Only the *visible label* is ever truncated. Two values exist for every domain:

| Value | Use |
|-------|-----|
| `domainName` | Full normalized domain — URLs, API calls, cart metadata |
| `displayName` | What the user sees in link text and summaries |

**Rule:** if the full domain is 20 characters or fewer, `displayName` = `domainName`.
If it is longer than 20 characters:

```
displayName = [first 6 chars of the SLD] + "..." + [last 5 chars of the SLD] + [.TLD]
```

| Full domain | Length | `displayName` |
|-------------|--------|---------------|
| `short.com` | 9 | `short.com` |
| `myamazingbusiness.com` | 21 | `myamaz...iness.com` |
| `verylongdomainname.com` | 22 | `verylo...nname.com` |

---

## R3. Site Resolution

Both paths need to know *which* Wix site (`siteId`, also called `msid`) is in play. The rules are
the same; **when** they run differs:

- **Purchase path** — a site is optional. Resolve only after the domain is chosen. See §P1.
- **Connect path** — a site is required. That path is [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md), which
  resolves the site itself, after the availability check.

### Case A — `siteId` already in context (US-13)

The system prompt, environment or dashboard context already provides a `siteId` / `msid`.

→ Use it directly. **Do NOT fetch list of sites.** Do not ask the user to pick a site.

> **The user naming a site is not the same thing.** If they say *"my site is called My Bistro"* but
> no `siteId` is in context, you still need to fetch list of sites to turn that name into an ID — go to
> Case B. What their answer buys you is skipping the *"which site?"* question, not the lookup. Match
> the name against the returned sites; if nothing matches, list what came back and ask.

> **A roster in context is not a resolved `siteId` either.** The host may preload part of the
> account's site list — ten of ninety-three, say — into the system prompt or site context. That is
> **not** Case A. It names no site for *this* domain, it may not even contain the right one, and it
> hands you no `siteId` for the task. Go to Case B and fetch list of sites. Every prohibition on that
> call is about a `siteId` you already hold, never about a list you happened to be shown.

### Case B — user is logged in, no `siteId` in context

→ Fetch list of sites.

| Result | Action |
|--------|--------|
| Exactly one site (US-14) | Use it directly, no question asked. Name it in your next message so the user can spot a mistake. |
| 2 – 8 sites (US-15) | **List them all, numbered, in the same message as the question:** *"You have a few Wix sites — which one should this domain be connected to?"* (*"a couple"* when there are exactly two.) Wait for the pick. |
| More than 8 | Still a list, never a count — name the total, show five, invite a name. Copy below. Wait for the pick. |
| No sites | Purchase path → continue standalone. Connect path → Connect External Domain or Sub Domain §7. |

**More than eight sites.** A numbered wall of ninety-three is unusable, and a bare count is worse.
Name the total, show five, and leave the door open:

> You have 93 Wix sites. Which one should {displayName} go on?
>
> 1. {site name}
> 2. {site name}
> 3. {site name}
> 4. {site name}
> 5. {site name}
>
> Or tell me the name and I'll find it.

Show the five most recently updated if the response gives you that; otherwise the first five it
returned. A name in reply is matched against the **whole** result you already have — do not fetch
list of sites a second time to look it up.

⛔ **Never announce the count and stop.** *"You have 93 sites — would you like me to list them?"* asks
permission for the step you were already told to take. The user has asked for their domain on a site;
the list is what moves that forward and a count moves nothing. It costs a turn and answers nothing.

### Case C — user is not logged in (US-16)

Do **not** ask a yes/no question about sites — the user cannot answer it usefully. Show the optional
inline prompt instead, verbatim:

> If you'd like to connect this domain to a Wix site — [Log in or create a Wix account]

- User logs in → go to Case B (fetch list of sites).
- User declines ("No, I'll just buy it for now") → standalone purchase, no `siteId`, no premium
  pitch, no voucher check. Reply *"No problem."* and continue.

The destination behind *[Log in or create a Wix account]* is supplied by the host channel's
sign-up/login affordance. In a channel with no widget runtime, link to `https://www.wix.com/`.

### Case D — user is logged in and no site was mentioned

Purchase path only. Ask once, verbatim:

> Would you like to connect this domain to one of your Wix sites?

- Yes → Case A or B.
- No → standalone purchase, no `siteId`. Reply *"No problem."* and continue.

Once a `siteId` is resolved, **remember it for the rest of the conversation** and reuse it in the
premium check, the bundle link and the checkout link.

---

## R4. API Reference

### R4.1 Public — no auth

These are open endpoints. Send a plain GET with query parameters: **no headers, no tokens, no
scopes.** If you get `403` / `access_denied`, you added auth that does not belong — remove it and
retry.

> Do **not** use the `GetSuggestedDomains` tool. Always use the v2 endpoint below.

**Check domain availability** — every check in this flow uses [Check Domain Availability](check-domain-availability.md) (request, response, errors); never call the endpoints from here. In this flow its results map as follows:

| Result | Meaning here |
|--------|--------------|
| `availability.available: true` | Buyable → §S2 |
| `availability.available: false` and `availability.premium: false` | Taken → [Connect Domain](connect-domain.md) §A4b, with intent PURCHASE. |
| `availability.premium: true`, whatever `available` says | A premium domain, buyable → §S2. Say nothing about "premium": its prices come from the offering call (§P3). |
| HTTP 400, `details.applicationError.code === "DOMAINS_UNSUPPORTED_TLD"` | Unsupported TLD → §S4. The `availability` object is absent. |

`availability.premium` is a pricing tier of the domain, not the Wix Premium plan of a site. Site
Premium comes only from `premiumStatus` (§R4.2).

**Suggest domains**

```
GET https://www.wixapis.com/domain-search/v2/suggest-domains?query={query}&paging.limit=3
```

Accepts free text — business descriptions, keywords and brand concepts, not just domain names.

| Parameter | Notes |
|-----------|-------|
| `query` | Keywords, business idea or brand concept. When alternatives for a taken/unsupported domain: use the **SLD only** (for `mybusiness.com`, query `mybusiness`). |
| `paging.limit` | Always `3` on the first page. See §S3. |
| `paging.cursor` | Opaque cursor for the next page — see below. |
| `tlds` | Optional TLD filter, repeatable, no leading dots (`&tlds=com&tlds=net`). |

```json
{ "suggestions": [ { "domain": "cozycookuts.com", "premium": false },
                   { "domain": "cozycuts.net", "premium": false },
                   { "domain": "cozycutstudio.com", "premium": false } ],
  "pagingMetadata": { "count": 3, "cursors": { "next": "eyJxdWVyeSI6…" }, "hasNext": true } }
```

**Paging is cursor-based.** `pagingMetadata.hasNext` tells you whether more exist; it does **not**
fetch them. To get the next page, repeat the *same* `query` and `paging.limit` and add
`paging.cursor=<pagingMetadata.cursors.next>`. Never re-issue the same request without the cursor —
you will get the first page again.

Every returned suggestion is already available. **Never re-check availability for a suggestion.**
Never show a "premium" column or flag premium suggestions.

### R4.2 Authenticated

Use `CallWixSiteAPI` (with `siteId`) when a site is resolved, otherwise `ManageWixSite`. Both carry
Wix session auth automatically — do not add headers.

| Purpose | Call |
|---------|------|
| List the user's sites | fetch list of sites |
| Site Premium status | `GET https://manage.wix.com/_api/premium-store/plans/premiumStatus?metaSiteId={siteId}` |
| Domain cycles + pricing | `POST https://manage.wix.com/_api/premium-purchase-platform-serverless/v1/offering/72af0602-1321-4897-8299-f507480b2bb8`<br>Body: `{ "purchaseContext": { "params": { "tld": ".{TLD}" } } }` |
| Privacy addon pricing | Same offering endpoint with the addon product type id `b3d86a1d-9db3-4f69-bd54-c132808856b1`<br>Body: `{ "purchaseContext": { "params": { "tld": ".{TLD}" } } }` — the returned `products[]` is the set of addons this TLD offers (§P6) |
| TLD coupon eligibility | `com.wixpress.premium.domain.tlds.DomainTld/ListTlds`<br>Body: `{ "filter": { "tlds": ["{TLD_WITHOUT_DOT}"] } }` |
| Active Premium sale | `getPremiumSale` context call → `wix.premium.store.v1.sales/GetSale` |
| Existing contacts | `GET https://manage.wix.com/v1/domain-registration-intents/preview/{domain}` |
| Save contacts | `POST https://manage.wix.com/v1/domain-registration-intents/upsert` |
| Cancel active cart | `POST https://manage.wix.com/_api/premium-cart/v1/carts/active/cancel` · Body `{}` |
| Get fresh cart | `GET https://manage.wix.com/_api/premium-cart/v1/carts/active` |
| Add items to cart | `PATCH https://manage.wix.com/_api/premium-cart/v1/carts/active/add-items` |
| **Does this domain belong to the user** | Not here — [Connect Domain](connect-domain.md) §A4b |
| **Put a domain the account holds on a site** | Not here — [Assign Domain](assign-domain.md) |

**Premium status:** read `payload.premiumState`. `allowedDomain = premiumState !== "FREE"`.
`allowedDomain: true` → Premium site. `allowedDomain: false` → Free site.

**The offering endpoint** is the `getDomainCycles` call — the same one the production `get-domain`
purchase flow uses. Noted for whoever next reconciles this skill against production; it changes
nothing about how the call is made.

**Both offering variants return the same envelope** — `products[].pricingDetails[]`, one entry per
cycle, each carrying `finalPrice` and `renewalPrice`. Verified live for the domain type and the addon
type alike. `renewalPrice.total` is always the charge for **the same period again**, never a yearly
rate (see §R9).

## R5. Product IDs

| Item | ID |
|------|-----|
| Domain product **type** | `72af0602-1321-4897-8299-f507480b2bb8` |
| Domain product **id** | Read `products[0].productId` from the offering response — never hardcode |
| Addon product **type** (all three) | `b3d86a1d-9db3-4f69-bd54-c132808856b1` — not every TLD offers every paid addon (§P6) |
| Privacy + DNSSEC | `f8211619-d9f6-4312-9d03-f2958bbd08aa` |
| Privacy only | `22a84545-4ac0-4490-a434-45a1ebc479fb` |
| No protection | `b9d89ff0-f29b-4bfd-a3f0-6e34ae65120d` |

---

## R6. URL Templates

Use these exactly. Do not invent variants, reorder into a different form, or drop parameters.

| Name | Template |
|------|----------|
| **Checkout — with site** | `https://manage.wix.com/cart/checkout?msid={siteId}` |
| **Checkout — standalone** | `https://manage.wix.com/cart/checkout` |
| **Bundle / plan+domain** | `https://manage.wix.com/premium-pricing/wix/select-plan?domainName={domain}&referralAdditionalInfo=add-domain-purchase-intent&siteGuid={siteId}&showDomain=true` |
| **Fallback domain search** | `https://manage.wix.com/account/domains` |

Notes:

- The bundle link is the `premium-pricing/wix/select-plan` form above. An older
  `premium-domains/split-page?domainName=…` form also exists — **do not use it.**
- The connect link and the Premium upgrade links are [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md)'s (§10).

---

## R7. Free-Domain-Coupon TLDs

Used by §P2 to decide whether the "free for the first year" benefit can be
promised. Authoritative source is `DomainTld/ListTlds` → `coupons_applicable: true`. Use this static
list only as a fallback when that call is unavailable:

`.com`, `.com.au`, `.co.uk`, `.net`, `.org`, `.art`, `.at`, `.co.at`, `.be`, `.biz`, `.blog`, `.ca`,
`.ch`, `.club`, `.coach`, `.com.br`, `.de`, `.fit`, `.fitness`, `.fr`, `.fun`, `.in`, `.co.in`,
`.org.in`, `.firm.in`, `.gen.in`, `.ind.in`, `.net.in`, `.info`, `.live`, `.nl`, `.online`,
`.pictures`, `.rocks`, `.site`, `.space`, `.shop`, `.store`, `.studio`, `.training`, `.work`,
`.xyz`, `.yoga`

Extract the TLD greedily from the right: `site.co.uk` → `.co.uk`, not `.uk`.

---

## R8. Error Handling (US-37, US-38, US-39)

### Silent retry (US-37)

A call that failed for a transient reason (a `5xx`, a timeout): **retry once, silently.** A `400` is not
transient — the same body fails again, so fix what the error names and send the corrected body (§P5).
Say nothing to the user, before or after. Do not narrate
"let me try that again", do not mention that anything failed. If the retry succeeds, continue as if
nothing happened.

### Escalation ladder

| Stage | Trigger | Say (verbatim) |
|-------|---------|----------------|
| 1 | Call fails, retry also fails | *Something went wrong on our end. Please try again in a moment.* |
| 2 | The user tries again and it fails again | *Having trouble loading this — try again. You can also search for a domain directly → [https://manage.wix.com/account/domains](https://manage.wix.com/account/domains)* |

The fallback link appears at stage 2, not stage 1. Do not skip stage 1.

### Specific errors

| Error | Action |
|-------|--------|
| `DOMAINS_UNSUPPORTED_TLD` | Not an error to the user — a branch. See §S4. |
| `403` / `access_denied` on domain-search v2 | You added auth to a public endpoint. Remove all headers and retry. |
| Offering returns no products | *"Wix doesn't support purchasing this TLD. Try a different extension like .com, .net, or .org."* |
| Intent upsert validation error | A field the user gave is wrong → show which, ask for the correction, retry. A value you generated is wrong (`sessionId` is not a valid GUID) → fix it silently and retry once. See §P5. |
| Cart `add-items` fails | Confirm `productId` came from the offering response, not hardcoded. Retry once. |
| Anything else, persistent | Escalation ladder above. |

---

## R9. Forbidden Actions

❌ **Never:**

- Expose internal mechanics — no API names, endpoint paths, tool names, error codes, HTTP status
  codes, field names, or phrases like "the request failed", "I'm calling the …", "saving to the
  intent API", "adding line items", "canceling the old cart".
- Narrate work in progress: "Let me check…", "I'll look that up…", "Verifying…", "Hold on…".
  The only permitted progress line is *"Setting up your order..."* at cart build.
- Invent a price, a cycle length, a suggestion, or a URL. Every price and cycle comes from the
  offering response; every suggestion comes from the suggest endpoint; every URL comes from §R6.
- **Copy a number out of an example.** Every worked example in this document uses `{placeholder}`
  braces for exactly this reason. A concrete figure appearing in a template, a transcript, or your
  own knowledge of what domains usually cost is **not** data — it is a fabrication with a currency
  symbol in front of it. If the call that supplies a price could not be made, the flow stops
  (§P3). It does not continue with a plausible guess.
- **Attach a per-year period to a per-period price.** Every figure in `pricingDetails[]` — `finalPrice`
  and `renewalPrice` alike, domain and addon alike — is the charge for **one whole cycle**. A 3-year
  row's `$107.50` is one three-year charge. `/yr` is correct on a 1-year term and on nothing else;
  for anything longer the wording is *"every {N} years"* or *"for {N} years"*
  (§P6, §P9). This is arithmetic the user does in their head, and the error is
  always in the expensive direction.
- **Divide or multiply a price to reach a per-year figure.** The response carries `monthlyTotal` and
  `lowestCyclePrice` precisely because someone will be tempted; both are unverified in this skill and
  neither is a substitute for saying which period the price covers. Print the period, not a rate.
- Re-check availability for a domain that came from the suggest endpoint.
- Run an availability check without [Check Domain Availability](check-domain-availability.md), or call its endpoints from this recipe.
- Use `availability.premium` for anything but the premium-domain row in §R4.1, or as the site's Premium status.
- Fetch list of sites when a `siteId` is already in context. A partial roster the host preloaded is
  not that — see Case A.
- **Announce a site count instead of the sites.** *"You have 93 sites — want me to list them?"* asks
  permission for a step already required. Show them (§R3 Case B) — all of them up to eight, otherwise five
  and an invitation to name one.
- **Answer a taken domain, or look up whether a domain is the user's.** Both are
  [Connect Domain](connect-domain.md)'s (§A4b), and so is the *"if it's yours"* hedge.
- **Check availability for a subdomain, or answer one here.** A subdomain is not separately
  registrable; it goes straight to [Connect External Domain or Sub Domain](connect-external-domain-or-sub-domain.md).
- **Write to a user's site.** Putting a domain on a site, changing its role, moving it and taking it
  off are all [Assign Domain](assign-domain.md)'s; hand over and let it ask.
- **Say "main address" for "primary domain"** — or "main domain", "main URL", or any other
  paraphrase. *Root domain* is correct only for the domain a subdomain sits under, never for a
  site's primary domain.
- **Step outside the skill's scope on a taken domain.** No WHOIS or registrant lookup, no naming the
  owner, no aftermarket/broker/acquisition advice, no valuation, no trademark opinion, no web
  browsing. Full boundary: [Connect Domain](connect-domain.md) §A1.1.
- **Use a tool this skill did not ask for.** Having WHOIS, web search, or browsing available is not
  permission to use them. The information sources are the three in §R4 — that is the complete list.

✅ **Always:**

- Normalize the domain before every call.
- Reuse the resolved `siteId` for the rest of the conversation.
- Reveal information only when it changes what the user must do next.
- Say the currency note (§R10) in the same message as any price shown to the user — and never name
  a currency or convert between two.

---

## R10. Currency at Checkout

Every price this skill shows comes from the offering call as `formattedAmount`, which arrives with
its own currency symbol already attached (§P3). Checkout is a separate surface and may present the
charge in the user's own currency, so the figure in the conversation and the figure at the till can
differ in currency. The skill cannot tell in advance, so it says exactly that much and no more.

**One fixed sentence covers it, and it is the only thing this skill ever says about currency:**

> At checkout, prices may be shown in your local currency.

It goes in the **same message** as the prices it qualifies, **once**, wherever a currency amount is
shown to the user — the period table, the privacy options and the pre-checkout summary
(§P3, §P6 and §P9). In the summary it sits above the checkout link, so the link stays last.

❌ **Never:**

- **Name a currency, or convert between two.** *"That's about €7.30"* invents a figure and does
  arithmetic on a price in one move — §R9 forbids both. The sentence hedges precisely because the
  skill does not know what the checkout will show.
- **Reword it.** No *"approximate"*, no *"excluding taxes"*, no *"prices may vary"*, and no promise
  that the figure will be identical. It says what is known; everything else is invention.
- Send it twice in one message, or send it on its own with no price beside it.
- Attach it to *"Free"*, to a percentage discount, or to the free-first-year clause (§P2.3). None of
  those is a currency amount, so there is nothing to localise.

> **Why this sits after Forbidden Actions rather than in numerical order.** Renumbering
> §R9 would invalidate every reference to it across the document. A new section appended at
> the end costs nothing and breaks nothing.
