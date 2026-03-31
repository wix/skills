# Recipe: Cart State — Live Badge + Unavailable Item Warnings

Enhances the base ecommerce flow (`PRODUCT_CATALOG.md`) with two missing behaviors:

1. **Cart badge** — a live item count in the header that updates instantly when items are added
2. **Unavailable item warnings** — detect and flag cart items whose products no longer exist or are out of stock

> These are add-ons to the base ecommerce recipe. Build the product catalog, cart, and checkout first (`references/PRODUCT_CATALOG.md`), then layer these on top.

## Prerequisites

- Base ecommerce flow already built (product listing, cart page, checkout)
- Packages already installed: `@wix/stores @wix/ecom @wix/redirects`

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/CartBadge.tsx` | **Create** | React island — live cart item count in header |
| `src/components/AddToCartButton.tsx` | **Modify** | Dispatch `cart-updated` event after successful add (already has `variantId` support from base recipe) |
| `src/components/CartView.tsx` | **Modify** | Detect unavailable items, dispatch `cart-updated` after remove |
| Header component (e.g. `Header.astro`) | **Modify** | Replace static "Cart" link with `CartBadge` island |

## Cross-Component Communication Pattern

Astro islands are isolated React trees — they cannot share React context or state. Use a browser `CustomEvent` to communicate cart changes between islands:

```
AddToCartButton → dispatches "cart-updated" on window (with cart in detail)
CartView        → dispatches "cart-updated" on window (with cart in detail, after remove)
CartBadge       → listens for "cart-updated", reads count from event detail (falls back to API)
```

This avoids adding a state management library and works with Astro's island architecture.

## Implementation

### 1. Cart Badge (`src/components/CartBadge.tsx`)

A small React island that fetches the cart item count on mount and listens for `cart-updated` events.

```tsx
import { useState, useEffect } from "react";
import { currentCart } from "@wix/ecom";

interface CartBadgeProps {
  initialCount?: number;
}

export default function CartBadge({ initialCount }: CartBadgeProps) {
  const [count, setCount] = useState(initialCount ?? 0);

  const fetchCount = async () => {
    try {
      const cart = await currentCart.getCurrentCart();
      const total = (cart.lineItems ?? []).reduce(
        (sum, item) => sum + (item.quantity ?? 0),
        0
      );
      setCount(total);
    } catch {
      setCount(0);
    }
  };

  useEffect(() => {
    // Only fetch on mount if no server-side count was provided
    if (initialCount === undefined) {
      fetchCount();
    }

    const handleCartUpdate = (e: Event) => {
      const cart = (e as CustomEvent).detail?.cart;
      if (cart?.lineItems) {
        const total = (cart.lineItems as any[]).reduce(
          (sum: number, item: any) => sum + (item.quantity ?? 0),
          0
        );
        setCount(total);
      } else {
        fetchCount();
      }
    };
    window.addEventListener("cart-updated", handleCartUpdate);
    return () => window.removeEventListener("cart-updated", handleCartUpdate);
  }, []);

  return (
    <a href="/cart" className="cart-badge">
      Cart
      {count > 0 && (
        <span className="cart-badge-count">
          {count}
        </span>
      )}
    </a>
  );
}
```

> **Styling note:** Uses `.cart-badge` and `.cart-badge-count` from the designed component's `<style is:global>` block. See the design skill's `COMPONENT_PATTERNS.md` → Cart Badge.

### 2. Update AddToCartButton — Dispatch Event

After a successful `addToCurrentCart` call, dispatch a `cart-updated` event so the badge updates instantly without a separate API call.

Destructure the `cart` from the response and pass it in the event detail:

```tsx
// After the addToCurrentCart await succeeds:
const { cart } = await currentCart.addToCurrentCart({ ... });
window.dispatchEvent(new CustomEvent("cart-updated", { detail: { cart } }));
```

Full updated handler (note: `variantId` is already a prop from the base recipe):

```tsx
const handleAddToCart = async () => {
  setStatus("adding");
  try {
    const { cart } = await currentCart.addToCurrentCart({
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
    window.dispatchEvent(new CustomEvent("cart-updated", { detail: { cart } }));
    setStatus("added");
    setTimeout(() => setStatus("idle"), 2000);
  } catch {
    setStatus("idle");
  }
};
```

### 3. Update Header — Mount CartBadge Island

Replace the static cart link in the header with the `CartBadge` React island.

**Before:**

```astro
<a href="/cart" class="...">Cart</a>
```

**After:**

```astro
---
import CartBadge from "./CartBadge.tsx";
import { currentCart } from "@wix/ecom";

// Fetch cart count server-side so the badge renders with the correct number
// immediately — no 0→N flicker on page load
let cartItemCount = 0;
try {
  const cart = await currentCart.getCurrentCart();
  cartItemCount = (cart.lineItems ?? []).reduce(
    (sum, item) => sum + (item.quantity ?? 0),
    0
  );
} catch {
  // No cart yet (new visitor) — default to 0
}
---

<!-- Replace the static cart link with: -->
<CartBadge initialCount={cartItemCount} client:load />
```

The `client:load` directive hydrates the badge immediately. Because `initialCount` is provided from the server, the badge renders the correct count on first paint with no flicker. The client-side `fetchCount()` is skipped when `initialCount` is present — the event listener still handles real-time updates from `cart-updated` events.

### 4. Unavailable Item Detection in CartView

Cart items can become unavailable when products are deleted, hidden, or go out of stock. The base `CartView` renders whatever the cart API returns with no validation.

Add a catalog cross-reference after fetching the cart to detect unavailable items.

**Add import:**

```tsx
import { productsV3 } from "@wix/stores";
```

**Add state for unavailable item IDs:**

```tsx
const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());
```

**Update `loadCart` to cross-reference the catalog:**

```tsx
const loadCart = async () => {
  let lineItems: LineItem[] = [];
  try {
    const cart = await currentCart.getCurrentCart();
    lineItems = (cart.lineItems as LineItem[]) ?? [];
    setItems(lineItems);
    setSubtotal(cart.subtotal?.formattedConvertedAmount ?? "");
  } catch {
    setItems([]);
    setLoading(false);
    return;
  }

  try {
    // Cross-reference cart items against the product catalog
    const catalogItemIds = lineItems
      .map((item) => (item as any).catalogReference?.catalogItemId)
      .filter(Boolean) as string[];

    if (catalogItemIds.length > 0) {
      const { items: catalogProducts } = await productsV3
        .queryProducts({})
        .in("_id", catalogItemIds)
        .limit(catalogItemIds.length)
        .find();

      const foundIds = new Set(
        (catalogProducts ?? []).map((p) => p._id).filter(Boolean)
      );
      const missing = new Set(
        catalogItemIds.filter((id) => !foundIds.has(id))
      );
      setUnavailableIds(missing);
    }
  } catch {
    // Product availability check failed — cart items still show
  } finally {
    setLoading(false);
  }
};
```

**Render unavailable item warnings:**

Check each item against the unavailable set when rendering:

```tsx
const getCatalogItemId = (item: LineItem) =>
  (item as any).catalogReference?.catalogItemId as string | undefined;

// Inside the items.map() render:
const itemCatalogId = getCatalogItemId(item);
const isUnavailable = itemCatalogId ? unavailableIds.has(itemCatalogId) : false;
```

Add a visual indicator for unavailable items — for example, a warning label and reduced opacity:

```tsx
<div key={item._id} className={isUnavailable ? "cart-item unavailable" : "cart-item"}>
  {/* ...existing item content... */}
  {isUnavailable && (
    <p className="cart-item-unavailable">
      This item is no longer available
    </p>
  )}
</div>
```

**Block checkout when unavailable items exist:**

```tsx
const hasUnavailable = unavailableIds.size > 0;

{/* Above the checkout button, show a warning: */}
{hasUnavailable && (
  <p className="cart-item-unavailable">
    Remove unavailable items before checking out.
  </p>
)}

{/* Disable checkout button: */}
<button
  onClick={handleCheckout}
  disabled={checkingOut || hasUnavailable}
>
  {checkingOut ? "Redirecting to Checkout..." : "Proceed to Checkout"}
</button>
```

### 5. Dispatch cart-updated from CartView

After removing an item, dispatch the event so the header badge updates:

```tsx
const handleRemoveItem = async (itemId: string) => {
  const { cart } = await currentCart.removeLineItemsFromCurrentCart([itemId]);
  window.dispatchEvent(new CustomEvent("cart-updated", { detail: { cart } }));
  await loadCart();
};
```

## Anti-Patterns

| WRONG | CORRECT |
|-------|---------|
| Share cart state via React context across islands | Use `CustomEvent` on `window` — Astro islands are isolated React trees |
| Add a state management library (Redux, Zustand) for the badge | Browser events are sufficient — no library needed |
| Fetch cart only client-side, causing count to flicker 0→N on every page load | Fetch cart count server-side in Navigation frontmatter and pass as `initialCount` prop |
| Assume all cart items are valid and purchasable | Cross-reference against `productsV3.queryProducts()` to detect removed/hidden products |
| Show "0" badge permanently when cart is empty | Hide the count entirely when zero — only show it when items exist |
| Check availability using the V1 `products` export | Always use `productsV3` — V1 silently returns 0 results on V3 catalogs |

## Testing

1. Run `npx @wix/cli dev`
2. Navigate to `/products` and click into a product
3. Click "Add to Cart" — the header badge should update to show "(1)"
4. Add another item — badge should increment
5. Navigate to `/cart` — should show all items
6. Remove an item — badge should decrement
7. Verify badge shows the correct count immediately on page load — no 0→N flash (the count should be present in the server-rendered HTML)
8. To test unavailable items: add items to cart, then hide/delete a product in the Wix Dashboard > Store > Products. Reload `/cart` — the removed product should show the "no longer available" warning and checkout should be blocked until it's removed from the cart
