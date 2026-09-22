// Headless data layer for a product grid tile.
// Normalises raw Wix product fields into render-agnostic structures so you can build
// whatever card UI you want (image layout, badge style, price display, quick-add trigger)
// without touching the badge logic, price rules, or colour-dot extraction.
//
// Usage:
//   const { isSoldOut, leftBadges, ribbons, promoBadge, priceDisplay, compareAtDisplay,
//           colors, optionLabel, isQuickAddable, directAddVariantId, image, hoverImage } = useProductCard(product);
//   // then render however you want; quick-add: addToCart(product.id, directAddVariantId) from useCart().

import { useMemo } from "react";
import { productImage, productGallery } from "@/lib/storeImage";
import { sellingPrice } from "@/rest/wix-store-catalog";

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

    // Merchant ribbons — the primary one plus every additional one. Render ALL of them, in one shared
    // style (a "Sale" accent is fine, applied by label). Never compute a "-20%" badge from the price
    // range: a range's minimum says nothing about the variant the buyer picks, and a ribbon is a
    // label, not a price claim.
    const ribbons = [product?.ribbon?.name, ...(product?.additionalRibbons ?? []).map((r) => r?.name)]
      .filter((name, i, all) => name && all.indexOf(name) === i);
    const promoBadge = ribbons[0] ? { type: "ribbon", label: ribbons[0] } : null;

    // Price. A single-price product shows the price the buyer pays — the lowest-priced variant's
    // discounted price when an automatic discount applies (priceAfterDiscount), else its regular
    // price — with the struck "was" price beside it. Variants priced differently show a min–max
    // range with NO struck price: one lone "was" against a range implies a saving that may not
    // apply to the variant the buyer picks; the PDP shows the real comparison once a variant is chosen.
    const min = product?.actualPriceRange?.minValue;
    const max = product?.actualPriceRange?.maxValue;
    const isRange = !!(min?.amount && max?.amount && min.amount !== max.amount);
    const minVariant = product?.variantSummary?.minPriceVariant ?? null;
    const { current, original } = sellingPrice(minVariant?.price);
    const priceDisplay = isRange
      ? `${min?.formattedAmount ?? ""} – ${max?.formattedAmount ?? ""}`
      : current?.formattedAmount ?? min?.formattedAmount;
    const compareAtDisplay =
      !isRange && original?.formattedAmount && Number(original.amount) > Number(current?.amount ?? min?.amount)
        ? original.formattedAmount
        : null;

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
    // The variant a direct add sends (a product with no options still has one variant).
    const directAddVariantId = isQuickAddable ? minVariant?.id ?? null : null;

    // Images: normalised through lib/storeImage so URLs are consistent across the tile,
    // the PDP gallery, and the cart. Hover image is the second gallery shot (if one exists).
    const image      = productImage(product);
    const hoverImage = productGallery(product)[1]?.url ?? null;

    return {
      isSoldOut,
      isPreorder,
      isPartiallyOutOfStock,
      leftBadges,          // [{ type: 'pre-order'|'sold-out'|'limited-stock', label }]
      ribbons,             // every merchant ribbon label, primary first — render all of them
      promoBadge,          // { type: 'ribbon', label } | null — the primary ribbon, for a single-badge slot
      priceDisplay,        // formatted price the buyer pays, or a min–max range
      compareAtDisplay,    // formatted struck "was" price | null (never beside a range)
      colors,              // hex strings — render as dots; the tile shows up to however many you want
      optionLabel,         // "3 sizes · 2 materials" or empty string
      isQuickAddable,
      directAddVariantId,  // pass as variantId to addToCart on quick-add
      image,               // primary image URL | null
      hoverImage,          // second image URL for hover effect | null
    };
  }, [product]);
}
