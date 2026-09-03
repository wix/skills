---
name: "Get Paid Recipes"
description: "Taking payments outside a store checkout — set up Wix Payments, create payment links for products, custom amounts or unpaid bookings, and link to the payments and invoicing dashboard. Use for anything users call getting paid, payment links, invoices, collecting money, card payments, PayPal, or payment setup."
---

# Get Paid Recipes

A site cannot collect anything until a provider is configured, so start with **How to Setup Wix Payments** when payments are new or failing — eligibility, business verification, bank account and enabled payment methods. Then use **Create Payment Links** for catalog products or custom line items, or **Payment Links for Bookings** when the amount owed belongs to an existing booking, since that flow ties the link to the booking id and its redirect.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Create Payment Links](https://dev.wix.com/docs/api-reference/business-management/get-paid/skills/create-payment-links)
**Technical:** Creates payment links for collecting payments without a checkout flow.
Covers store products (catalog items), custom line items, variants, due dates, and
sending links via email.

### [How to Setup Wix Payments](https://dev.wix.com/docs/api-reference/business-management/get-paid/skills/how-to-setup-wix-payments)
**Technical:** Configures Wix Payments as the payment provider. Covers eligibility
checking, business verification, bank account setup, and payment method configuration
(cards, PayPal, Apple Pay).

### [Payment Links for Bookings](https://dev.wix.com/docs/api-reference/business-management/get-paid/skills/payment-links-for-bookings)
**Technical:** Creates payment links for unpaid bookings using Payment Links API. Links
booking IDs to payment requests with proper redirect handling.

### [Get Paid Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-management/get-paid/skills/get-paid-dashboard-navigation)
**Technical:** Builds direct links to Wix payments and invoicing dashboard pages on
manage.wix.com — payment links, invoices (list, create, settings), recurring invoices,
and the accept-payments settings page. Pairs each main get-paid entity with its read API
so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when
the user asks where something is in the Wix dashboard, wants a direct link to a
dashboard page, or you need a dashboard URL to include with the result of an API
operation.
