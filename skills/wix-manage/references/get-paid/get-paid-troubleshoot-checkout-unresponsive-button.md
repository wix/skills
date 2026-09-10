---
name: "Get Paid: Checkout Payment Button Unresponsive"
description: Diagnostic tree for when a buyer clicks "Place Order & Pay" and nothing happens — no redirect to the payment provider, no order, no Cashier transaction. Distinguishes a platform-side/client bug from a merchant payment-provider misconfiguration, and flags a commonly misread benign console warning.
layer: troubleshoot
---
# Troubleshoot: Checkout Payment Button Unresponsive

## When to use

A merchant or buyer reports that clicking the checkout submit button ("Place Order & Pay" / "Place Order") does nothing — the page doesn't navigate, no error is shown, and no payment happens. This applies to any payment provider (Wix Payments or a 3rd-party PSP like PayPlus, Stripe, etc.), on Wix Stores / eCommerce checkout.

---

## Step 1: Rule out obvious merchant-side configuration

Check quickly before deeper diagnosis:

- Site is Published.
- Wix Stores / eCommerce is installed and enabled.
- The intended payment provider shows **Active** in Accept Payments.
- Site country/currency match what the provider expects.

If all of these are fine, **do not loop on disconnect/reconnect-the-provider or republish-the-site as a diagnostic step** — those only fix merchant-side config drift. They do nothing for a client-side bug or a Wix-side incident, and repeating them wastes turns. Move to Step 2.

---

## Step 2: Determine whether the backend was ever reached

For a recent failed attempt (ask for or reproduce a synthetic checkout), check whether the click produced *any* server-side trace:

1. [Search Abandoned Checkouts](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/checkout/abandoned-checkout/search-abandoned-checkouts) or [Query Abandoned Checkouts](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/checkout/abandoned-checkout/query-abandoned-checkouts) — confirms the buyer reached checkout and entered details.
2. [List Transactions For Single Order](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/order-transactions/list-transactions-for-single-order) (eCommerce) for any order created around the failure time.
3. [Transactions List](https://dev.wix.com/docs/api-reference/business-management/payments/cashier/payments/transaction/transactions-list) (Cashier) filtered to the same time window.

Interpret the combination:

| Abandoned checkout created? | Cashier transaction / order created? | Interpretation |
|---|---|---|
| Yes | Yes (declined/failed) | Backend received the place-order request; look at `cashierError` / provider reason code — this is a provider-side decline, not a platform bug. |
| Yes | **No**, repeatedly, across multiple attempts | The click never resulted in a place-order call reaching Wix's backend. This is a **client-side or platform-side bug**, not something a merchant can self-fix by reconnecting the provider or republishing. Escalate (Step 4). |
| No | No | Buyer isn't reaching the payment step at all — check earlier checkout steps (delivery method, required fields) instead. |

---

## Step 3: Don't misread the `ecom-platform-providers` console warning

If browser console diagnostics on the live checkout show:

```
ContextProviderFactory: failed to import "ecom-platform-providers", rendering children without provider.
TypeError: Failed to resolve module specifier 'ecom-platform-providers'
```

**This is expected, benign behavior on any non-Wix-Studio (classic Editor) site** — it is a deliberate fallback (`@wix/context-provider-import-ooi`) for environments where the Builder-only context-provider module isn't published. It fires on essentially every classic-Editor Stores checkout, working or broken, and by design lets checkout continue rendering (`PassthroughProvider`) without this optional context. It affects only editor-platform site-plugin slots consuming `useCheckout()`, not the core place-order flow.

**Do not report this warning as the root cause of an unresponsive button.** If it's the only console signal found, keep looking for an actual uncaught exception, failed network request, or blocked script tied to the place-order click itself.

---

## Step 4: Escalate when no order-side trace exists

If Step 2 shows repeated attempts with **no** Cashier transaction, **no** order, and no other client-side error to explain it, self-service troubleshooting (reconnect provider, republish, clear cache) has no mechanism to fix it — reaching the payment provider requires a working client bundle and a successful place-order call to Wix's eCommerce backend, neither of which merchant-side settings control.

**Resolution**: escalate to Wix Support with: the site ID, a reproduction checkout ID, the exact console errors observed (if any) excluding the benign warning above, and confirmation that no Cashier transaction/order was created for the failed attempts. This needs backend traces (BI/error-monitoring) that aren't exposed via public APIs.

---

## Summary: Diagnostic checklist

| Step | Check | Common resolution |
|---|---|---|
| 1 | Site published, Stores enabled, provider Active, country/currency match | Fix the specific misconfigured setting; don't loop reconnect/republish once confirmed fine |
| 2 | Abandoned checkout / order / Cashier transaction for the failed attempt | Tells you whether the backend was ever reached |
| 3 | `ecom-platform-providers` console warning | Benign on non-Studio sites — not the root cause, keep looking |
| 4 | No order-side trace across repeated attempts | Escalate to Wix Support with reproduction details; not fixable via merchant-side settings |
