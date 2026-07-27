---
name: "Retrieve Google Ads Billing and Payment Details"
description: "Retrieves billing and payment details for a Wix site's Google Ads account: the current billing period's ad spend (usage), the Wix service fee, the total charge, any promotional coupon adjustment, the billing period dates, and the account's credit balance (positive = available credits, negative = outstanding debt not yet charged). Also explains reading current vs remaining budget from the account object. Use when the user asks 'how much have I spent on Google Ads', 'what's my next Google Ads charge', 'show my ad billing', 'do I have ad credits left', 'why was I charged', or 'upcoming Google Ads payment'. Requires an existing Google Ads account. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Retrieve Google Ads Billing and Payment Details

Report what a site owner will be charged for Google Ads: ad spend, the Wix service fee, coupon adjustments, the total, the billing period, and the account's credit balance.

Base URL: `https://www.wixapis.com/google-ads/v1`. `<AUTH>` is the `Authorization` header. This endpoint is read-only.

**Prerequisite:** a Google Ads account must exist (`ACCOUNT_NOT_FOUND` → run [install-and-create-account](install-and-create-account.md)).

---

## Get payment details

Billing is calculated from cached subscription data (not fetched live from Google), and the charge calculation is heavy — this endpoint has a **30-second SLA**, so allow time and don't retry prematurely.

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/payment-details' -H 'Authorization: <AUTH>'
```

```json
{
  "paymentDetails": {
    "currency": "USD",
    "upcomingPayments": [
      {
        "usageAmount": "123.45",
        "wixServiceFee": "12.35",
        "totalAmount": "135.80",
        "billingPeriod": { "from": "2026-03-01", "to": "2026-03-31" },
        "couponAdjustmentAmount": "0.00"
      }
    ],
    "creditBalance": "0.00"
  }
}
```

**Reading the response:**
- `currency` — the account's billing currency; all amounts here are in it.
- `upcomingPayments[]` — the current billing period breakdown (up to 2 entries). Per entry:
  - `usageAmount` — ad spend for the period, **excluding** the Wix fee.
  - `wixServiceFee` — the Wix platform fee.
  - `couponAdjustmentAmount` — discount applied from a promotional coupon.
  - `totalAmount` — what will actually be charged: `usageAmount + wixServiceFee − couponAdjustmentAmount`.
  - `billingPeriod` — `from`/`to` dates (YYYY-MM-DD).
- `creditBalance` — the site's credits. **Positive** = credits available (e.g. from an incentive) that offset upcoming charges; **negative** = outstanding debt not yet charged. The final amount can shift slightly once the charge is processed.

When summarizing for the user, lead with `totalAmount` and the billing period, then break out spend vs fee, and flag a non-zero `creditBalance` (credits remaining, or debt owed).

> Note: an older `monthlyPayments` field is deprecated in favor of `upcomingPayments` — always read `upcomingPayments`.

---

## Budget vs. billing — a related but different view

Payment details cover *charges*. The **account object** (from `GET /v1/accounts/current-site`, see [install-and-create-account](install-and-create-account.md)) carries the *ad-budget* view:
- `currentBudget` — remaining ad budget/credit (negative = debt not yet charged).
- `spentBudget` — total spent on ads so far.

Use payment details for "what will I be charged and when"; use the account's budget fields for "how much ad budget is left."

---

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| `NOT_FOUND` / `ACCOUNT_NOT_FOUND` | No Google Ads account for the site | Run [install-and-create-account](install-and-create-account.md) |
| Slow response (up to ~30s) | Charge calculation SLA | Wait; don't retry prematurely |
| `upcomingPayments` empty | No charges accrued yet this period | Report zero upcoming charges; check `creditBalance` for credits/debt |
| Negative `creditBalance` | Outstanding debt not yet charged | Explain it's owed and will be charged; not an error |

## References

- [Payment Details Service introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/payment-details-v1/introduction)
- [Get Payment Details](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/payment-details-v1/get-payment-details)
- [Account Service](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-account-v1/introduction)
