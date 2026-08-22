---
name: "Diagnose Checkout Payment Failures"
description: "Diagnoses why online checkout payments are failing, especially when one payment method (e.g. Apple Pay / Google Pay) fails while another (e.g. cards) succeeds through the same connected provider. Pulls recent Cashier transactions for their failure reason code, cross-checks the connected provider's declared capabilities (Site Payment Method Types), and only then treats it as a platform bug. Use when a site owner reports 'customers can't pay' / 'checkout payment fails' / 'Apple Pay doesn't work but cards do' for a specific payment provider."
---
# Diagnose Checkout Payment Failures

This recipe is for reports like *"customers can't complete checkout,"* *"payment fails at checkout,"* or (the most common false alarm) *"Apple Pay / Google Pay fails but credit cards work fine."* It routes the failure to one of three buckets — provider-side decline, provider-capability mismatch, or genuinely unclear — **before** concluding it's a Wix platform bug.

> **Read this first if the complaint singles out one payment method.** "Cards work, Apple Pay doesn't" (or vice versa) is very often **not** a bug at all — see [Step 3](#step-3--if-only-one-payment-method-fails-check-the-providers-declared-capabilities-first). Skipping straight to "the platform is broken" here wastes the owner's time chasing the wrong fix.

## Step 1 — Pull the failing transactions

Use [Transactions List](https://dev.wix.com/docs/api-reference/business-management/payments/cashier/payments/transaction/transactions-list) (`GET https://www.wixapis.com/payments/api/merchant/v2/transactions`), filtered to a recent time window, to find the failed attempts. For each failed transaction, note:

- `status` (e.g. `FAILED`)
- The failure/reason code and message
- `providerId` — which connected payment provider handled it
- The payment method data type (e.g. card vs. a wallet/express payment method)
- Whether a **provider transaction ID** was actually created

## Step 2 — Look up the reason code

Cashier's [Reason Codes](https://dev.wix.com/docs/api-reference/business-management/payments/payment-service-provider-service-plugin/reason-codes) reference explains what each numeric code means (e.g. `1006` = "Request is not allowed," `3012` = "Insufficient funds," `5001` = "Risk management declined"). These codes are what the **provider** (PSP) returns to Wix — for the `1000`–`1014` "general error" range in particular, ownership of the underlying cause sits mostly with the provider, not Wix.

**A failure with no provider transaction ID is a strong signal the request never reached the provider's actual charge logic** (an immediate reject, a capability mismatch, or a provider-side pre-check) — as opposed to a decline that happened *after* a real authorization attempt.

## Step 3 — If only one payment method fails, check the provider's declared capabilities *first*

Before assuming a platform bug, check whether the connected provider even declares support for the failing payment method. Call [Get Site Payment Method Type](https://dev.wix.com/docs/api-reference/business-management/payments/site-payment-method-types/get-site-payment-method-type) for the provider's payment method type ID (found on the transaction, or in **Settings → Accept Payments** in the dashboard):

```
GET https://www.wixapis.com/payments/site-payment-method-types/v1/site-payment-method-types/{id}?countryCode={country}&currencyCode={currency}
```

Check `features`:

- **`expressFlow.supported`** — whether this provider can be used for one-tap "express" wallet checkout (Apple Pay, Google Pay). If a wallet-type payment fails for this provider and `expressFlow.supported` is `false`, **that is the answer** — the provider isn't wired for wallet payments through Wix, regardless of what its marketing description or Wix's own support article for it says. This is a real, observed inconsistency for at least one provider (PayPlus, ID `d4c66807-090c-46ea-add7-93470c2b9132`): its `description` field and Wix's public support article for it both mention Apple Pay, but `expressFlow.supported` is `false`.
- **`regularFlow.supported`** — standard card-entry / redirect payments.
- Other relevant flags: `installments`, `moto`, `authCapture`, `regularTokenization` — check these if the failing payment type matches one of them.

> **Don't trust the provider's `description` text or a support article alone.** They can be out of sync with the structured `features` flags that actually govern runtime behavior — `features` is the source of truth for what will and won't work.

If `expressFlow.supported` is `false` (or the relevant feature flag is unsupported) for the connected provider, tell the owner plainly: *this provider doesn't support [Apple Pay / Google Pay / whichever method] on Wix — switch to a provider that does, or advise customers to use a card instead.* Don't file this as a platform bug.

## Step 4 — If the capability check doesn't explain it

If the failing payment method **is** declared as supported (`expressFlow.supported: true` or the matching flag is `true`) and it still fails while other methods succeed:

- Check **Checkout Settings** ([Checkout Settings API](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/checkout/checkout-settings/introduction)) for anything that could restrict payment methods.
- Confirm the failure is reproducible and not a one-off (retry, or check for repeated occurrences across multiple buyers/sessions).
- At this point it's reasonable to treat it as a genuine provider-side or platform issue worth escalating — either as Wix feedback if it looks like a Wix-side gap, or by contacting the provider directly if their own endpoint is rejecting requests it declared it supports (`expressFlow.supported: true` but consistently returns an immediate decline with no provider transaction ID for that payment method).

## Presenting to the user

Keep it plain-language and specific to what you found — don't dump raw reason codes or JSON at a site owner:

- ✅ "Your payment provider (PayPlus) doesn't support Apple Pay through Wix, even though its description mentions it — that's why those payments fail immediately while card payments go through fine. I'd recommend [contacting PayPlus / switching providers / asking customers to pay by card]."
- ❌ "Transaction failed with reasonCode 1006, PaymentMethodDataType WalletPaymentMethodData, providerTransactionId empty."
