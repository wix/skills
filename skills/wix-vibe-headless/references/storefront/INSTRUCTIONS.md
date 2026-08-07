
# Wix Storefront Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and both storefront helpers from `references/storefront/`. All helpers import from `"./wix-client.js"`, so copy them into the same folder (e.g. `src/rest/`). Copy **both** for a full storefront:
>
> | File | What it covers |
> |---|---|
> | `wix-store-catalog.js` | Products, categories, product detail, search |
> | `wix-store-cart.js` | Add to cart, cart management, checkout |

Builds a real, client-only Wix storefront. The browser talks to Wix directly over a
public `WIX_CLIENT_ID`. Never mock products; never hand-build `/checkout` URLs — always
go through the eCom cart + redirect-session.

## When to use
- User wants a Wix eCommerce store or asks to "connect Wix".
- Replacing placeholder/mock products with live Wix data.
- Adding cart, checkout, categories, or product detail pages over an existing Wix Stores catalog.

## Prerequisites
1. A Wix site with **Wix Stores installed and products already added** (this skill does
   NOT provision — it's read-only over the catalog).
2. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (the
   Wix Business Manager surfaces a copyable prompt with the id filled in — see
   the router `SKILL.md`). Paste it into `src/rest/wix-client.js` in place of the placeholder. It is a
   buyer-facing credential (it only mints anonymous visitor tokens), **not** a secret, so
   hardcoding/committing it is fine.
3. The deployed app domain must be allow-listed on the OAuth client for Wix-hosted
   checkout to return. This is a **separate Wix setup flow the user completes later** —
   out of this skill's scope. If checkout return fails before that setup is done, that's
   expected; flag it and continue.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the storefront's UI
however the project wants; wire it to these two snippets. Copy them into the app (e.g.
`src/api/`) and only adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID` to
  the id from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The visitor refresh
  token IS the cart identity; it is persisted to localStorage. Do not re-mint anonymously
  per load or the cart silently empties.
- `src/rest/wix-store-catalog.js` — **Catalog:**
  `queryProducts`, `queryProductsByCategory`, `getProductBySlug`, `countProducts`,
  `queryCategories`, `getCategoryBySlug`
- `src/rest/wix-store-cart.js` — **Cart & checkout:**
  `addToCart`, `getCurrentCart`, `updateCartItemQuantity`, `removeFromCart`, `checkout`

Every field shape and gotcha you need is in this file (the prose below + the **Reference
components** section), and those components show correct usage of every helper — `import` from
`wix-client.js` / `wix-store-*.js`, adapt the components' logic, and restyle to the brand.

## How to wire it (UI is the project's choice)
- **Product grid** — `queryProducts()` for the listing (visible products only); pass
  `nextCursor` back as `cursor` to load the next page. Render most fields directly from the Wix
  product object (see the `Product` typedef in `wix-store-catalog.js` for key fields) — the one
  exception is `plainDescription`, which is HTML (see PDP below). For price, use
  `actualPriceRange.minValue.formattedAmount` (already includes the currency symbol) — no
  manual formatting needed.
- **PDP** — `getProductBySlug(slug)` keyed off the URL slug; returns null on miss — show
  a not-found state, never invent a product. **Drive the whole PDP from the returned product
  object at runtime — build it generically, not around the one product you happened to inspect.**
  A catalog is heterogeneous: some products have `options`, some have `modifiers` (mandatory or
  optional), some track inventory, some none of these. Render a selector for **every** entry the
  product actually carries: one control per `product.options` (variant choices) **and** one per
  `product.modifiers` (TEXT_CHOICES → choice buttons/select; FREE_TEXT → a text input); render
  neither when the arrays are empty. Skipping modifiers is a common miss — a product with a
  **mandatory** modifier (e.g. "gift wrap?") whose control isn't rendered can never be added: the
  buyer can't satisfy the requirement, so `add-to-cart` returns 200 with an **empty** `lineItems`
  and the add silently no-ops.
  Render `product.plainDescription` as **HTML** — despite the name it contains markup (`<p>`,
  `<br>`, `<strong>`), so `dangerouslySetInnerHTML={{ __html: product.plainDescription }}` (React)
  or `el.innerHTML = product.plainDescription`, never as a plain text node (that shows raw `<p>`
  tags). Strip tags only for plain-text contexts (SEO/meta description, a truncated card teaser).
- **Gate the Add-to-cart button** — disable it only until the requirements the product *actually
  has* are met, computed from the product object (never assume every product has options or
  modifiers): if `product.options` is non-empty, a variant must resolve from the selections; every
  `modifier.mandatory === true` must have a value. A product with no options and no mandatory
  modifiers is immediately addable — don't leave the button stuck. Optional modifiers never block.
  Then pass the selections to `addToCart` (see Cart below); never call it with a required selection missing.
- **Reflect stock in the UI** — the product object already carries availability at three levels; surface
  it rather than letting the buyer discover it only on click. Read it from the data at runtime (never
  hardcode):
  - **Grid / card:** `product.inventory.availabilityStatus` (`IN_STOCK` / `OUT_OF_STOCK` /
    `PARTIALLY_OUT_OF_STOCK`) — badge an out-of-stock product as sold out.
  - **Option choice:** `product.options[].choicesSettings.choices[].inStock` — disable/strike a choice
    (e.g. size L) that has no in-stock variant, before a full variant is even resolved.
  - **Variant:** `variantsInfo.variants[].inventoryStatus.inStock` — once selections resolve to a
    variant, disable Add-to-cart (label "Out of stock") when that variant is `inStock: false`.
  A product/variant with inventory tracking **off** reports `availabilityStatus: IN_STOCK` /
  `inStock: true` and stays freely addable — tracking-off is not "no data", it's "always available".
  `addToCart` still throws on a sold-out line as a backstop, but the UI should prevent reaching it.
- **Categories** — `queryCategories()` for a category menu; `getCategoryBySlug(slug)` for
  a category landing page. Pass `category.id` to `queryProductsByCategory(categoryId, { limit?, cursor? })`
  to list only the products in that category; paginate exactly like `queryProducts`.
  `queryCategories()` includes Wix's auto-created **"All Products" system category** (`slug:
  "all-products"`) — it mirrors the full catalog, so drop it from the category menu
  (`categories.filter(c => c.slug !== "all-products")`). Filter by that slug, not by name (renames/
  localizes) or `visible` (it's `visible: true` like any other).
- **Cart** — `addToCart(catalogItemId, variantId?, qty?, { modifierChoices?, customTextFields? }?)`,
  `updateCartItemQuantity(lineItemId, qty)`, `removeFromCart(lineItemId)`.
  - `variantId` (`variantsInfo.variants[].id` from `getProductBySlug`) — required for products with
    options; resolve it by matching the buyer's selections to `variant.choices[].optionChoiceIds`.
  - `modifierChoices` — `{ [modifier.key]: choiceKey }` for `TEXT_CHOICES` modifiers.
  - `customTextFields` — `{ [modifier.freeTextSettings.key]: userInput }` for `FREE_TEXT` modifiers.
    Mandatory modifiers must be included. See the eCommerce integration guide:
    https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/e-commerce-integration.md
  - Use `cart.lineItems[].id` as `lineItemId` (not `catalogItemId`) for mutations.
  - Read the cart back with `getCurrentCart()` rather than mirroring it locally.
- **Checkout** — `window.location.href = await checkout()`. After the buyer returns from
  hosted checkout the order is placed and the cart is empty — re-fetch with
  `getCurrentCart()` on return (e.g. on mount + `visibilitychange`) to clear the UI.
- **Empty state** — if `countProducts()` is 0, show an empty state telling the user to
  add products in their Wix dashboard. Never invent products.

## Hard rules (do not violate)
- ✅ Checkout ONLY via `checkout()` (`create-checkout` → `/headless/v1/redirect-session`
  `fullUrl`), then redirect.
- ❌ Never hand-build `/checkout`, cart-add, or product permalinks for purchase.
- ❌ Never mock products — render live Wix data or the empty state.
- ❌ Never generate fake reviews, ratings, or testimonials. Empty review UI only.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ `lineItemId` for cart mutations is `cart.lineItems[].id`, not `catalogItemId`.
- ✅ On the PDP, render a control for **every** `product.options` entry **and** every `product.modifiers`
  entry — never only variants. Keep Add-to-cart disabled until a variant resolves and every
  `modifier.mandatory === true` has a value; a mandatory modifier with no rendered control makes the
  product unbuyable (add-to-cart returns 200 with empty `lineItems`).
- ✅ Pass `addToCart`'s `variantId` (`variantsInfo.variants[].id`) for products with variants; omit for products without.
- ✅ Pass `modifierChoices` (`{ [modifier.key]: choiceKey }`) for TEXT_CHOICES modifiers; pass `customTextFields`
  (`{ [modifier.freeTextSettings.key]: userInput }`) for FREE_TEXT modifiers. Include mandatory modifiers.
- The engine fails loudly on purpose: `addToCart`/`checkout` throw on out-of-stock or
  empty carts. A green path means it is really buyable — don't swallow these.

## Beyond the snippets
The snippets cover the common storefront paths. If you hit a use case they don't cover
(e.g. coupons, members/auth, a product field not shown in the typedef), make the call
yourself with `wixApiRequest` — but look up the exact endpoint, HTTP method, and request
body in the **official Wix API reference** first; never guess:
- Official Wix API reference: https://dev.wix.com/docs/api-reference.md
- eCommerce integration guide (modifiers, custom text, variants): https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/e-commerce-integration.md
- Member login + a "my orders" account view → the **members** vertical (`references/members/INSTRUCTIONS.md`): custom login on your own UI so buyers can sign in and see their account.

Keep the snippets as the default for everything they already do; reach for the API
reference only for the gap.

## Reference components (headless — adapt the logic, restyle freely)

These are the recurring storefront pieces, written **headless**: the data wiring (Wix field
paths, variant resolution, modifier handling, stock gating, cart) is correct and complete — the
markup is deliberately plain. **Copy the logic exactly; restyle the JSX to the brand.** Don't
re-derive the data shape from scratch (that's where the bugs are — the variant/modifier/stock
paths especially). They consume the `src/rest/` helpers; you don't need to read those helpers'
source.

**`src/context/CartContext.jsx`** — cart state, mirroring the Wix **server** cart (never a
local copy). Wrap the app in `<CartProvider>`; everything reads `useCart()`.

```jsx
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getCurrentCart, addToCart as apiAdd, removeFromCart as apiRemove,
         updateCartItemQuantity as apiQty, checkout as apiCheckout } from "@/rest/wix-store-cart";

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const refreshCart = useCallback(async () => setCart(await getCurrentCart()), []);
  useEffect(() => {                                   // load once + re-sync when tab regains focus
    refreshCart();
    const onVisible = () => document.visibilityState === "visible" && refreshCart();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshCart]);

  const itemCount = (cart?.lineItems ?? []).reduce((n, li) => n + (li.quantity || 0), 0);
  const addToCart = async (id, variantId, qty = 1, extras) => {
    setLoading(true);
    try { setCart(await apiAdd(id, variantId, qty, extras)); setIsOpen(true); } finally { setLoading(false); }
  };
  const removeItem = async (lineItemId) => { setLoading(true); try { setCart(await apiRemove(lineItemId)); } finally { setLoading(false); } };
  const updateQuantity = async (lineItemId, qty) => { setLoading(true); try { setCart(await apiQty(lineItemId, qty)); } finally { setLoading(false); } };
  const checkout = async () => { setLoading(true); try { window.location.href = await apiCheckout(); } finally { setLoading(false); } };

  return (
    <CartContext.Provider value={{ cart, itemCount, isOpen, setIsOpen, loading, addToCart, removeItem, updateQuantity, checkout, refreshCart }}>
      {children}
    </CartContext.Provider>
  );
}
export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
```

**`ProductCard.jsx`** — grid tile. Note the `//`-protocol fix on the image URL and the exact
price / out-of-stock field paths.

```jsx
import { Link } from "react-router-dom";

function productImage(product) {
  const url = product?.media?.main?.image?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

export default function ProductCard({ product }) {
  const image = productImage(product);
  const price = product?.actualPriceRange?.minValue?.formattedAmount;           // includes currency symbol
  const compareAt = product?.compareAtPriceRange?.minValue?.formattedAmount;    // present only when on sale
  const soldOut = product?.inventory?.availabilityStatus === "OUT_OF_STOCK";
  return (
    <Link to={`/product/${product.slug}`} /* restyle */>
      {image ? <img src={image} alt={product.name} loading="lazy" /> : <div>{/* placeholder */}</div>}
      {soldOut && <span>Sold out</span>}
      <h3>{product.name}</h3>
      <span>{price}</span>
      {compareAt && compareAt !== price && <span style={{ textDecoration: "line-through" }}>{compareAt}</span>}
    </Link>
  );
}
```

**`CartDrawer.jsx`** — reads everything from `useCart()`; mutate by `lineItem.id` (not
`catalogItemId`), check out via the context.

```jsx
import { useCart } from "@/context/CartContext";

export default function CartDrawer() {
  const { cart, isOpen, setIsOpen, removeItem, updateQuantity, checkout, loading } = useCart();
  const lineItems = cart?.lineItems ?? [];
  if (!isOpen) return null;
  return (
    <div /* restyle: slide-over panel */>
      <button onClick={() => setIsOpen(false)}>Close</button>
      {lineItems.length === 0 ? <p>Your cart is empty.</p> : (
        <>
          {lineItems.map((item) => (
            <div key={item.id}>
              <img src={item.image?.url} alt={item.productName?.original} />   {/* cart image is an object: item.image.url (NOT a bare string — don't apply the ProductCard //-fix to it) */}
              <span>{item.productName?.original}</span>
              {item.descriptionLines?.map((dl, i) => (               // variant/modifier summary Wix supplies
                <small key={i}>{dl.name?.original}: {dl.plainText?.original || dl.colorInfo?.original}</small>
              ))}
              <button onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}>−</button>
              <span>{item.quantity}</span>
              <button onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</button>
              <button onClick={() => removeItem(item.id)}>Remove</button>
              <span>{item.price?.formattedAmount}</span>
            </div>
          ))}
          <button disabled={loading} onClick={checkout}>Checkout</button>
        </>
      )}
    </div>
  );
}
```

**`pages/ProductDetail.jsx`** — the PDP. This carries the trickiest logic: resolving the
buyer's option selections to a variant, gating add-to-cart on mandatory modifiers + stock, and
rendering the HTML description. Keep all of it.

```jsx
import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { getProductBySlug } from "@/rest/wix-store-catalog";
import { useCart } from "@/context/CartContext";

// one control per product.options[] (variant choices)
function OptionSelector({ option, selected, onSelect }) {
  return (
    <div>
      <label>{option.name}</label>
      {option.choicesSettings?.choices?.map((c) => (
        <button key={c.choiceId} disabled={c.inStock === false}      // choice with no in-stock variant
          aria-pressed={selected === c.choiceId} onClick={() => onSelect(option.id, c.choiceId)}>{c.name}</button>
      ))}
    </div>
  );
}
// one control per product.modifiers[] — TEXT_CHOICES → buttons, FREE_TEXT → input
function ModifierSelector({ modifier, value, onChange }) {
  const key = modifier.modifierRenderType === "FREE_TEXT" ? modifier.freeTextSettings?.key : modifier.key;
  if (modifier.modifierRenderType === "FREE_TEXT")
    return <label>{modifier.name}{modifier.mandatory && " *"}<input value={value || ""} onChange={(e) => onChange(key, e.target.value)} /></label>;
  return (
    <div>
      <label>{modifier.name}{modifier.mandatory && " *"}</label>
      {modifier.choicesSettings?.choices?.map((c) => (
        <button key={c.key} aria-pressed={value === c.key} onClick={() => onChange(key, c.key)}>{c.name}</button>
      ))}
    </div>
  );
}

export default function ProductDetail() {
  const { slug } = useParams();
  const { addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [modifierValues, setModifierValues] = useState({});
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    getProductBySlug(slug).then((p) => {
      if (!p) return setNotFound(true);
      setProduct(p);
      const initial = {};                                            // pre-select first in-stock choice per option
      (p.options || []).forEach((o) => {
        const first = o.choicesSettings?.choices?.find((c) => c.inStock !== false);
        if (first) initial[o.id] = first.choiceId;
      });
      setSelectedOptions(initial);
    });
  }, [slug]);

  const options = product?.options || [];
  const modifiers = product?.modifiers || [];
  const variants = product?.variantsInfo?.variants || [];

  const variant = useMemo(() => {                                    // match selections → variant
    if (options.length === 0) return variants[0] || null;           // option-less → single variant
    if (!options.every((o) => selectedOptions[o.id])) return null;  // not all chosen yet
    return variants.find((v) => (v.choices || []).every((c) =>
      selectedOptions[c.optionChoiceIds?.optionId] === c.optionChoiceIds?.choiceId)) || null;
  }, [options, variants, selectedOptions]);

  const inStock = variant ? variant.inventoryStatus?.inStock !== false : true;
  const canAdd = useMemo(() => {
    if (options.length > 0 && !variant) return false;               // options exist but unresolved
    if (variant && !inStock) return false;
    return modifiers.filter((m) => m.mandatory).every((m) =>        // every mandatory modifier filled
      m.modifierRenderType === "FREE_TEXT" ? !!modifierValues[m.freeTextSettings?.key] : !!modifierValues[m.key]);
  }, [options, variant, inStock, modifiers, modifierValues]);

  const price = variant?.price?.actualPrice?.formattedAmount || product?.actualPriceRange?.minValue?.formattedAmount || "";

  async function handleAdd() {
    const modifierChoices = {}, customTextFields = {};
    modifiers.forEach((m) => {
      const k = m.modifierRenderType === "FREE_TEXT" ? m.freeTextSettings?.key : m.key;
      if (!k || !modifierValues[k]) return;
      (m.modifierRenderType === "FREE_TEXT" ? customTextFields : modifierChoices)[k] = modifierValues[k];
    });
    await addToCart(product.id, variant?.id, quantity, {
      modifierChoices: Object.keys(modifierChoices).length ? modifierChoices : undefined,
      customTextFields: Object.keys(customTextFields).length ? customTextFields : undefined,
    });
  }

  if (notFound) return <div>Product not found.</div>;
  if (!product) return <div>Loading…</div>;
  return (
    <div /* restyle */>
      <img src={product.media?.main?.image?.url} alt={product.name} />
      <h1>{product.name}</h1>
      <p>{price}</p>
      {/* plainDescription is HTML despite the name — never render as plain text */}
      <div dangerouslySetInnerHTML={{ __html: product.plainDescription || "" }} />
      {options.map((o) => (
        <OptionSelector key={o.id} option={o} selected={selectedOptions[o.id]}
          onSelect={(id, cid) => setSelectedOptions((s) => ({ ...s, [id]: cid }))} />
      ))}
      {modifiers.map((m) => (
        <ModifierSelector key={m.key || m.freeTextSettings?.key} modifier={m}
          value={modifierValues[m.key || m.freeTextSettings?.key]}
          onChange={(k, v) => setModifierValues((s) => ({ ...s, [k]: v }))} />
      ))}
      <button disabled={!canAdd} onClick={handleAdd}>{inStock ? "Add to cart" : "Out of stock"}</button>
    </div>
  );
}
```

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the store content for their site. To facilitate this, provide the user with deep links directly to the relevant dashboard pages. For store data those pages are:
- **Products** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-stores/products` (`Dashboard → Store → Products`; add/edit products, variants, inventory)
- **Categories** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-stores/categories/list` (`Dashboard → Store → Categories`; organize products into the category menu)

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (cart survives reload, same visitor)
- [ ] Every product choice renders on the PDP — variant options **and** modifiers (mandatory ones included)
- [ ] Add-to-cart button stays disabled until all required choices are made (variant + mandatory modifiers)
- [ ] A product with a mandatory modifier adds successfully (its selection is sent, cart line appears)
- [ ] Stock reflected in the UI — sold-out product badged (grid), out-of-stock option choices and variants disabled/labelled (PDP)
- [ ] Add to cart works; out-of-stock items throw rather than add a dead line
- [ ] Quantity update / remove reflect in `getCurrentCart()`
- [ ] Checkout redirects via redirect-session `fullUrl` (no hand-built URL)
- [ ] Cart re-fetched on return from checkout (clears once the order is placed)
- [ ] Empty state shown when `countProducts()` is 0
- [ ] No mock products anywhere
- [ ] Told the user at least once that they can continue setting up their store in the dashboard and provided deep links.
