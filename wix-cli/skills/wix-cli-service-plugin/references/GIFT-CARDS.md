# Gift Cards Service Plugin Reference

## Overview

The Gift Vouchers Provider SPI allows you to integrate external gift card or voucher systems with Wix eCommerce. This enables customers to redeem gift cards, check balances, and void transactions.

## Import

```typescript
import { giftVouchersProvider } from '@wix/ecom/service-plugins';
```

## Handlers

| Handler | Description |
| --- | --- |
| `redeem` | Process a gift card redemption during checkout |
| `getBalance` | Check the current balance of a gift card |
| `_void` | Cancel/void a previous redemption |

## Example: Gift Card Provider Implementation

This example shows a basic gift card provider with all three required handlers.

```typescript
import { giftVouchersProvider } from '@wix/ecom/service-plugins';

giftVouchersProvider.provideHandlers({
  redeem: async (payload) => {
    const { request, metadata } = payload;
    // Use the `request` and `metadata` received from Wix and
    // apply custom logic.
    return {
      // Return your response exactly as documented to integrate with Wix.
      // Return value example:
      remainingBalance: 80.00,
      currencyCode: metadata.currency || "ILS",
      transactionId: "00000000-0000-0000-0000-000000000001",
    };
  },
  _void: async (payload) => {
    const { request, metadata } = payload;
    // Use the `request` and `metadata` received from Wix and
    // apply custom logic.
    return {
      // Return your response exactly as documented to integrate with Wix.
      // Return value example:
      remainingBalance: 100.00,
      currencyCode: metadata.currency || "ILS",
    };
  },
  getBalance: async (payload) => {
    const { request, metadata } = payload;
    // Use the `request` and `metadata` received from Wix and
    // apply custom logic.
    return {
      // Return your response exactly as documented to integrate with Wix.
      // Return value example:
      balance: 100.00,
      currencyCode: metadata.currency || "ILS",
    };
  },
});
```

## Response Structure

### redeem Response

```typescript
{
  remainingBalance: number;   // Balance after redemption
  currencyCode: string;       // Currency code (e.g., "USD", "ILS")
  transactionId: string;      // Unique ID for this redemption transaction
}
```

### _void Response

```typescript
{
  remainingBalance: number;   // Balance after voiding (restored amount)
  currencyCode: string;       // Currency code
}
```

### getBalance Response

```typescript
{
  balance: number;            // Current gift card balance
  currencyCode: string;       // Currency code
}
```

## Key Implementation Notes

1. **All three handlers required** - You must implement `redeem`, `getBalance`, and `_void`
2. **Transaction tracking** - The `redeem` handler must return a unique `transactionId` for tracking
3. **Balance as number** - Unlike other SPIs, balance values are numbers, not strings
4. **Void restores balance** - The `_void` handler should restore the redeemed amount back to the card
5. **Currency handling** - Use `metadata.currency` to get the site's currency setting
