---
name: "How to Setup Wix Payments"
description: Configures Wix Payments as the payment provider. Covers eligibility checking, business verification, bank account setup, and payment method configuration (cards, PayPal, Apple Pay).
---
# How to Set Up Wix Payments

This recipe covers the setup flow needed before creating payment links or collecting payments.

## Step 1: Collect required user inputs

Before connecting Wix Payments, collect and confirm:

1. Terms acceptance: https://support.wix.com/en/article/wix-payments-terms-of-service
2. First name
3. Last name
4. Product/service description (minimum meaningful business description)
5. The site's country — if not already known, get it from `properties.locale.country` via `GET https://www.wixapis.com/site-properties/v4/properties`

## Step 2: Check country support

Wix Payments self-serve connect is currently supported for these countries: `US, CA, GB, ES, AT, BE, FI, DE, IT, NL, PT, CH, LT`.

If the site's country is not on this list, stop here — do not call connect. Tell the user self-serve connect isn't available yet for their country, and point them to the dashboard instead (Settings → Accept Payments).

## Step 3: Connect Wix Payments account

Call:

- `POST https://www.wixapis.com/payments/v1/wix-payments-account/connect`

```json
{
  "account": {
    "firstName": "<USER_FIRST_NAME>",
    "lastName": "<USER_LAST_NAME>",
    "tosAccepted": true,
    "productDescription": "<PRODUCT_DESCRIPTION>",
    "country": "<COUNTRY_CODE verified in Step 2>"
  }
}
```

## Step 4: Handle common setup blockers

### Location-related failure

If setup fails due to location details, update the business location and retry:

- `PUT https://www.wixapis.com/locations/v1/locations/{locationId}`
- Reference: [Update Location](https://dev.wix.com/docs/api-reference/business-management/locations/update-location)

### Already connected

If the account is already connected, the API returns `HTTP 500` with a body like:

```json
{
  "message": "payments already connected",
  "details": { "applicationError": { "code": "INTERNAL_ERROR" } }
}
```

Match on the `message` text, not on the `code` alone — `INTERNAL_ERROR` is a generic code reused for unrelated failures too. On this match, skip reconnect and continue with onboarding checks.

### Unsupported country

If `account.country` isn't one of the countries listed in Step 2, expect an `INVALID_ARGUMENT`-style `HTTP 400` error. Step 2's own check should make hitting this rare — don't retry the call with a different country value; tell the user the same thing Step 2 would have.

## Step 5: Complete dashboard onboarding

Connecting the account is not always the final step. To receive payments, the site owner may still need to complete Wix Payments onboarding in the site dashboard.

Connecting Wix Payments and being able to accept real checkout payments are two separate gates: the site may also need a premium eCommerce plan (Settings → Plans). Mention this even after a successful connect.

## Important Notes

1. Never invent or assume user identity/business details.
2. Always obtain explicit user consent before calling connect — this creates a real Wix Payments account and records a legally-binding Terms of Service acceptance under the name provided.
3. Use the exact accepted values provided by the user.
4. Verify readiness by testing a real payment flow (for example, create payment link) after setup.
