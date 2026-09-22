// useProductDetail — all PDP logic, no markup: load product by slug, resolve the buyer's selections
// to a Wix variant, gate add-to-cart on availability + mandatory modifiers, and build the addToCart
// payload. The data paths here (variant resolution, price precedence, modifier keys, stock gating)
// are the bug-prone part — keep them verbatim; the PDP page only renders what this returns.
import { useState, useEffect, useMemo } from "react";
import { getProductBySlug, sellingPrice } from "@/rest/wix-store-catalog";
import { choiceImage, variantImage } from "@/lib/storeImage";
import { useCart } from "@/context/CartContext";

// A variant is identified by the SET of its choice ids — sorted, so option order can't matter.
const choiceKey = (choiceIds) => [...choiceIds].sort().join("_");

export function useProductDetail(slug) {
  const { addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [notFound, setNotFound] = useState(false);
  // A missing product (notFound) and a failed request (error) need different pages: one is a dead
  // link, the other is worth retrying. Without the split, a network blip reads as "product deleted".
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  // Selections start EMPTY. Pre-picking the first choice lets a buyer who never noticed the default
  // buy the wrong colour; the PDP shows a neutral "choose a size" until every option is picked.
  const [selectedOptions, setSelectedOptions] = useState({});
  const [modifierValues, setModifierValues] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProduct(null);
    setNotFound(false);
    setError(null);
    setSelectedOptions({});
    setQuantity(1);
    getProductBySlug(slug)
      .then((p) => {
        if (cancelled) return;
        if (!p) return setNotFound(true);
        setProduct(p);
      })
      .catch((e) => { if (!cancelled) setError(e?.message || "Couldn't load this product."); });
    return () => { cancelled = true; };
  }, [slug, reloadKey]);

  const options = product?.options || [];
  const modifiers = product?.modifiers || [];

  // Visible variants keyed by their sorted choice ids. Two variants with the same choices is a
  // catalog defect — report it instead of silently letting one overwrite the other.
  const { variantByKey, duplicateKey } = useMemo(() => {
    const map = new Map();
    let dup = null;
    for (const v of product?.variantsInfo?.variants || []) {
      if (v.visible === false) continue;
      const k = choiceKey((v.choices || []).map((c) => c.optionChoiceIds?.choiceId));
      if (map.has(k) && !dup) dup = k;
      map.set(k, v);
    }
    return { variantByKey: map, duplicateKey: dup };
  }, [product]);

  const selectionComplete = options.length > 0 && options.every((o) => selectedOptions[o.id]);
  const variant = useMemo(() => {
    if (options.length === 0) return variantByKey.values().next().value || null;   // the single variant
    if (!selectionComplete || duplicateKey) return null;
    return variantByKey.get(choiceKey(options.map((o) => selectedOptions[o.id]))) || null;
  }, [options, variantByKey, duplicateKey, selectedOptions, selectionComplete]);

  // In stock OR pre-orderable counts as buyable; a preorder add carries preOrderRequested.
  const inStock = variant ? variant.inventoryStatus?.inStock !== false : true;
  const isPreorder = !!variant && !inStock && variant.inventoryStatus?.preorderEnabled === true;
  const available = inStock || isPreorder;

  const missingModifier = modifiers.find((m) => m.mandatory && !(
    m.modifierRenderType === "FREE_TEXT" ? modifierValues[m.freeTextSettings?.key] : modifierValues[m.key]));

  const canAdd = useMemo(() => {
    if (!product) return false;
    if (options.length > 0 && !variant) return false;
    if (variant && !available) return false;
    return !missingModifier;
  }, [product, options, variant, available, missingModifier]);

  // Why the buy button is disabled — neutral guidance to render next to the action ("Choose a
  // size"), not an error; null when the buyer can add. Promote to error styling only after they try.
  const blockedReason = useMemo(() => {
    if (!product) return null;
    if (duplicateKey) return "This product's variants can't be resolved right now.";
    if (options.length > 0 && !selectionComplete) {
      const missing = options.filter((o) => !selectedOptions[o.id]).map((o) => o.name);
      return `Choose ${missing.join(" and ")}`;
    }
    if (options.length > 0 && !variant) return "This combination isn't available";
    if (variant && !available) return "Out of stock";
    if (missingModifier) return `Add ${missingModifier.name}`;
    return null;
  }, [product, duplicateKey, options, selectionComplete, selectedOptions, variant, available, missingModifier]);

  // Everything the buyer sees follows the resolved `variant` (also returned below). The price obeys
  // the exact precedence in sellingPrice(): an automatic discount beats the regular price and strikes
  // it; else the regular price with the merchant's compare-at as the "was". Before every option is
  // picked, the product's min–max range (one value when equal) — never an empty price.
  const min = product?.actualPriceRange?.minValue, max = product?.actualPriceRange?.maxValue;
  const rangeDisplay = min?.amount && max?.amount && min.amount !== max.amount
    ? `${min.formattedAmount} – ${max.formattedAmount}` : (min?.formattedAmount || "");
  const resolved = variant ? sellingPrice(variant.price) : null;
  const price = resolved?.current?.formattedAmount || rangeDisplay;
  const compareAtPrice = resolved && resolved.original?.formattedAmount &&
    Number(resolved.original.amount) > Number(resolved.current?.amount) ? resolved.original.formattedAmount : "";
  const discountNames = product?.discountInfo?.discountRuleNames || [];   // automatic discounts, product level

  // The gallery follows the selection. Prefer the selected choice's own image (the per-swatch photo,
  // choice.media.items[].mediaId) — Wix's per-variant media is often NOT differentiated (it defaults to
  // the product's main image), so preferring the variant would override the correct choice image for
  // every colour. Fall back to the resolved variant's image only when no chosen option carries one.
  // See lib/storeImage: choiceImage() / variantImage().
  const focusMediaUrl = useMemo(() => {
    for (const o of options) {
      const choice = (o.choicesSettings?.choices || []).find((c) => c.choiceId === selectedOptions[o.id]);
      const url = choiceImage(choice);
      if (url) return url;
    }
    return variantImage(variant);
  }, [variant, options, selectedOptions]);

  // Changing an option resets the quantity — the ceiling belongs to the newly resolved variant.
  const selectOption = (optionId, choiceId) => {
    setSelectedOptions((s) => ({ ...s, [optionId]: choiceId }));
    setQuantity(1);
  };
  const setModifier = (key, value) => setModifierValues((s) => ({ ...s, [key]: value }));

  async function submit() {
    const modifierChoices = {}, customTextFields = {};
    modifiers.forEach((m) => {
      const k = m.modifierRenderType === "FREE_TEXT" ? m.freeTextSettings?.key : m.key;
      if (!k || !modifierValues[k]) return;
      (m.modifierRenderType === "FREE_TEXT" ? customTextFields : modifierChoices)[k] = modifierValues[k];
    });
    setAdding(true);
    try {
      // addToCart reports its own failures through the cart context (it opens the drawer with the
      // reason). Preserve its undefined-on-success / null-on-failure result for chained actions.
      // Coerce the quantity: the shipped stepper lets the field sit empty mid-edit, and a keyboard
      // submit from that state would otherwise post "" as the quantity.
      return await addToCart(product.id, variant?.id, Math.max(1, Number(quantity) || 1), {
        modifierChoices: Object.keys(modifierChoices).length ? modifierChoices : undefined,
        customTextFields: Object.keys(customTextFields).length ? customTextFields : undefined,
        preorder: isPreorder,
      });
    } finally {
      setAdding(false);
    }
  }

  return {
    product, notFound, error, retry: () => setReloadKey((k) => k + 1),
    options, modifiers,
    selectedOptions, selectOption, modifierValues, setModifier,
    quantity, setQuantity, variant, inStock, isPreorder, canAdd, blockedReason, adding,
    price, compareAtPrice, discountNames, submit, focusMediaUrl,
  };
}
