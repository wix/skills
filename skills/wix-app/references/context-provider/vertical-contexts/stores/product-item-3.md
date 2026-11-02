# Stores context: `@wix/stores/context/product-item` (part 3 of 3)

This context's reference is split across 3 files: [product-item.md](product-item.md), [product-item-2.md](product-item-2.md), [product-item-3.md](product-item-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/product-item`.

##### `useProductItemContextValue return value`

| Property | Type | Description |
| --- | --- | --- |
| `subscriptionPlans` | `null` |  |
| `description` | `null` |  |
| `infoSections` | `null` |  |
| `addToCartState` | `CartActionState` |  |
| `buyNowState` | `BuyNowState` |  |
| `handleAddToCart` | `(onSuccessPostAction?: PostAddToCartAction \| undefined) => Promise<CartActionResult>` |  |
| `handleBuyNow` | `() => Promise<CartActionResult>` |  |
| `isBackInStockEnabled` | `boolean` |  |
| `handleNotifyMe` | `(email: string) => Promise<NotifyRequestResult>` |  |
| `allMedia` | `VisualMedia[]` |  |
| `mainMedia` | `Image` |  |
| `media` | `VisualMedia[]` |  |
| `selectedMediaIndex` | `number` |  |
| `selectMedia` | `(index: number) => void` |  |
| `isInStock` | `boolean` |  |
| `isPreOrderState` | `boolean` |  |
| `preOrderMessage` | `string \| undefined` |  |
| `remainingItemCount` | `number \| undefined` |  |
| `buyerSelections` | `{ options: { optionId: string; choiceId: string; }[]; modifiers: { modifierId: string; value: string; }[]; subscriptionPlanId: string \| undefined; quantity: number; }` |  |
| `options` | `ProductOption[]` |  |
| `modifiers` | `Record<string, ProductModifier>` |  |
| `selectedVariantId` | `string \| null` |  |
| `selectionsAvailability` | `SelectionsAvailabilityMap` |  |
| `maxPurchasableQuantity` | `number` |  |
| `selectionValidationErrors` | `UserInputErrorFields` |  |
| `hasAttemptedSubmit` | `boolean` |  |
| `selectOption` | `(optionId: string, choiceId: string) => void` |  |
| `selectModifier` | `(modifierId: string, value: string) => void` |  |
| `clearModifierSelection` | `(modifierId: string) => void` |  |
| `selectSubscriptionPlan` | `(planId: string) => void` |  |
| `selectQuantity` | `(newQuantity: number) => void` |  |
| `currency` | `string` |  |
| `pricing` | `{ minCurrentSellingPrice: { amount: number; formattedAmount: string; } \| undefined; maxCurrentSellingPrice: { amount: number; formattedAmount: string; } \| undefined; minPriceBeforeDiscount: { amount: number; formattedAmount: string; } \| undefined; maxPriceBeforeDiscount: { amount: number; formattedAmount: string; } \| undefined; minPricePerUnit: { description: string; } \| undefined; maxPricePerUnit: { description: string; } \| undefined; currentSellingPrice: { amount: number; formattedAmount: string; } \| undefined; priceBeforeDiscount: { amount: number; formattedAmount: string; } \| undefined; pricePerUnit: { description: string; } \| undefined; }` |  |
| `link` | `Link$1 \| undefined` |  |
| `id` | `string` |  |
| `name` | `string` |  |
| `ribbons` | `ProductRibbons \| undefined` |  |
| `breadcrumbs` | `Breadcrumb[]` |  |
| `mainCategoryId` | `string \| undefined` |  |
| `categories` | `ProductCategory[]` |  |
| `sku` | `string \| undefined` |  |
| `discountRules` | `{ name: string; }[] \| undefined` |  |
| `source` | `ProductContextSource` |  |
