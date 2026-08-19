// Headless data layer for a product grid tile.
// Normalises raw Wix product fields into render-agnostic structures so you can build
// whatever card UI you want (image layout, badge style, price display, quick-add trigger)
// without touching the badge-priority logic, price-range maths, or colour-dot extraction.
//
// Usage:
//   const { isSoldOut, leftBadges, promoBadge, priceDisplay, compareAtDisplay,
//           colors, optionLabel, isQuickAddable, image, hoverImage } = useProductCard(product);
//   // then render however you want, call addToCart(product.id) from useCart() for quick-add.

import { useMemo } from "react";
import { productImage, productGallery } from "@/lib/storeImage";

function discountPercent(product) {
  const now = Number(product?.actualPriceRange?.minValue?.amount);
  const was = Number(product?.compareAtPriceRange?.minValue?.amount);
  if (!now || !was || was <= now) return null;
  return Math.round(((was - now) / was) * 100);
}

export function useProductCard(product) {
  return useMemo(() => {
    const status = product?.inventory?.availabilityStatus;
    const isSoldOut = status === "OUT_OF_STOCK";
    // preorderStatus is only meaningful when the product is out of stock
    const isPreorder = isSoldOut && product?.inventory?.preorderStatus === "ENABLED";
    const isPartiallyOutOfStock = status === "PARTIALLY_OUT_OF_STOCK";

    // Left-side badges (stacked, top-left of the image): stock / pre-order state.
    const leftBadges = [];
    if (isPreorder)                leftBadges.push({ type: "pre-order",     label: "Pre-order"     });
    else if (isSoldOut)            leftBadges.push({ type: "sold-out",      label: "Sold out"      });
    if (isPartiallyOutOfStock)     leftBadges.push({ type: "limited-stock", label: "Limited stock" });

    // Right-side promo badge: discount % beats a merchant ribbon (a "Sale" ribbon is redundant
    // when the % is already showing). Only one at a time.
    const discount = discountPercent(product);
    const ribbon   = product?.ribbon?.name;
    const promoBadge = discount
      ? { type: "discount", label: `-${discount}%` }
      : ribbon
      ? { type: "ribbon",   label: ribbon }
      : null;

    // Price: show a min–max range when variants span different prices so the PDP doesn't
    // appear to raise the price once a variant is selected.
    const priceMin = product?.actualPriceRange?.minValue?.formattedAmount;
    const priceMax = product?.actualPriceRange?.maxValue?.formattedAmount;
    const compareAt = product?.compareAtPriceRange?.minValue?.formattedAmount;
    const priceDisplay      = priceMax && priceMax !== priceMin ? `${priceMin} – ${priceMax}` : priceMin;
    const compareAtDisplay  = compareAt && compareAt !== priceMin ? compareAt : null;

    // Options preview for the tile summary row.
    // Colour options → real hex dots (more informative than "3 colours").
    // Non-colour options → "3 sizes · 2 materials" (pluralised from the merchant's own name).
    const labels = [], colors = [];
    for (const o of product?.options || []) {
      const choices = (o.choicesSettings?.choices || []).filter((c) => c.visible !== false);
      if (!choices.length) continue;
      const swatches = choices.map((c) => c.colorCode).filter(Boolean);
      if (swatches.length) { colors.push(...swatches); continue; }
      const n = o.name.toLowerCase();
      labels.push(`${choices.length} ${choices.length === 1 || n.endsWith("s") ? n : `${n}s`}`);
    }
    const optionLabel = labels.join(" · ");
    const hasOptions  = (product?.options?.length || 0) > 0;

    // Quick-add is only safe for single-variant products (no option choices to resolve).
    // Sold-out with pre-order still shows a CTA, but it links to the PDP, not quick-add.
    const isQuickAddable = !hasOptions && !isSoldOut;

    // Images: normalised through lib/storeImage so URLs are consistent across the tile,
    // the PDP gallery, and the cart. Hover image is the second gallery shot (if one exists).
    const image      = productImage(product);
    const hoverImage = productGallery(product)[1]?.url ?? null;

    return {
      isSoldOut,
      isPreorder,
      isPartiallyOutOfStock,
      leftBadges,       // [{ type: 'pre-order'|'sold-out'|'limited-stock', label }]
      promoBadge,       // { type: 'discount'|'ribbon', label } | null
      priceDisplay,     // formatted price (range or single value)
      compareAtDisplay, // formatted compare-at price | null
      colors,           // hex strings — render as dots; the tile shows up to however many you want
      optionLabel,      // "3 sizes · 2 materials" or empty string
      isQuickAddable,
      image,            // primary image URL | null
      hoverImage,       // second image URL for hover effect | null
    };
  }, [product]);
}
