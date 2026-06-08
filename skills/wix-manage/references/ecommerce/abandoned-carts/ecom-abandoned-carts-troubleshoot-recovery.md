---
name: "Abandoned Carts: Troubleshoot Recovery"
description: Diagnoses abandoned-cart recovery flows that are not sending, not generating usable links, or not recovering shoppers. Covers Dashboard automation checks, email eligibility, Abandoned Checkout API checks, and recovery-rate triage.
---

# Troubleshoot Abandoned-Cart Recovery

Use this when a merchant says abandoned-cart recovery is enabled but messages are not sending, links are not working, or recovery performance is weak.

Merchants often say "abandoned cart"; the public API entity is **Abandoned Checkout**.

## Required APIs and Dashboard checks

| Area | Check | Status |
|---|---|---|
| Dashboard automation | Automation active, trigger/action configured, sender valid, conditions not excluding shoppers | Dashboard-managed |
| Information/reporting | Analytics Data API or Semantic Model API for counts, trends, and recovery performance | Site Analytics read |
| Abandoned checkout lookup | `POST /ecom/v1/abandoned-checkout/query` or `/search` for record-level drill-down | TPA-public |
| Single checkout verification | `GET /ecom/v1/abandoned-checkout/{abandonedCheckoutId}` | TPA-public |
| Checkout redirect | `GET /ecom/v1/abandoned-checkout/{abandonedCheckoutId}/redirect-to-checkout?metasiteId={metasiteId}` | TPA-public |

## Step 1: Identify the recovery path

Ask which recovery path the merchant is using:

- **Dashboard automation:** Wix sends abandoned-cart emails automatically.
- **API-assisted recovery:** An external email/message includes a recovery link generated from the Abandoned Checkout API.

If they are unsure, start with Dashboard automation checks.

## Step 2: Branch by likely failure point

| Symptom | Likely branch | First check |
|---|---|---|
| Emails are not sending | Dashboard automation | Automation active, trigger is abandoned checkout/cart, sender valid |
| Emails send but customers cannot return | API/link path | Redirect endpoint returns `302` with a `Location` header |
| Few shoppers are eligible | Eligibility | Email/contact captured, not opted out, checkout still abandoned |
| Recovery is low but technically working | Performance | Timing, content, shipping/payment/tax surprises |

## Step 3: Check Dashboard automation

For Dashboard automation issues, ask the merchant to verify:

- The automation is active.
- The trigger is abandoned checkout / cart, not checkout started.
- The send action has a valid sender email.
- The email content includes a clear recovery CTA.
- There is no audience, segment, or condition that excludes most abandoned checkouts.

## Step 4: Check eligibility

Recovery only works when there is enough shopper context:

- The checkout captured an email or contact.
- The shopper did not opt out.
- The checkout did not later convert.
- The store did not delete or materially change the cart contents in a way that breaks the return path.

## Step 5: Check the API path

If the merchant is generating links programmatically:

1. Query abandoned checkouts with `POST /ecom/v1/abandoned-checkout/query` or `/search`.
2. Confirm the chosen abandoned checkout is still abandoned.
3. Redirect with `GET /ecom/v1/abandoned-checkout/{abandonedCheckoutId}/redirect-to-checkout?metasiteId={metasiteId}`.
4. Confirm the response is a redirect, usually `302`, and extract the checkout URL from the `Location` header.
5. Test the returned URL before sending it to shoppers.

If the generated link works but emails do not send, the issue is in the email channel, not the Abandoned Checkout API.

## Step 6: Triage weak recovery performance

If emails send and links work but recovery is low:

- Use Analytics APIs to compare abandoned-cart volume, conversion/recovery performance, and current-period trend against the baseline.
- Compare recovery rate against a rough 5-15% benchmark only when the analytics model or source data supports that metric.
- Check timing. One hour after abandonment is usually a good first send.
- Check whether cart contents render in the message.
- Check whether shipping cost, payment failure, or tax surprises caused the abandonment.
- If abandonment is rising broadly, route to [Recovery Health Monitor](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-abandoned-carts-recovery-health) or checkout troubleshooting.

## Response shape

Return a short diagnosis with:

- recovery path used
- likely failure point
- evidence checked
- next action
- whether the fix is Dashboard, API, checkout, shipping, or pricing related

## Audit note

This file is not redundant with API docs because it connects Dashboard automation failures, Abandoned Checkout API verification, eligibility checks, and cross-category root-cause routing into one diagnostic tree.
