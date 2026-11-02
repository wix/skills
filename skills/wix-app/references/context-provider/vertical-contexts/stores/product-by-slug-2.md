# Stores context: `@wix/stores/context/product-by-slug` (part 2 of 2)

This context's reference is split across 2 files: [product-by-slug.md](product-by-slug.md), [product-by-slug-2.md](product-by-slug-2.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/product-by-slug`.

##### `ProductContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | Product's stable catalog ID. |
| `source` | `ProductContextSource` | Which place supplied the product: a product page, the Product Data Source, or a Product Item in a Product List element. Some properties are `null` in a Product Item, such as `description`. |
| `name` | `string` | Product's display name. |
| `link` | `Link$1 \| undefined` | Link to the product's page |
| `description` | `RicosDocument \| null` | Product's description, as a [Ricos document](https://dev.wix.com/docs/ricos/api-reference/ricos-document). An empty document, with an empty `nodes` array, when the product has no description. `null` when `source` is `'product-item'`, because products in a products list don't include their description. |
| `allMedia` | `VisualMedia[]` | Original product media in display order, unaffected by buyer selections, or the product placeholder when no media exists. |
| `media` | `VisualMedia[]` | Media to display for the buyer's current option and choice-based modifier selections. Contains media connected to selected choices when configured; otherwise the same array as {@link allMedia}. Free-text modifiers do not affect this collection. |
| `mainMedia` | `Image` | Main product media represented as an image, or the product placeholder when absent. |
| `ribbons` | `ProductRibbons \| undefined` | Merchandising ribbons shown on the product, such as "New" or "Sale". |
| `breadcrumbs` | `Breadcrumb[]` | Category breadcrumb trail leading to this product. |
| `mainCategoryId` | `string \| undefined` | ID of the product's primary direct category, which defines its breadcrumb path. |
| `categories` | `ProductCategory[]` | Categories that directly contain the product, in their server-provided order. |
| `infoSections` | `ProductInfoSectionItem[] \| null` | Additional product info sections, each a title with a rich-text body. Empty array when the product has none. `null` when `source` is `'product-item'`, because products in a products list don't include their info sections. |
| `sku` | `string \| undefined` | SKU of the currently selected variant. `undefined` until the visitor has made a complete, valid variant selection. |
| `discountRules` | `{ name: string; }[] \| undefined` | Discount rules applied to the product. |
| `currency` | `string` | ISO 4217 currency code used by all product and subscription prices, such as "USD". |
| `pricing` | `{ currentSellingPrice: Price \| undefined; priceBeforeDiscount: Price \| undefined; pricePerUnit: PricePerUnit \| undefined; minCurrentSellingPrice: Price \| undefined; maxCurrentSellingPrice: Price \| undefined; minPriceBeforeDiscount: Price \| undefined; maxPriceBeforeDiscount: Price \| undefined; minPricePerUnit: PricePerUnit \| undefined; maxPricePerUnit: PricePerUnit \| undefined; }` | Pricing for the active selection and the price range across all variants. |
| `subscriptionPlans` | `SubscriptionPlan[] \| null` | Subscription plans available for the product, each with its own pricing. Empty when the product is not sold as a subscription; `null` when the provider does not support plans. |
| `options` | `ProductOption[]` | Product options the visitor chooses between, such as Color or Size. |
| `modifiers` | `Record<string, ProductModifier>` | Product modifiers, keyed by `modifierId`. These are add-on inputs such as free text or text and swatch choices. |
| `buyerSelections` | `{ options: { optionId: string; choiceId: string; }[]; modifiers: { modifierId: string; value: string; }[]; subscriptionPlanId: string \| undefined; quantity: number; }` | Values explicitly chosen by the buyer for the current product. |
| `selectedVariantId` | `string \| null` | ID of the variant resolved from the current option selection, or `null` when the selection is incomplete, invalid, or resolves to a hidden variant. |
| `selectionsAvailability` | `SelectionsAvailabilityMap` | For each option choice, `{ isInStock, isVisible }` given the current selection. Choices with `isVisible: false` resolve only to hidden variants and should be omitted; choices with `isInStock: false` should be greyed out. Keyed by `optionId` then `choiceId`. |
| `maxPurchasableQuantity` | `number` | Maximum quantity the visitor may add. This is the variant's remaining stock when it tracks quantity, otherwise an effectively unlimited cap of 99999. |
| `selectionValidationErrors` | `UserInputErrorFields` | Per-field validation errors for the current selection, empty when valid. |
| `hasAttemptedSubmit` | `boolean` | Whether the visitor has attempted to submit, via add-to-cart or buy-now. Gate the display of {@link selectionValidationErrors} on this so errors only appear after a submit attempt. |
| `selectOption` | `(optionId: string, choiceId: string) => void` | Select a choice for an option. Resets `buyerSelections.quantity` to 1. Ignored when the choice is already selected. When the option's `isGroupedOption` is `true`, selecting a choice other than the current product's navigates to that product's page instead of changing the selection. |
| `selectModifier` | `(modifierId: string, value: string) => void` | Set the value of a modifier. When the modifier's choices stand for separate products that the store groups together, such as one product per color, selecting a choice other than the current product's navigates to that product's page instead of changing the selection. This doesn't apply in a products list. |
| `clearModifierSelection` | `(modifierId: string) => void` | Clear a previously set modifier value. Ignored when the modifier has no value. |
| `selectSubscriptionPlan` | `(planId: string) => void` | Select a subscription plan by its ID. Selecting a subscription plan changes `pricing.currentSellingPrice` and `pricing.priceBeforeDiscount` to that plan's prices. Selecting the one-time purchase shows the product's own prices. |
| `selectQuantity` | `(newQuantity: number) => void` | Set the selected quantity. |
| `isInStock` | `boolean` | Whether the current selection can be purchased right now. |
| `isPreOrderState` | `boolean` | Whether the current selection is available for pre-order rather than immediate purchase. |
| `preOrderMessage` | `string \| undefined` | Merchant-configured message shown for pre-order items, when set. |
| `remainingItemCount` | `number \| undefined` | Units still available for the selection when the variant tracks quantity, or the pre-order quantity for pre-orders. `undefined` when quantity is not tracked. |
| `selectedMediaIndex` | `number` | Index into {@link media} of the item currently shown in the gallery. |
| `selectMedia` | `(index: number) => void` | Show the media item at the given index in the gallery. |
| `addToCartState` | `CartActionState` | Status of the add-to-cart action. |
| `buyNowState` | `BuyNowState` | Status of the buy-now action. |
| `handleAddToCart` | `(onSuccessPostAction?: PostAddToCartAction \| undefined) => Promise<CartActionResult>` | Validate the current selection and add it to the cart. Returns an invalid purchase error when the item can't be purchased or the selection is invalid, and returns a cart error when the cart write fails. Navigates to the product's page instead of adding to the cart when `source` is `'product-item'` and either: - The product is sold as a subscription. - The visitor hasn't selected a choice for every option, or hasn't entered a value for every mandatory modifier. |
| `handleBuyNow` | `() => Promise<CartActionResult>` | Validate the current selection and start an express checkout for it, navigating to the checkout page on success. Returns an invalid purchase error when the item can't be purchased or the selection is invalid, and returns a cart error when checkout creation or navigation fails. Navigates to the product's page instead of starting a checkout when `source` is `'product-item'` and either: - The product is sold as a subscription. - The visitor hasn't selected a choice for every option, or hasn't entered a value for every mandatory modifier. |
| `isBackInStockEnabled` | `boolean` | Whether the store has enabled back-in-stock notifications. Only relevant while an item is out of stock. When `true`, offer the visitor a "notify me when back in stock" flow, submitted via {@link handleNotifyMe}. When `false`, present the item as simply out of stock with no notify-me option. |
| `handleNotifyMe` | `(email: string) => Promise<NotifyRequestResult>` | Register a back-in-stock notification request for the current product and selected variant, so the visitor is emailed when it is restocked. Only relevant when {@link isBackInStockEnabled} is `true`. Rejects when: - No variant is selected, so `selectedVariantId` is `null`. - The request fails. The rejection is an object with the error's `code` and, if available, its `message`. |
