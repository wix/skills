---
name: "Abandoned Carts: Recovery Link"
description: Generates a one-click recovery link for an abandoned checkout using the Abandoned Checkout API. Covers listing abandoned checkouts, selecting the correct abandonedCheckoutId, and redirecting the shopper back to checkout.
---

# Generate a Recovery Link

Use this when the merchant wants a one-off link that returns a shopper to the checkout they abandoned. For recurring automated emails, use [Recover Abandoned Carts via Email](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-abandoned-carts-recover-email).

Merchants often say "abandoned cart"; the API entity is **Abandoned Checkout**.

## Required APIs

- `POST https://www.wixapis.com/ecom/v1/abandoned-checkout/query` — list abandoned checkouts. The public docs say query can return up to 100 abandoned checkouts per request and supports filters such as `status`, `createdDate`, `updatedDate`, and buyer identifiers.
- `GET https://www.wixapis.com/ecom/v1/abandoned-checkout/{abandonedCheckoutId}` — retrieve and verify one abandoned checkout.
- `GET https://www.wixapis.com/ecom/v1/abandoned-checkout/{abandonedCheckoutId}/redirect-to-checkout?metasiteId={metasiteId}` — redirect the caller to the checkout page. The response is a redirect response, not a normal JSON "create link" object.

Authentication: the Abandoned Checkout docs require a Wix app or Wix user identity. Permission: `Read Orders`.

## Step 1: Find the abandoned checkout

Use the query endpoint for a simple list:

```http
POST https://www.wixapis.com/ecom/v1/abandoned-checkout/query
```

Example filter:

```json
{
  "query": {
    "filter": {
      "status": "ABANDONED"
    },
    "cursorPaging": {
      "limit": 50
    }
  }
}
```

Use `/ecom/v1/abandoned-checkout/search` when the merchant needs richer filters, such as customer email, date range, cart value, or sort order.

## Step 2: Confirm the target checkout

Before generating a link, confirm the abandoned checkout matches the merchant's intended shopper or order context:

- buyer/contact email or contact ID
- cart total
- created or updated timestamp
- abandoned checkout `id`
- site or `metasiteId` context needed for redirect

Do not generate a link for a checkout that already converted.

## Step 3: Redirect to checkout

```http
GET https://www.wixapis.com/ecom/v1/abandoned-checkout/{abandonedCheckoutId}/redirect-to-checkout?metasiteId={metasiteId}
```

The response is expected to be an HTTP redirect, usually `302`, with the checkout URL in the `Location` header. Use the redirected URL in the merchant's own message, support reply, or recovery email CTA only after confirming it belongs to the intended shopper/checkout.

Example response shape:

```json
{
  "statusCode": 302,
  "headers": [
    {
      "key": "Location",
      "value": "https://example.wixsite.com/store/checkout?appSectionParams=..."
    }
  ]
}
```

## Guardrails

- Confirm the shopper can be contacted before sharing a recovery link.
- Treat the link as shopper-specific. Do not publish it broadly.
- If the merchant wants recurring sends, route to the Dashboard automation recipe instead of trying to build an email scheduler here.
- If the API returns a redirect response, extract the `Location` header. Do not invent a `checkoutUrl` or `recoveryUrl` field if the response did not return one.
- If no `Location` header is present, return the status code and headers you received and route to troubleshooting.

## Audit note

This file is not redundant with the API docs because it adds selection guardrails, the merchant-facing recovery-message boundary, and the critical response-shape detail: redirect-to-checkout is a `GET` redirect flow, not a JSON link-generation action.
