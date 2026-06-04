---
name: custom-ecom-wiring
description: "Integration-mode wiring subagent for the ecom capability. Wires add-to-cart + checkout into a brought-in static site — @wix/ecom currentCart + a redirect to Wix-hosted checkout, client-side via @wix/sdk from CDN. No SSR cart-persistence (deferred); cart lives in the visitor session + a checkout redirect."
---

# Ecom wiring (integration mode)

You wire the **ecom capability** (add-to-cart + checkout) into a brought-in static site (`frontend = "custom"`). Pairs with the **stores** guide (which renders products). Client-side vanilla JS, `@wix/sdk` from CDN, no build. Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline" first.

> **Scope.** Beta does **add-to-cart + redirect-to-Wix-hosted-checkout** via the visitor session. A persistent on-page cart UI across reloads needs the server runtime (`@wix/astro`) — **deferred**. Checkout itself happens on Wix's hosted page, so payment/fulfillment need no client work.

## Inputs

- **`appId`** — `OAuthStrategy` `clientId`.
- Binding-map / design controls: the "Add to cart" / "Buy" buttons (with the product/variant id available, e.g. from the stores wiring's `data-product-id`).

## Add to cart + checkout

```html
<script type="module">
  import { createClient, OAuthStrategy } from "https://esm.sh/@wix/sdk@1";
  import { currentCart } from "https://esm.sh/@wix/ecom@1";
  import { redirects } from "https://esm.sh/@wix/redirects@1";

  const wix = createClient({ modules: { currentCart, redirects }, auth: OAuthStrategy({ clientId: "REPLACE_WITH_APP_ID" }) });

  // Add to cart — buttons carry data-product-id (set by the stores wiring)
  document.querySelectorAll("[data-add-to-cart]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await wix.currentCart.addToCurrentCart({
          lineItems: [{
            catalogReference: {
              appId: "215238eb-22a5-4c36-9e7b-e7c08025e04e", // Wix Stores catalog appId (constant)
              catalogItemId: btn.dataset.productId,
            },
            quantity: 1,
          }],
        });
        document.querySelector("[data-cart-badge]")?.replaceChildren(document.createTextNode("•"));
      } catch (err) { console.error("[wix-ecom] add-to-cart failed:", err); }
      finally { btn.disabled = false; }
    });
  });

  // Checkout — create a checkout from the current cart, then redirect to Wix-hosted checkout
  document.querySelector("[data-checkout]")?.addEventListener("click", async () => {
    try {
      const { checkoutId } = await wix.currentCart.createCheckoutFromCurrentCart({ channelType: "WEB" });
      const { redirectSession } = await wix.redirects.createRedirectSession({
        ecomCheckout: { checkoutId },
        callbacks: { postFlowUrl: location.href },
      });
      if (redirectSession?.fullUrl) location.assign(redirectSession.fullUrl);
    } catch (err) { console.error("[wix-ecom] checkout failed:", err); }
  });
</script>
```

- **`currentCart`** APIs only — never the `cart` namespace that needs a cart ID.
- The Wix Stores catalog `appId` (`215238eb-…`) is a platform constant (the catalog provider), distinct from the site's OAuth `appId`/`clientId`.
- Cart badge is a minimal indicator; a full cart-contents page is out of Beta scope (no SSR persistence).

## Discipline & return

Additive; inline the site `appId`; guard calls. Return per `shared/RETURN_CONTRACT.md`: files edited, controls wired (add-to-cart count, checkout button), and note that persistent cart UI is deferred.
