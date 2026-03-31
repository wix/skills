# Recipe: Product Catalog + Cart + Checkout

Build a complete e-commerce feature using `@wix/stores`, `@wix/ecom`, and `@wix/redirects` — product listing, product detail, cart, and checkout via Wix-hosted checkout page.

> **V3 Catalog:** New Wix sites use Catalog V3. The V1 `products` export from `@wix/stores` silently returns 0 results on V3 catalogs. Always use `productsV3` instead.

## Prerequisites

- Wix Stores app must be installed on the site (via `--apps stores` during scaffolding, or installed via MCP if missing — see Step 0)
- Packages installed: `npm install @wix/stores @wix/ecom @wix/redirects`

## Setup: Replace Default Products via MCP

> **Conditional:** This section only applies when ALL of these are true:
> - The Stores app was just installed (default sample products exist)
> - Wix MCP tools are available (`mcp__wix-mcp-remote__CallWixSiteAPI` exists)
> - Discovery context is available (business type, brand name, style from `wix-headless-solution-architect`)
>
> **If MCP tools are not available, skip this entire section.** The 12 default products remain and can be customized later in the Wix dashboard.

### Step 0: Ensure Stores App Is Installed

Before querying products, verify the Stores app is installed:

1. **Probe** — `CallWixSiteAPI: POST /stores/v3/products/query` with body `{ "query": { "paging": { "limit": 1 } } }`
2. **If the API returns a "REQUIRED_APP_NOT_INSTALLED" error** → install the Wix Stores app:
   ```
   CallWixSiteAPI: POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install
   body: {
     "tenant": { "tenantType": "SITE", "id": "<siteId>" },
     "appInstance": { "appDefId": "1380b703-ce81-ff05-f115-39571d94dfcd", "enabled": true }
   }
   ```
   Then retry the probe query to confirm installation succeeded.
3. **If the probe succeeds** → proceed to Step 1.

---

Replace the 12 generic sample products with 3 on-brand products that match the user's business before building any code.

### Step 1: Query Default Products

```
CallWixSiteAPI: POST /stores/v3/products/query
body: {
  "query": {
    "paging": { "limit": 50 }
  }
}
```

Collect all product IDs from the response.

### Step 2: Bulk Delete Defaults

```
CallWixSiteAPI: POST /stores/v3/bulk/products/delete
body: {
  "productIds": ["<id1>", "<id2>", ..., "<id12>"]
}
```

### Step 3: Design 3 On-Brand Products

No API call — use discovery context (business type, brand name, style, industry) to plan 3 products:

- Product names, descriptions, and pricing appropriate for the business
- Product type: `PHYSICAL`
- Options (size, color, etc.) if appropriate for the business type

**Product design guidelines by business type:**

| Business Type | Product 1 | Product 2 | Product 3 |
|--------------|-----------|-----------|-----------|
| Skincare / beauty | Signature serum or moisturizer | Cleansing product | Gift set or bundle |
| Clothing / fashion | Signature top or dress | Accessory item | Seasonal piece |
| Food / bakery | Signature item (cake, bread) | Sampler or variety pack | Gift box |
| Home / decor | Statement piece | Functional item | Set or collection |
| Fitness / wellness | Core product (mat, equipment) | Accessory | Starter kit |
| General retail | Best-seller item | Complementary item | Value bundle |

Adapt names, descriptions, and pricing to match the brand's tone and style. Use the brand name in product descriptions where natural.

### Step 3b: Generate Product Images

Products without images look incomplete. Before creating products, **always ask the user** if they'd like to generate product images — do not skip this step silently.

Follow `../shared/IMAGE_GENERATION.md` (Steps 1–3) to get the API key, generate each image, and import to Wix Media. If the user declines to provide a key, skip entirely — omit the `media` field in Step 4.

**Prompt template — product images:**

"Professional product photography of [PRODUCT NAME]: [brief product
description]. [BRAND AESTHETIC DIRECTION] style. Color palette
featuring [PRIMARY/SECONDARY COLORS from global.css]. [LIGHTING
that matches brand mood — e.g., soft natural light for organic brands,
dramatic studio lighting for luxury brands]. Clean background
complementing the brand palette. High quality, no text, no watermarks"

Example for a skincare brand with organic aesthetic:
"Professional product photography of Bloom & Root Renewal Serum:
a luxurious face serum in a frosted glass bottle with botanical
label. Organic editorial aesthetic inspired by Kinfolk magazine.
Warm cream (#F5F0E8) and forest green (#2D4A3E) color tones.
Soft diffused natural morning light, linen fabric surface with
dried botanicals. Clean composition, high quality, no text,
no watermarks"

Save the `file.url` (wixstatic URLs) returned from each Wix Media import — these are used in Step 4's `media` field.

### Step 4: Bulk Create 3 Products (with images)

> **V3 bulk create body format:** Each item in the `products` array is a flat product object — do NOT wrap in a `"product"` key. Every product requires `options` and `variantsInfo` (even simple products with no real variants).

**Product with size variants** (e.g., skincare with 30ml/50ml):

```
CallWixSiteAPI: POST /stores/v3/bulk/products-with-inventory/create
body: {
  "products": [
    {
      "name": "<Product Name>",
      "productType": "PHYSICAL",
      "description": {
        "nodes": [
          {
            "type": "PARAGRAPH",
            "id": "<unique-id>",
            "nodes": [
              { "type": "TEXT", "textData": { "text": "<Product description>" } }
            ],
            "paragraphData": { "textStyle": { "textAlignment": "AUTO" } }
          }
        ],
        "metadata": { "version": 1, "id": "<unique-id>" }
      },
      "visible": true,
      "visibleInPos": true,
      "physicalProperties": {},
      "media": {
        "itemsInfo": {
          "items": [
            { "url": "<wixstatic-url>" }
          ]
        }
      },
      "options": [
        {
          "name": "Size",
          "optionRenderType": "TEXT_CHOICES",
          "choicesSettings": {
            "choices": [
              { "choiceType": "CHOICE_TEXT", "name": "30ml" },
              { "choiceType": "CHOICE_TEXT", "name": "50ml" }
            ]
          }
        }
      ],
      "variantsInfo": {
        "variants": [
          {
            "choices": [
              {
                "optionChoiceNames": {
                  "optionName": "Size",
                  "choiceName": "30ml",
                  "renderType": "TEXT_CHOICES"
                }
              }
            ],
            "price": { "actualPrice": { "amount": "48.00" } },
            "visible": true,
            "inventoryItem": { "quantity": 50, "preorderInfo": { "enabled": false } },
            "physicalProperties": {}
          },
          {
            "choices": [
              {
                "optionChoiceNames": {
                  "optionName": "Size",
                  "choiceName": "50ml",
                  "renderType": "TEXT_CHOICES"
                }
              }
            ],
            "price": { "actualPrice": { "amount": "72.00" } },
            "visible": true,
            "inventoryItem": { "quantity": 35, "preorderInfo": { "enabled": false } },
            "physicalProperties": {}
          }
        ]
      }
    }
  ],
  "returnEntity": true
}
```

**Simple product without real variants** (e.g., a gift set with only one option):

Use a single dummy option/variant to satisfy the required fields:

```json
{
  "options": [
    {
      "name": "Type",
      "optionRenderType": "TEXT_CHOICES",
      "choicesSettings": {
        "choices": [{ "choiceType": "CHOICE_TEXT", "name": "Standard" }]
      }
    }
  ],
  "variantsInfo": {
    "variants": [
      {
        "choices": [
          {
            "optionChoiceNames": {
              "optionName": "Type",
              "choiceName": "Standard",
              "renderType": "TEXT_CHOICES"
            }
          }
        ],
        "price": { "actualPrice": { "amount": "89.00" } },
        "visible": true,
        "inventoryItem": { "quantity": 30, "preorderInfo": { "enabled": false } },
        "physicalProperties": {}
      }
    ]
  }
}
```

Include all 3 products in the `products` array. Use the Ricos format for descriptions (PARAGRAPH > TEXT > textData).

For each product, include the `media` field with the wixstatic URL from Step 3b:

```json
"media": {
  "itemsInfo": {
    "items": [
      { "url": "<wixstatic-url-from-step-3b>" }
    ]
  }
}
```

If the user declined image generation in Step 3b, omit the `media` field entirely.

> **Fallback — adding images to existing products later:** If you need to attach images to products that were already created without them, use PATCH. But note: the Update Product endpoint validates variant-option alignment on every PATCH. You **must** include the product's existing `options` and `variantsInfo` (with variant IDs) alongside `media`, or the call fails with a 428 "Variant option not found" error. Get the full product data (including variant IDs) via `GET /stores/v3/products/{productId}?fields=VARIANT_OPTION_CHOICE_NAMES`.

### Step 5: Verify

```
CallWixSiteAPI: POST /stores/v3/products/query
body: {
  "query": { "paging": { "limit": 50 } }
}
```

Confirm exactly 3 products exist. Report the product names and prices to the user.

### Step 6: Log Results

Write to `.wix/features.log.md` (see `../shared/FEATURES_LOG.md` for format):

```markdown
## stores
- Status: complete
- Content: {n} products created ({product names})
- Images: {generated (n/n attached) | skipped (user declined) | not attempted}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pages/products/index.astro` | Product listing page |
| `src/pages/products/[slug].astro` | Product detail page |
| `src/pages/cart.astro` | Cart page with checkout button |
| `src/pages/thank-you.astro` | Post-checkout thank-you page |
| `src/components/ProductCard.astro` | Reusable product card |
| `src/utils/wix-image.ts` | Helper to resolve `wix:image://` URLs to optimized CDN URLs |
| `src/components/AddToCartButton.tsx` | React island — add item to cart (with variant support) |
| `src/components/ProductPurchase.tsx` | React island — option selectors + variant resolution + wraps AddToCartButton |
| `src/components/CartView.tsx` | React island — cart display + checkout redirect |

## Implementation

### 0. Wix Image Utility (`src/utils/wix-image.ts`)

Resolves `wix:image://` protocol URLs (returned by V3 catalog) to optimized CDN URLs with resizing.

```typescript
import { media } from "@wix/sdk";

/**
 * Resolve a Wix image URL (wix:image:// protocol) to a scaled CDN URL.
 * Returns undefined if the input is falsy.
 */
export function resolveWixImageUrl(
  wixImageUrl: string | undefined,
  width: number,
  height: number,
): string | undefined {
  if (!wixImageUrl) return undefined;
  return media.getScaledToFillImageUrl(wixImageUrl, width, height, {});
}
```

This utility is imported by `ProductCard.astro` and `products/[slug].astro`. The CMS skill uses an equivalent inline `resolveImage` helper in its service modules (see `CMS_FOUNDATIONS.md`).

### 1. Product Listing Page (`src/pages/products/index.astro`)

```astro
---
import Layout from "../../layouts/Layout.astro";
import ProductCard from "../../components/ProductCard.astro";
import { productsV3 } from "@wix/stores";

const { items: productList } = await productsV3.queryProducts({ fields: ["CURRENCY"] }).limit(50).find();
---

<!-- Page layout styled by the design skill -->
<Layout title="Products">
  <main>
    <div>
      <h1>Our Products</h1>
      <div>
        {productList.map((product) => (
          <ProductCard product={product} />
        ))}
      </div>
    </div>
  </main>
</Layout>
```

### 2. Product Card Component (`src/components/ProductCard.astro`)

V3 image URLs use `wix:image://` protocol — resolve with `resolveWixImageUrl()` from `src/utils/wix-image.ts` (see Step 0 above).

```astro
---
import { resolveWixImageUrl } from "../utils/wix-image";

interface Props {
  product: {
    name?: string;
    slug?: string;
    media?: { main?: { image?: string }; items?: any[] };
    actualPriceRange?: { minValue?: { formattedAmount?: string } };
  };
}

const { product } = Astro.props;
const imageUrl = resolveWixImageUrl(product.media?.main?.image, 600, 800);
const price = product.actualPriceRange?.minValue?.formattedAmount;
---

<a href={`/products/${product.slug}`}>
  <div>
    {imageUrl && (
      <img
        src={imageUrl}
        alt={product.name ?? "Product"}
      />
    )}
  </div>
  <div>
    <h3>{product.name}</h3>
    {price && <p>{price}</p>}
  </div>
</a>
```

> **Styling note:** The ProductCard component is created by the design skill with full branded styling. The feature skill only wires the data mapping (product → props).

### 3. Product Detail Page (`src/pages/products/[slug].astro`)

> **IMPORTANT:** Use `getProductBySlug()` instead of `queryProducts()` for the product detail page. `queryProducts()` does NOT return variant data (`options`, `variantsInfo`). Without variant data, `catalogReference.options.variantId` cannot be sent to the cart API, and add-to-cart silently fails (returns 200 OK but adds nothing).

```astro
---
import Layout from "../../layouts/Layout.astro";
import ProductPurchase from "../../components/ProductPurchase.tsx";
import { productsV3 } from "@wix/stores";
import { resolveWixImageUrl } from "../../utils/wix-image";

const { slug } = Astro.params;

const { product } = await productsV3.getProductBySlug(slug!, { fields: ["CURRENCY", "PLAIN_DESCRIPTION"] });

if (!product) return Astro.redirect("/404");

const imageUrl = resolveWixImageUrl(product.media?.main?.image, 800, 1066);
const price = product.actualPriceRange?.minValue?.formattedAmount;
const description = product.plainDescription?.replace(/<[^>]*>/g, "").trim();
---

<Layout title={product.name ?? "Product"}>
  <main>
    <div>
      <a href="/products">
        &larr; Back to products
      </a>
      <div>
        <div>
          {imageUrl && (
            <img
              src={imageUrl}
              alt={product.name ?? "Product"}
            />
          )}
        </div>
        <div>
          <h1>{product.name}</h1>
          {price && <p>{price}</p>}
          {description && (
            <p>{description}</p>
          )}
          <ProductPurchase
            client:load
            productId={product._id!}
            options={product.options ?? []}
            variantsInfo={product.variantsInfo ?? { variants: [] }}
          />
        </div>
      </div>
    </div>
  </main>
</Layout>
```

### 4. Add to Cart Button (`src/components/AddToCartButton.tsx`)

Uses `@wix/ecom` for cart operations. The `catalogReference.appId` is the Wix Stores appDefId constant.

> **IMPORTANT:** `catalogReference.options.variantId` is **always required** — even for products with a single default variant. Without it, `addToCurrentCart` returns 200 OK but silently adds nothing to the cart. The `ProductPurchase` component resolves the correct `variantId` and passes it here.

```tsx
import { useState } from "react";
import { currentCart } from "@wix/ecom";

const WIX_STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

interface AddToCartButtonProps {
  productId: string;
  variantId?: string;
  disabled?: boolean;
}

export default function AddToCartButton({ productId, variantId, disabled }: AddToCartButtonProps) {
  const [status, setStatus] = useState<"idle" | "adding" | "added">("idle");

  const handleAddToCart = async () => {
    setStatus("adding");
    try {
      await currentCart.addToCurrentCart({
        lineItems: [
          {
            catalogReference: {
              appId: WIX_STORES_APP_ID,
              catalogItemId: productId,
              options: variantId ? { variantId } : undefined,
            },
            quantity: 1,
          },
        ],
      });
      setStatus("added");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("idle");
    }
  };

  return (
    <button
      onClick={handleAddToCart}
      disabled={disabled || status === "adding"}
      className="add-to-cart-btn"
    >
      {disabled
        ? "Select Options"
        : status === "adding"
          ? "Adding..."
          : status === "added"
            ? "Added! View Cart →"
            : "Add to Cart"}
    </button>
  );
}
```

> **Styling note:** Uses `.add-to-cart-btn` from the designed component's `<style is:global>` block. See the design skill's `COMPONENT_PATTERNS.md` → Product Purchase Area.

### 4b. Product Purchase — Option Selection + Variant Resolution (`src/components/ProductPurchase.tsx`)

Handles variant selection and wraps `AddToCartButton`. For products without options, renders the button directly with the default variant ID. For products with options, renders pill-button selectors and resolves the matching `variantId`.

```tsx
import { useState, useMemo } from "react";
import AddToCartButton from "./AddToCartButton";

interface Choice {
  choiceId?: string | null;
  name?: string | null;
}

interface Option {
  _id?: string | null;
  name?: string | null;
  choicesSettings?: {
    choices?: Choice[];
  };
}

interface VariantChoice {
  optionChoiceIds?: {
    optionId?: string;
    choiceId?: string;
  };
}

interface Variant {
  _id?: string | null;
  choices?: VariantChoice[];
  price?: {
    actual?: {
      formattedAmount?: string;
    };
  };
}

interface ProductPurchaseProps {
  productId: string;
  options: Option[];
  variantsInfo: { variants?: Variant[] };
}

export default function ProductPurchase({
  productId,
  options,
  variantsInfo,
}: ProductPurchaseProps) {
  const variants = variantsInfo.variants ?? [];
  const hasOptions = options.length > 0;

  const [selections, setSelections] = useState<Record<string, string>>({});

  const handleSelect = (optionId: string, choiceId: string) => {
    setSelections((prev) => ({ ...prev, [optionId]: choiceId }));
  };

  const allSelected = hasOptions && options.every((opt) => opt._id && selections[opt._id]);

  const resolvedVariant = useMemo(() => {
    if (!hasOptions) return variants[0] ?? null;
    if (!allSelected) return null;
    return (
      variants.find((v) =>
        (v.choices ?? []).every(
          (c) =>
            c.optionChoiceIds?.optionId &&
            selections[c.optionChoiceIds.optionId] === c.optionChoiceIds.choiceId
        )
      ) ?? null
    );
  }, [hasOptions, allSelected, selections, variants]);

  // No options — render button directly with default variant
  if (!hasOptions) {
    return (
      <AddToCartButton
        productId={productId}
        variantId={variants[0]?._id ?? undefined}
      />
    );
  }

  // Has options — render selectors + button
  return (
    <div className="purchase-area">
      {options.map((option) => {
        const choices = option.choicesSettings?.choices ?? [];
        const optionId = option._id ?? "";
        return (
          <div key={optionId} className="option-group">
            <div className="option-label">
              {option.name}
            </div>
            <div className="option-choices">
              {choices.map((choice) => {
                const choiceId = choice.choiceId ?? "";
                const isSelected = selections[optionId] === choiceId;
                return (
                  <button
                    key={choiceId}
                    onClick={() => handleSelect(optionId, choiceId)}
                    className={`option-pill${isSelected ? " selected" : ""}`}
                  >
                    {choice.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <AddToCartButton
        productId={productId}
        variantId={resolvedVariant?._id ?? undefined}
        disabled={!resolvedVariant}
      />
    </div>
  );
}
```

> **Styling note:** Uses `.purchase-area`, `.option-group`, `.option-label`, `.option-choices`, `.option-pill`, `.option-pill.selected` from the designed component's `<style is:global>` block. See the design skill's `COMPONENT_PATTERNS.md` → Product Purchase Area.

### 5. Cart Page (`src/pages/cart.astro`)

```astro
---
import Layout from "../layouts/Layout.astro";
import CartView from "../components/CartView.tsx";
import { currentCart } from "@wix/ecom";

// Fetch cart server-side so CartView renders with real data immediately (no loading flicker)
let initialCart = null;
try {
  const cart = await currentCart.getCurrentCart();
  initialCart = {
    items: (cart.lineItems ?? []).map((item: any) => ({
      _id: item._id,
      productName: item.productName,
      quantity: item.quantity,
      price: item.price,
      image: item.image,
      catalogReference: item.catalogReference,
    })),
    subtotal: cart.subtotal?.formattedConvertedAmount ?? "",
  };
} catch {
  // No cart yet (new visitor) — CartView will show empty state
}
---

<Layout title="Cart">
  <main>
    <div>
      <h1>Your Cart</h1>
      <CartView initialCart={initialCart} client:load />
    </div>
  </main>
</Layout>
```

### 6. Cart View + Checkout (`src/components/CartView.tsx`)

This component displays cart items and handles the two-step checkout redirect:
1. Create a checkout from the current cart (`@wix/ecom`)
2. Create a redirect session URL to Wix-hosted checkout (`@wix/redirects`)

```tsx
import { useState, useEffect } from "react";
import { currentCart } from "@wix/ecom";
import { redirects } from "@wix/redirects";

interface LineItem {
  _id?: string;
  productName?: { translated?: string };
  quantity?: number;
  price?: { formattedConvertedAmount?: string };
  image?: { url?: string };
}

interface InitialCartData {
  items: LineItem[];
  subtotal: string;
}

interface CartViewProps {
  initialCart?: InitialCartData | null;
}

export default function CartView({ initialCart }: CartViewProps) {
  const [items, setItems] = useState<LineItem[]>(initialCart?.items ?? []);
  const [subtotal, setSubtotal] = useState(initialCart?.subtotal ?? "");
  const [loading, setLoading] = useState(!initialCart);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    // Skip initial fetch if server-side cart data was provided
    if (!initialCart) {
      loadCart();
    }
  }, []);

  const loadCart = async () => {
    try {
      const cart = await currentCart.getCurrentCart();
      setItems((cart.lineItems as LineItem[]) ?? []);
      setSubtotal(cart.subtotal?.formattedConvertedAmount ?? "");
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    await currentCart.removeLineItemsFromCurrentCart([itemId]);
    await loadCart();
  };

  const handleCheckout = async () => {
    setCheckingOut(true);
    try {
      // Step 1: Create checkout from cart
      const { checkoutId } = await currentCart.createCheckoutFromCurrentCart({
        channelType: currentCart.ChannelType.WEB,
      });

      // Step 2: Create redirect session to Wix-hosted checkout
      const { redirectSession } = await redirects.createRedirectSession({
        ecomCheckout: { checkoutId },
        callbacks: {
          postFlowUrl: window.location.origin,
          thankYouPageUrl: `${window.location.origin}/thank-you`,
        },
      });

      // Step 3: Redirect to checkout
      if (redirectSession?.fullUrl) {
        window.location.href = redirectSession.fullUrl;
      }
    } catch {
      setCheckingOut(false);
    }
  };

  if (loading) {
    return <p className="cart-empty">Loading cart...</p>;
  }

  if (items.length === 0) {
    return (
      <div className="cart-empty">
        <p>Your cart is empty.</p>
        <a
          href="/products"
          className="checkout-btn"
        >
          Browse Products
        </a>
      </div>
    );
  }

  return (
    <div>
      <div className="cart-items">
        {items.map((item) => (
          <div key={item._id} className="cart-item">
            {item.image?.url && (
              <img
                src={item.image.url}
                alt={item.productName?.translated ?? ""}
                className="cart-item-image"
              />
            )}
            <div className="cart-item-info">
              <h3>{item.productName?.translated}</h3>
              <p className="cart-item-quantity">Qty: {item.quantity}</p>
            </div>
            <p>{item.price?.formattedConvertedAmount}</p>
            <button
              onClick={() => item._id && handleRemoveItem(item._id)}
              className="cart-item-remove"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="cart-subtotal">
        <div>
          <span>Subtotal</span>
          <span>{subtotal}</span>
        </div>
        <button
          onClick={handleCheckout}
          disabled={checkingOut}
          className="checkout-btn"
        >
          {checkingOut ? "Redirecting to checkout..." : "Proceed to Checkout"}
        </button>
      </div>
    </div>
  );
}
```

> **Styling note:** Uses `.cart-items`, `.cart-item`, `.cart-item-image`, `.cart-item-info`, `.cart-item-quantity`, `.cart-item-remove`, `.cart-subtotal`, `.checkout-btn`, `.cart-empty` from the designed component's `<style is:global>` block. See the design skill's `COMPONENT_PATTERNS.md` → Cart View.

### 7. Thank You Page (`src/pages/thank-you.astro`)

Wix redirects here after successful checkout with `?orderId=<id>` in the URL.

```astro
---
import Layout from "../layouts/Layout.astro";

const orderId = Astro.url.searchParams.get("orderId");
---

<Layout title="Thank You">
  <main>
    <div>
      <h1>Thank You!</h1>
      <p>Your order has been placed successfully.</p>
      {orderId && (
        <p>Order ID: {orderId}</p>
      )}
      <a
        href="/products"
      >
        Continue Shopping
      </a>
    </div>
  </main>
</Layout>
```

## Checkout Flow Summary

> **IMPORTANT — Tell the user after building the e-commerce flow:**
> Checkout is hosted by Wix. It will show **"we aren't accepting payments"** until the user completes two steps in the Wix dashboard:
> 1. **Upgrade to a premium plan** with eCommerce (Dashboard > Upgrade / Pricing)
> 2. **Connect a payment provider** — Stripe, PayPal, etc. (Dashboard > Settings > Accept Payments)
>
> These can be done now or before going live. Full checklist: `wix-headless-cli/references/GOING_LIVE.md`.

```
Product page → Add to Cart (@wix/ecom currentCart.addToCurrentCart)
    → Cart page → View items (@wix/ecom currentCart.getCurrentCart)
    → "Proceed to Checkout" → Create checkout (@wix/ecom currentCart.createCheckoutFromCurrentCart)
    → Create redirect URL (@wix/redirects redirects.createRedirectSession)
    → Redirect to Wix-hosted checkout page
    → User completes payment on Wix
    → Redirect back to /thank-you?orderId=<id>
```

**Key constants:**
- `catalogReference.appId` must be `215238eb-22a5-4c36-9e7b-e7c08025e04e` (the Wix Stores appDefId). This tells the ecom system which catalog the product belongs to.
- `catalogReference.options.variantId` is **always required** — even for single-variant products. Without it, `addToCurrentCart` returns 200 OK but silently adds nothing.

## Cart Enhancements

The base flow above gives you a working cart but with two gaps:
- The header "Cart" link is static — no live item count when products are added
- Cart items are rendered as-is with no check for removed or out-of-stock products

See `references/CART_STATE.md` for the add-on recipe: live cart badge + unavailable item warnings.

## Default Products

Wix Stores comes with 12 sample products pre-installed. These appear automatically via the SDK queries — no manual product creation is needed.

If the MCP setup section above was executed, the 12 defaults have been replaced with 3 on-brand products matching the user's business. The SDK queries work identically — the code doesn't need to change either way.

To customize products later, use the Wix Dashboard → Store → Products.

## Testing

1. Verify the Stores app is installed (12 default products, or 3 on-brand products if MCP setup was run)
2. Run `npx @wix/cli dev`
3. Navigate to `/products` — should show the product list
4. Click a product — should navigate to `/products/[slug]`
5. **Product with variants:** confirm option pill buttons render, selecting all options enables "Add to Cart", item appears in cart after adding
6. **Product without variants:** confirm no option selectors shown, "Add to Cart" works immediately
7. Check the network request to verify `catalogReference.options.variantId` is included in the add-to-cart payload
8. Navigate to `/cart` — should show cart with items and subtotal
9. Click "Proceed to Checkout" — should redirect to Wix-hosted checkout
> **Note:** Steps 9-10 require a Wix premium plan and configured payment methods. See `wix-headless-cli/references/GOING_LIVE.md`.
10. Complete test purchase — should redirect back to `/thank-you?orderId=...`
