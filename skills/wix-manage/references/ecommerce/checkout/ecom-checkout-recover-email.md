---
name: "Checkout: Recover Abandoned Carts via Email"
description: Sets up automated abandoned-cart / abandoned-checkout recovery emails — follow-up emails to shoppers who added to cart or started checkout but didn't complete. Covers the built-in Wix abandoned-cart automation, send timing, email content, eligibility, and recovery-rate benchmarks. Triggers on "create an abandoned cart email", "follow up with people who didn't complete checkout", "recover abandoned carts".
---

# Recover Abandoned Carts via Email

Set up an automated email that follows up with shoppers who started but didn't finish checkout. This is the **email-recovery** lever (distinct from the shipping-friction lever in [Reduce Abandonment](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-reduce-abandonment), which fixes *why* they leave; recovery email re-engages those who already left).

> **Where this is configured.** The recurring recovery *email automation* is a **built-in Wix automation set up in the Dashboard** — the trigger→send is not a verified TPA-public API (Triggered Emails is PRIVATE/ALPHA). However, the **Abandoned Checkout API IS TPA-public** (query abandoned checkouts + generate a recovery link) — so an agent can build a custom recovery flow even though the turnkey recurring email is Dashboard-configured. See the "Agent path" section below.

## Prerequisites

- Wix Stores (or another eCommerce solution) installed.
- A connected sender email / verified business email for sending.
- Checkout collects a customer email (guest or member) — only checkouts with a captured email can be recovered.

## Step 1: Enable the abandoned-cart automation

Direct the merchant to the built-in automation:

> **Wix Dashboard → Marketing → Automations** (or **Store → Communications**). Find the pre-built **"Recover abandoned carts"** automation and turn it on. If it doesn't exist, create a new automation with:
> - **Trigger:** *Abandoned checkout / cart* (eCommerce)
> - **Action:** *Send an email* to the shopper

## Step 2: Set the send timing

| Timing | Use | Notes |
|---|---|---|
| **1 hour** after abandonment | Single-email default | Catches "got distracted" shoppers while intent is fresh |
| **1h + 24h** sequence | Higher recovery | Second nudge for price/shipping hesitation |
| **+72h with incentive** | Optional 3rd | Only if margins allow a small discount |

Avoid sending more than ~3 emails — beyond that, unsubscribes outweigh recoveries.

## Step 3: Write the recovery email

Include, in priority order:
1. **The cart contents** (product image + name) — the single biggest driver of recovery.
2. A **clear "Complete your order" button** linking back to the prefilled checkout.
3. **Reassurance** — shipping/return policy, support contact.
4. **(Optional) incentive** — a small discount or free-shipping nudge. Don't lead with it; train shoppers to abandon-for-discounts if every email has one.

## Step 4: Eligibility & guardrails

- **Consent:** only email shoppers who haven't opted out; respect marketing-consent flags. Recovery email is transactional-adjacent but treat opt-out as binding.
- **No double-send:** don't fire recovery email for checkouts that converted (the automation handles this, but verify the trigger is "abandoned", not "checkout started").
- **Discount stacking:** if an incentive is included, confirm it won't stack with an existing automatic discount (see Pricing & promotions → conflict checks).
- **Email captured only:** guest checkouts without an email can't be recovered — consider enabling email-capture earlier in checkout.

## Measurement

- **Recovery rate** = recovered orders / abandoned checkouts emailed. Benchmark **5–15%**.
- Track over 30 days; if < 5%, revisit timing (too late?), subject line, or whether the cart contents render in the email.
- Cross-check with [Reduce Abandonment](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-reduce-abandonment): if abandonment is driven by shipping friction, fixing that lifts conversion *before* recovery email is even needed.

## Agent path — find abandoned checkouts & generate recovery links (API)

The recurring *automation* lives in the Dashboard, but the **Abandoned Checkout API** (`wix.ecom.v1.abandoned_checkout`, TPA-public / GA) lets an agent build a custom recovery flow — list who abandoned and produce a one-click recovery link to drop into an email or message.

**Step A — list abandoned checkouts:**

```
POST https://www.wixapis.com/ecom/v1/abandoned-checkout/query
{ "query": { "filter": { "status": "ABANDONED" }, "cursorPaging": { "limit": 50 } } }
```

Returns each abandoned checkout with its `id`, buyer contact, cart total, and timestamps. (`/ecom/v1/abandoned-checkout/search` supports richer filtering.)

**Step B — get the recovery link for one checkout:**

```
POST https://www.wixapis.com/ecom/v1/abandoned-checkout/{abandonedCheckoutId}/redirect-to-checkout
```

Returns a URL that takes the shopper straight back to their pre-filled checkout — put this in the recovery email's CTA button.

**Sending the email:** prefer the **Dashboard automation** above (it handles consent, throttling, and the send). Wix's Triggered Emails API exists but is **PRIVATE / ALPHA** (no public docs page) — do not rely on it for sends; if a fully programmatic send is required, confirm it's published at `dev.wix.com/docs` first, otherwise use the Dashboard automation or your own email channel with the recovery link from Step B.
