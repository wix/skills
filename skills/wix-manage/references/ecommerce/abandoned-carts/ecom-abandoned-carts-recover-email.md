---
name: "Abandoned Carts: Recover via Email"
description: Sets up automated abandoned-cart / abandoned-checkout recovery emails. Covers Wix Dashboard automation, send timing, email content, eligibility, recovery-rate benchmarks, and when to use API-generated recovery links instead.
---

# Recover Abandoned Carts via Email

Set up an automated email that follows up with shoppers who started but did not finish checkout. This is the **email-recovery** lever. If the merchant wants to fix why shoppers leave during checkout, route to [Reduce Abandonment](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-reduce-abandonment).

Merchants often say "abandoned carts"; the public API calls them **Abandoned Checkouts**.

> **Where this is configured.** The recurring recovery email automation is a built-in Wix automation set up in the Dashboard. The trigger -> send path is not a verified TPA-public API. Use Analytics APIs for reporting questions. Use the Abandoned Checkout API for record-level verification, automation activity inspection, or redirecting a shopper back to checkout for custom flows.

## API and Dashboard status

| Capability | Route | Status |
|---|---|---|
| Configure recurring abandoned-cart email automation | Wix Dashboard -> Marketing -> Automations | Dashboard-managed |
| Measure recovery performance or abandoned-cart trends | Analytics Data API / Semantic Model API | Site Analytics read |
| Inspect specific buyer/status/activity fields | `POST https://www.wixapis.com/ecom/v1/abandoned-checkout/query` | TPA-public, drill-down |
| Redirect shopper back to checkout for a one-off custom message | `GET https://www.wixapis.com/ecom/v1/abandoned-checkout/{abandonedCheckoutId}/redirect-to-checkout?metasiteId={metasiteId}` | TPA-public |

## Required APIs for verification only

- `POST https://www.wixapis.com/ecom/v1/abandoned-checkout/query` — list eligible abandoned checkouts, filter by date/status/buyer, and inspect automation `activities` when available.
- `GET https://www.wixapis.com/ecom/v1/abandoned-checkout/{abandonedCheckoutId}` — verify a specific checkout before using it in a custom recovery flow.

## Prerequisites

- Wix Stores or another eCommerce solution is installed.
- A sender email / verified business email is connected.
- Checkout captures a customer email. Guest checkouts without an email cannot be recovered by email.

## Step 1: Enable the abandoned-cart automation

Direct the merchant to the built-in automation:

> **Wix Dashboard -> Marketing -> Automations**. Find the pre-built **Recover abandoned carts** automation and turn it on. If it does not exist, create a new automation with:
> - **Trigger:** Abandoned checkout / cart (eCommerce)
> - **Action:** Send an email to the shopper

## Step 2: Set the send timing

| Timing | Use | Notes |
|---|---|---|
| 1 hour after abandonment | Single-email default | Catches distracted shoppers while intent is fresh |
| 1 hour + 24 hours | Higher recovery | Second nudge for price or shipping hesitation |
| +72 hours with incentive | Optional third email | Only if margins allow a small discount |

Avoid sending more than about three emails. Beyond that, unsubscribes usually outweigh recoveries.

## Step 3: Write the recovery email

Include, in priority order:

1. Cart contents, such as product image and name.
2. A clear "Complete your order" button.
3. Reassurance, such as shipping policy, return policy, or support contact.
4. Optional incentive, such as a small discount or free-shipping nudge.

## Step 4: Eligibility and guardrails

- **Consent:** Respect marketing opt-out flags.
- **No double-send:** Do not send recovery email for checkouts that converted.
- **Discount stacking:** If the email includes an incentive, confirm it will not stack with existing automatic discounts.
- **Email captured only:** If the checkout did not capture an email, use broader checkout optimization instead of email recovery.

## Measurement

- **Recovery rate** = recovered abandoned checkouts / abandoned checkouts that were eligible for recovery.
- Use Analytics APIs for recovery performance, abandonment trends, and reporting. For custom reports, discover the relevant Semantic Model fields first and do not invent a ready-made "recovery rate" field unless the analytics model exposes it.
- Use 5-15% as a rough benchmark, but do not claim any API returns a single ready-made "recovery rate" field unless it is present in the data you queried.
- Track over 30 days. If recovery is below 5%, revisit timing, subject line, cart rendering, eligibility, and whether the checkout redirect still works.

## API-assisted path

For a custom recovery flow, use [Generate a recovery link / resume checkout](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-abandoned-carts-recovery-link). Prefer the Dashboard automation for recurring email sends because it handles consent, throttling, and send orchestration.

## Audit note

This file is not redundant with the public API docs because the public API does not configure Wix Automations. The value of this skill is the Dashboard/API boundary, timing guidance, eligibility guardrails, and when to switch to the API-assisted recovery-link recipe.
