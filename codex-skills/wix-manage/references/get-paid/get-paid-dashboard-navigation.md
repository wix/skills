---
name: "Get Paid Dashboard Navigation"
description: "Builds direct links to Wix payments and invoicing dashboard pages on manage.wix.com — payment links, invoices (list, create, settings), recurring invoices, and the accept-payments settings page. Pairs each main get-paid entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Get Paid Dashboard Navigation

Build direct links into the payments and invoicing pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

Get-paid pages are split across **four apps** with four URL namespaces:

- **Pay Links** (`324cf725-53d9-4bb2-b8f6-0c8ec9a77f45`) — payment links. Routes under `pay-links/`.
- **Wix Invoices** (`13ee94c1-b635-8505-3391-97919052c16f`) — invoices and price quotes. Routes under `wix-invoices/`.
- **Recurring Invoices** (`35aec784-bbec-4e6e-abcb-d3d724af52cf`) — subscription invoices. Routes under `recurring-invoices/`.
- **Payments** (`14bca956-e09f-f4d6-14d7-466cb3f09103`) — the accept-payments settings. Routes under `wix-cashier/`.

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Payment links | `pay-links` | All payment links |
| Invoices list | `wix-invoices` | All invoices |
| New invoice | `wix-invoices/invoice/new` | Create an invoice |
| Invoice items & services | `wix-invoices/products/list` | Reusable line items for invoices |
| Invoice reports | `wix-invoices/reports` | Revenue / tax summaries |
| Invoices settings | `wix-invoices/settings` | Numbering, customization, automations, pay links, price quotes |
| Recurring invoices | `recurring-invoices` | Subscription invoices list |
| New recurring invoice | `recurring-invoices/form` | Create a recurring invoice |
| Accept payments | `wix-cashier/payments` | Payment methods and provider settings |

Older links (`payment-links`, `invoices`, `invoices/create`, `payments`) redirect to the current routes.

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header.

| Entity | Read API | Dashboard link |
|---|---|---|
| Payment link | `POST /payment-links/v1/payment-links/query` · `GET /payment-links/v1/payment-links/{paymentLinkId}` | `pay-links` |
| Invoice | Invoices API (Query Invoices) | `wix-invoices` |
| Payment provider setup | Wix Payments Account API (`POST /payments/v1/wix-payments-account/connect` for onboarding status) | `wix-cashier/payments` |

Example — after creating a payment link:

```
Created a $50 payment link for "Consultation".
Manage your payment links here: https://manage.wix.com/dashboard/{metaSiteId}/pay-links
```

## Notes

- Wix Payments account-level pages (payouts, balance, disputes) are part of the provider's own dashboard flow and aren't stable site-dashboard routes — link `wix-cashier/payments` for anything payment-provider related.
